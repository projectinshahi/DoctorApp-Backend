# Task: show the "signed out on your other device" alert

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>`.

Captured against the live backend on 2026-09-02.

---

## The rule

**One device at a time.** Signing in on a new device revokes the old session
immediately. There are two sides to tell the student about, and the app needs
both.

---

## 1. The NEW device — alert at login

`POST /api/auth/google` (`idToken` + `deviceId`, both required) now returns
three extra fields:

```json
{ "accessToken": "...", "refreshToken": "...", "isNewUser": false,
  "sessionId": 82,
  "signedOutOtherDevice": true,
  "notice": "You've been signed out on your other device. Only one device can be signed in at a time.",
  "previousSession": { "deviceId": "PHONE-A", "signedInAt": "...", "sameDevice": false },
  "user": { "id": 35, "email": "...", "name": "..." } }
```

**Show `notice` when it is non-null.** It is a finished sentence — do not
rewrite it per platform, and do not build your own from
`signedOutOtherDevice`.

```dart
final res = await api.googleSignIn(idToken, deviceId);
await auth.store(res);
if (res.notice != null) {
  await showDialog(context: context, builder: (_) => AlertDialog(
    title: const Text('Signed in'),
    content: Text(res.notice!),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
  ));
}
goToHome();
```

### It fires only on a real device switch

Verified end to end:

| | `signedOutOtherDevice` | `notice` |
|---|---|---|
| first ever login | `false` | `null` |
| **same** phone signs in again | `false` | `null` |
| a different device signs in | **`true`** | the sentence above |

The same-device case matters: re-login on the same phone happens constantly,
and firing the alert there would tell a student they were kicked off the device
in their hand. It would cry wolf until it was ignored.

`previousSession` is still returned on a same-device login (with
`sameDevice: true`) for an app that wants to say "welcome back" — only the
alarm is withheld. It is `null` on a brand new account.

**`deviceId` must be stable per install.** Generate it once, store it, reuse
it. A fresh id every launch makes every login look like a device switch and the
alert fires forever.

---

## 2. The OLD device — alert on its next request

The old device is not notified; it finds out when it next calls the API. There
is no push.

```json
401 { "code": "SESSION_ENDED",
      "message": "You were signed out because your account was accessed on another device." }
```

**Handle it by `code`, not by the 401.** Three different things share that
status and only one of them should trigger a refresh:

| code | meaning | do |
|---|---|---|
| `INVALID_TOKEN` | access token expired | refresh, retry once |
| `SESSION_ENDED` | another device signed in | **clear + log out + show the message** |
| `REFRESH_TOKEN_REUSED` | stale token replayed, session revoked | clear + log out |
| `ACCOUNT_BLOCKED` (403) | admin disabled the account | log out, "contact support" |

```dart
if (res.statusCode == 401) {
  final code = jsonDecode(res.body)['error']?['code'];
  if (code == 'SESSION_ENDED' || code == 'REFRESH_TOKEN_REUSED') {
    await auth.clear();
    goToLogin(message: jsonDecode(res.body)['error']['message']);
    return;                      // never refresh, never retry
  }
  if (code == 'INVALID_TOKEN') { await auth.refresh(); /* retry once */ }
}
```

**If your interceptor refreshes on every 401 it will loop** — `POST
/api/auth/refresh` returns `SESSION_ENDED` too. The student sees a spinner and
a silent logout instead of the reason.

Carry the message to the login screen and show it there, rather than a generic
"session expired".

**It is not instant.** The old device keeps working until it makes a request.
Sitting on a cached screen it sees nothing. Any real interaction hits the API,
so in practice it lands quickly — but do not promise the student an immediate
logout.

---

## What to build

**Login flow** — store the tokens, then show `notice` if present, then
navigate. Alert first, so it is not lost behind the home screen.

**A stable `deviceId`** — generated once at first launch and persisted. Not a
new uuid per session.

**One 401 handler** keyed on `error.code`, with `SESSION_ENDED` routed to
logout-with-message and never to refresh.

**Login screen** — accept an optional message argument and display it above the
sign-in button.

## Constraints

- Show `notice` verbatim; do not compose your own from the boolean.
- `notice` is `null` on a first login and on a same-device re-login.
- `previousSession` is `null` on a brand new account.
- Never refresh on `SESSION_ENDED` or `REFRESH_TOKEN_REUSED`.
- `deviceId` must survive app restarts.
