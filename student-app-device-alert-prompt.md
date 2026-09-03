# Task: single-device sign-in — first device wins

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`

**This replaces the earlier behaviour.** A new device no longer takes over the
account. While the account is in use on one device, the second is **refused**.

Captured against the live backend on 2026-09-02.

---

## Sign-up and sign-in are one call

`POST /api/auth/google` with `{ idToken, deviceId }` — both required, 400
without either. New email → account created, `isNewUser: true`. Existing email
→ sign-in.

---

## 1. Allowed — 200

```json
{ "accessToken": "...", "refreshToken": "...", "sessionId": 91,
  "isNewUser": false,
  "notice": null,
  "signedOutOtherDevice": false,
  "previousSession": null,
  "user": { "id": 35, "email": "...", "name": "..." } }
```

Show `notice` in a dialog **only when it is non-null**. It is a finished
sentence — do not compose your own.

`isNewUser: true` → send them to course selection, not home. A new account has
no `selectedCourseId`, so `/home` comes back empty until they pick one.

## 2. Refused — 409, the case you asked for

```json
409
{ "error": {
    "code": "SESSION_ACTIVE_ELSEWHERE",
    "message": "This account is signed in on another device. Sign out there first, or try again in a few minutes.",
    "status": 409 },
  "previousSession": { "deviceId": "PHONE-A", "signedInAt": "...", "lastSeenAt": "...", "sameDevice": false },
  "retryAfterMinutes": 30 }
```

**The student stays on the login screen.** No tokens are issued, and the other
device is untouched — it keeps working, and gets no "you were signed out"
message, because it wasn't.

Show `error.message`, and use `retryAfterMinutes` to make it concrete:

> This account is signed in on another device. Sign out there first, or try
> again in **30 minutes**.

Do not retry automatically and do not offer a "force sign in" button — there is
no force flag, by design.

## 3. When a second device IS let in

Two cases, both 200:

- **Same device signing in again** — never refused, whatever the clock says.
  Refusing there would lock a student out with their own phone in their hand.
  `notice` is null, `previousSession.sameDevice` is true.
- **The other device has gone quiet for 30 minutes** — the lock is released
  automatically and the new device gets in with:

```json
{ "notice": "Your other device had been inactive, so it has been signed out.",
  "signedOutOtherDevice": true }
```

Show that one. It explains why they suddenly got in, and it tells them the
other device is now signed out.

Verified end to end:

```
1. PHONE-A signs in            → 200
2. TABLET-B tries, A active    → 409 SESSION_ACTIVE_ELSEWHERE, retryAfterMinutes 30
3. PHONE-A signs in again      → 200, notice null
4. A idle 31 min, B retries    → 200, "Your other device had been inactive…"
```

---

## `deviceId` is now load-bearing

It decides whether a student can reach their own account. Get it wrong and they
are locked out for 30 minutes at a time.

- **Generate once, persist, reuse forever.** A new id per launch means every
  sign-in looks like a second device.
- **Prefer an id that survives a reinstall** — `androidId` on Android,
  `identifierForVendor` on iOS — falling back to a stored uuid. With a
  SharedPreferences-only uuid, reinstalling the app looks like a brand new
  device and the student waits out the idle window.

```dart
Future<String> deviceId() async {
  final p = await SharedPreferences.getInstance();
  var id = p.getString('device_id');
  if (id != null) return id;
  final info = DeviceInfoPlugin();
  id = Platform.isAndroid
      ? (await info.androidInfo).id
      : (await info.iosInfo).identifierForVendor ?? const Uuid().v4();
  await p.setString('device_id', id);
  return id;
}
```

## The old device: nothing changes for it

It is never kicked by a login any more. It still gets **401 `SESSION_ENDED`**
if its session was released for idleness, or if an admin signed it out.

Handle 401 by `error.code`, never by the status alone:

| code | do |
|---|---|
| `INVALID_TOKEN` | refresh, retry once |
| `SESSION_ENDED` / `REFRESH_TOKEN_REUSED` | clear, log out, show the message |
| `ACCOUNT_BLOCKED` (403) | log out, "contact support" |

`POST /api/auth/refresh` returns `SESSION_ENDED` too, so an interceptor that
refreshes on every 401 will loop.

## Logging out matters now

`POST /api/auth/logout` releases the lock immediately. Before, forgetting to
log out cost nothing; now it makes the student wait 30 minutes to use another
device. Put a visible **Log out** in the profile menu and call it on account
switch.

## What to build

**Login screen** — handle 200 and 409 differently. 409 stays on the screen with
the message and the minutes; it is not an error state to retry.

**A stable `deviceId`**, reinstall-surviving where the platform allows.

**Log out** — visible, and actually calling the endpoint.

**One 401 handler** keyed on `error.code`.

## Constraints

- 409 is not a failure to retry. Show it and stop.
- Never build a "force sign in" — the API has no such flag.
- `notice` is shown verbatim, only when non-null.
- `deviceId` must survive restarts, ideally reinstalls.
- Never refresh on `SESSION_ENDED`.
