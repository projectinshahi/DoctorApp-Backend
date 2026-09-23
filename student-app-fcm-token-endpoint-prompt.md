# dr_app: point device registration at the real endpoint

The backend endpoint for storing a device's FCM token is live, but it isn't the
path this app calls. Nothing is stored today, so no student-targeted
notification can arrive. Two small changes in
`lib/services/notification_service.dart` fix it.

Everything here is already deployed at
`https://doctorapp-backend-cl2h.onrender.com` (commit `cbcdb51`).
`ApiConstant.host` already points there — don't change it.

## 1. The path loses the student id

The student is taken from the access token, not the URL. An id in the path
would let anyone register their own phone against another student's account and
receive that student's notifications, so the server ignores it.

Replace:

```dart
/// Where the backend files this phone's token for a student.
static String tokenUrl(int studentId) =>
    '${ApiConstant.baseUrl}/students/$studentId/fcm-token';
```

with:

```dart
/// Where the backend files this phone's token. No student id: the server
/// takes the student from the access token, so a phone cannot be registered
/// against someone else's account.
static String get tokenUrl => '${ApiConstant.baseUrl}/users/me/fcm-token';
```

Then in `_sendToken`, call `ApiClient.post(tokenUrl, body: {...})`. Keep the
`studentId` parameter if you use it for the debug line; it just no longer goes
into the URL.

The request body is unchanged:

```json
{ "token": "<fcm token>", "platform": "android" }
```

`platform` is optional and must be `"android"` or `"ios"` when sent.

A 200 comes back as `{"registered": true, "platform": "android", "updatedAt": "..."}`.
Calling it again with the same token updates the row rather than adding one, so
it is safe to send on every launch and on every `onTokenRefresh`.

Errors: **401** means no or expired access token (ApiClient already refreshes),
**400** means the body had no `token`.

## 2. Sign-out must tell the server, not just Firebase

`unregisterToken()` currently only calls `FirebaseMessaging.instance.deleteToken()`.
That stops this phone from *receiving* on that token, but the row stays on the
server against the student who left, so the backend keeps sending to a dead
token forever.

Delete it on the server **before** deleting it locally — afterwards the value is
gone and there is nothing left to send:

```dart
Future<void> unregisterToken() async {
  _studentId = null;
  if (!pushAvailable) return;
  try {
    // Server first: after deleteToken() the value is gone, and the row would
    // be left behind against the student who just signed out.
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      await ApiClient.delete('$tokenUrl?token=${Uri.encodeComponent(token)}');
    }
  } catch (error) {
    // Not fatal: the backend drops tokens that FCM reports as unregistered.
    if (kDebugMode) debugPrint('PUSH  server token not removed: $error');
  }
  try {
    await FirebaseMessaging.instance.deleteToken();
  } catch (error) {
    if (kDebugMode) debugPrint('PUSH  token not deleted: $error');
  }
}
```

The token goes in the query string because `ApiClient.delete(String url)` sends
no body. The server accepts either.

A 200 comes back as `{"removed": true}`, or `{"removed": false}` if there was
nothing to remove — signing out twice is not an error.

## What the backend sends

| When | Sent to | `data.type` | Android channel |
|---|---|---|---|
| A course is published | the `all-students` topic | `new_course` | `new_courses` |
| The student picks a course | that student's devices | `course_join` | `course_updates` |

`course_join` carries `{"type": "course_join", "courseId": "22"}` — all values
are strings, because FCM rejects a message with a numeric one. The channels
already match what this app creates, so nothing changes there.

`course_join` only fires when the selected course actually *changes*. Choosing
the same course again sends nothing, by design.

## Do not

- Do not run `flutterfire configure`. This app initialises Firebase with a plain
  `Firebase.initializeApp()` and has no `firebase_options.dart`; generating one
  changes how the app starts.
- Do not add an id to the path, or send a `studentId` field in the body. The
  server ignores both and takes the student from the access token.
- Do not touch iOS. There is still no `GoogleService-Info.plist`, so push is
  Android-only for now.

## How to check it worked

1. Run on a real Android device (an emulator without Play Services gets no token).
2. Sign in. The debug log should show the token being sent and HTTP 200.
3. Ask the backend side to confirm the row landed in `fcm_tokens` for that student.
4. In the app, pick a **different** course than the current one. The phone
   should show **"You joined a new course!"** on the *Course updates* channel,
   in the foreground and with the app closed.
5. Sign out, then ask the backend side to confirm the row is gone.
