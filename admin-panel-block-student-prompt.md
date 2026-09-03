# Task: deactivate a student from the detail screen

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>`.

**No backend work is needed.** Blocking already signs the student out
everywhere. Everything below was run against the live server on 2026-09-02.

---

## One call does both

```
PATCH /admin/students/:id/status
{ "status": "blocked" }
```

```json
{ "student": { "id": 38, "name": "Block Test", "email": "...",
               "status": "blocked", "isBlocked": true },
  "sessionsRevoked": 1 }
```

`status` is one of `verified` · `unverified` · `blocked`.

**`sessionsRevoked` is the count of devices signed out by this action.** Put it
in the toast — "Blocked. Signed out of 1 device." — so the admin can see the
block actually took effect rather than trusting it did.

It is `0` when the student was not signed in anywhere, which is normal, not a
failure.

## What happens to the student, verified

```
before block   GET /home                    → 200
PATCH status blocked                        → sessionsRevoked: 1
after block    GET /home (stored token)     → 403 ACCOUNT_BLOCKED
               "Your account has been blocked. Please contact support."
               tries to sign in again        → 403 ACCOUNT_BLOCKED
PATCH status verified                        → sessionsRevoked: 0
               signs in                      → 200
```

Three things worth knowing:

**It is immediate.** The session row is revoked and the middleware reloads it
on every request, so the student's stored token stops working on their very
next call — it does not wait for the token to expire.

**They cannot sign back in.** Login refuses a blocked account with the same
403, so blocking is not something a student can undo by logging in again.

**They are told the right reason.** The block is checked *before* the
"signed in elsewhere" check, so a blocked student sees "your account has been
blocked", not "you were signed out because your account was accessed on another
device". Do not change that ordering.

## Unblocking

```
PATCH /admin/students/:id/status   { "status": "verified" }
```

Returns `sessionsRevoked: 0` — there is nothing left to revoke, blocking
already did it. The student signs in normally afterwards.

Unblocking does **not** restore their old session; they log in again. That is
correct — the token was invalidated, not paused.

---

## Related: signing a student out without blocking them

```
POST /admin/students/:id/sessions/revoke
```

Same sign-out, no block. This is the one to use when a student is locked out by
the single-device rule after losing a phone — not the block button.

```json
{ "message": "Signed out 1 device(s). They can sign in again straight away.",
  "revoked": 1,
  "sessions": [ { "id": 91, "deviceId": "PHONE-A", "lastSeenAt": "..." } ] }
```

Keep the two visually apart. Blocking is a punishment; signing out is help.

---

## What to build

**Student detail header** — a status chip (Active / Blocked / Unverified) and
two buttons:

- **Block** — destructive styling, confirm dialog naming the student. On
  success, flip the chip from `student.status` and toast with
  `sessionsRevoked`.
- **Sign out all devices** — plain styling, light confirm. Not destructive; the
  student signs straight back in.

**A blocked student's row** — show the chip in the student list too, from the
existing `status` field, so an admin does not have to open each one.

**Session line** — `GET /admin/students/:id` returns `isLoggedIn`,
`currentDeviceId`, `lastLoginAt` and `lastSeenAt`. Render them as one line:
"Signed in on PHONE-A · last active 4 minutes ago", or "Not signed in".
`lastSeenAt` is what decides whether a second device is refused, so it is the
field that answers "why can't I log in?".

## Constraints

- Send `blocked`, not `inactive` or `disabled` — the API takes exactly
  `verified`, `unverified`, `blocked` and 400s otherwise.
- Report `sessionsRevoked`; do not assume the count.
- Do not use Block to fix a locked-out student — that is
  `POST /sessions/revoke`.
- Re-read `student.status` from the response rather than toggling a local flag.
