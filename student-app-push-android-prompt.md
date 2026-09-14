# Task: push notifications for new courses — Android only

Paste this into Claude inside the **student app repo** (`dr_app`).

**Android only. iOS is on hold** — nothing in this task may break the iOS build.

---

## What the backend does (already built)

When an admin publishes a course, the backend sends one message to the Firebase
topic **`all-students`**. Every app that has subscribed receives it.

It fires once, at the moment a course goes live:

| admin action | notification? |
|---|---|
| create a course as draft | no |
| draft → published | **yes** |
| edit a course that is already published | no |
| create a course directly as published | **yes** |

The message:

```json
{
  "notification": { "title": "New course available", "body": "GP License Exam" },
  "data": { "type": "new_course", "courseId": "22" },
  "android": { "priority": "high", "notification": { "channelId": "new_courses" } }
}
```

`courseId` is a **string** — FCM only allows strings in `data`. Parse it before
use.

---

## 1. Firebase setup — already done

These are in place; do not redo them:

- Android app registered in Firebase with package **`com.keerthana.dr_app`**
- `android/app/google-services.json` downloaded from that registration
- `com.google.gms.google-services` declared in `android/settings.gradle.kts`
  and applied in `android/app/build.gradle.kts` (Kotlin DSL)
- `firebase_core` in `pubspec.yaml`, and `Firebase.initializeApp()` in `main.dart`

**Do not run `flutterfire configure`.** This project initialises Firebase from
`google-services.json` with a plain `Firebase.initializeApp()`, and there is no
`lib/firebase_options.dart`. Running it would generate that file and change how
startup works for no benefit on Android.

## 2. Packages

```
flutter pub add firebase_messaging flutter_local_notifications
```

## 3. Keep iOS building

**Guard all push setup behind `Platform.isAndroid`.** The iOS app has no
`GoogleService-Info.plist`, and `Firebase.initializeApp()` throws without it —
so unguarded setup would crash the iOS build on launch.

## 4. Initialise, in `main()`

```dart
import 'dart:io' show Platform;
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

final localNotifications = FlutterLocalNotificationsPlugin();

const newCoursesChannel = AndroidNotificationChannel(
  'new_courses',                 // must match the backend's channelId
  'New courses',                 // what the student sees in Android settings
  description: 'When a new course is published',
  importance: Importance.high,
);

// Top level, not a method: Android runs it in a separate isolate when the
// app is closed.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (Platform.isAndroid) {
    // Keep the existing try/catch around this — a broken Firebase config must
    // never stop the app opening.
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);

    await localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(newCoursesChannel);
  }

  runApp(const MyApp());
}
```

## 5. After login: permission and subscription

**Ask after the student signs in, not on first launch.** A prompt with no
context gets denied, and Android will not show it again.

```dart
Future<void> enablePush() async {
  if (!Platform.isAndroid) return;

  final messaging = FirebaseMessaging.instance;
  await messaging.requestPermission();          // Android 13+ shows the prompt
  await messaging.subscribeToTopic('all-students');
}
```

On **logout**, unsubscribe, so a signed-out phone stops receiving course news:

```dart
await FirebaseMessaging.instance.unsubscribeFromTopic('all-students');
```

## 6. Showing it while the app is open

**Android shows nothing on its own when the app is in the foreground.** The
message arrives in `onMessage` and is dropped unless you display it:

```dart
FirebaseMessaging.onMessage.listen((message) {
  final n = message.notification;
  if (n == null) return;
  localNotifications.show(
    message.hashCode,
    n.title,
    n.body,
    NotificationDetails(
      android: AndroidNotificationDetails(
        newCoursesChannel.id, newCoursesChannel.name,
        importance: Importance.high, priority: Priority.high,
      ),
    ),
    payload: message.data['courseId'],
  );
});
```

## 7. Tapping it opens the course

Three cases, and all three must be handled:

```dart
void _openFromData(Map<String, dynamic> data) {
  if (data['type'] != 'new_course') return;
  final id = int.tryParse(data['courseId'] ?? '');
  if (id != null) openCourse(id);
}

// app was closed
final initial = await FirebaseMessaging.instance.getInitialMessage();
if (initial != null) _openFromData(initial.data);

// app was in the background
FirebaseMessaging.onMessageOpenedApp.listen((m) => _openFromData(m.data));

// app was open (the local notification from step 6)
await localNotifications.initialize(
  const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
  onDidReceiveNotificationResponse: (r) {
    final id = int.tryParse(r.payload ?? '');
    if (id != null) openCourse(id);
  },
);
```

`openCourse` should route through course selection if the student has not
picked that course yet — a new course is, by definition, one they have not
selected.

---

## Testing

**Without the backend:** Firebase console → **Messaging → New campaign →
Notification** → target **Topic** `all-students` → add custom data
`type = new_course`, `courseId = 22`.

**With the backend:** once `FIREBASE_SERVICE_ACCOUNT` is set on Render, publish
a draft course from the admin panel.

Test all three tap cases: app open, app in background, app swiped away. Use a
**real phone** — emulators without Google Play services do not receive FCM.

## Release

Adding Firebase changes the app, so this ships in a **new Play Store build**.

## Constraints

- Guard everything behind `Platform.isAndroid` until iOS is set up.
- Channel id is exactly `new_courses`.
- Ask for permission after login, never on first launch.
- Parse `courseId` from a string.
- Handle all three tap cases.
- Unsubscribe on logout.
