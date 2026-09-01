# Task: build the Settings screen (admin account)

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request below.

Every response was captured against the live backend on 2026-09-01.

---

## Three endpoints

| | |
|---|---|
| `GET /admin/me` | the signed-in admin's account |
| `PATCH /admin/me` | change name / email |
| `POST /admin/me/password` | change password |

Note the prefix: **`/admin`**, not `/api/admin`. Login stays where it is —
`POST /api/auth/admin/login`.

---

## 1. `GET /admin/me`

```json
{ "admin": { "id": 1, "email": "admin@yourapp.com", "name": "Super Admin",
             "role": "admin", "status": "active",
             "createdAt": "2026-08-04T05:54:29.621Z",
             "updatedAt": "2026-09-01T05:21:01.652Z" } }
```

Fill the settings form from this, and **call it once when the panel boots**. It
is the cheapest way to find out a stored token is still good: a `401` here
means send them to the login screen, before they lose work in a form.

Two failures worth handling separately:

- **401** `This admin account no longer exists` — the token verified but the
  row is gone. Clear the token, go to login.
- **403** `Admin account is not active` — the account was disabled. Say that,
  do not silently retry.

---

## 2. `PATCH /admin/me`

```
PATCH /admin/me
{ "name": "Super Admin", "email": "admin@yourapp.com" }
```

Both optional; send only what changed.

```json
{ "admin": { "id": 1, "email": "admin@yourapp.com", "name": "Super Admin", ... },
  "emailChanged": false }
```

### `emailChanged` needs a confirm dialog

**The email is the login.** An admin who edits it and does not register that
fact cannot get back in tomorrow. Confirm before sending — *"You'll sign in
with newemail@x.com from now on"* — and toast it again on the way back when
`emailChanged: true`.

The token stays valid, so nothing logs them out at that moment. That is exactly
why the warning matters: the consequence lands at the next login, hours later.

### `role` and `status` are not editable here

They are the two fields that decide what the account may do. A stolen token
must not be able to promote itself or reactivate a disabled account, so the
endpoint ignores them. Render them as read-only text, not as inputs.

### Errors

| body | response |
|---|---|
| `{"email": "not-an-email"}` | **400** `Enter a valid email address` |
| `{"email": "<taken>"}` | **409** `Another admin already uses that email` |
| `{"name": 42}` | **400** `name must be text` |
| `{}` | **400** `Nothing to update` |

`{"name": ""}` and `{"name": null}` both clear the name — that is allowed, the
field is optional. Email is lowercased and trimmed on the way in.

---

## 3. `POST /admin/me/password`

```
POST /admin/me/password
{ "currentPassword": "OldPass12345", "newPassword": "NewPass67890" }
```

```json
{ "message": "Password changed",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "admin": { "id": 1, "email": "...", "name": "...", "role": "admin" } }
```

### Store the returned token immediately

It is a **fresh 8-hour token**, so the admin carries on working instead of
being bounced to the login screen mid-task. Overwrite whatever you have stored
before you render the success message — a panel that shows "Password changed"
and then 401s on the next click looks broken.

### The current password is required

Even though the caller already holds a valid token. A session left open on a
shared machine is precisely the case this guards, and it is the one moment
where proving who is at the keyboard costs nothing.

| body | response |
|---|---|
| wrong `currentPassword` | **401** `Your current password is incorrect` |
| `newPassword` under 8 chars | **400** `New password must be at least 8 characters` |
| new same as current | **400** `The new password must be different from the current one` |
| either field missing | **400** `currentPassword and newPassword are required` |

Show the 401 **under the current-password field**, not as a page-level banner.
The wording says which field is wrong on purpose — this admin is already
logged in, so "invalid credentials" would tell them nothing.

Verified end to end: after the change, login with the new password succeeds and
the old password returns **401**.

### One limitation to know

Tokens minted **before** the change stay valid until they expire — up to 8
hours. Admin auth is stateless, so there is no session record to revoke.

That is fine for *"I want a better password"*. It is **not** enough for *"my
password leaked"* — in that case the old session is still live. If that ever
matters, say so and it becomes a `tokenVersion` column checked at auth time.

Do not put a "sign out everywhere" button on this screen. It would not work,
and a security control that quietly does nothing is worse than none.

---

## What to build

**Settings page**, two cards:

1. **Profile** — name and email inputs, role and status as read-only text,
   "Member since" from `createdAt`. Save calls `PATCH /admin/me`. Confirm the
   email change before sending.

2. **Password** — current, new, confirm-new. Confirm-new is checked in the
   browser (the API only takes two fields). On success, swap the stored token,
   clear all three inputs, and toast.

**Boot check** — `GET /admin/me` on app load. 401 or 403 goes to login.

**Header** — show `admin.name ?? admin.email` from the same response instead of
decoding the JWT.

## Constraints

- The prefix is `/admin/me`, not `/api/admin/me`.
- Persist the new token from the password response before anything else.
- Confirm an email change; it is the login.
- `role` and `status` are read-only — the API will not accept them.
- `name` is nullable. Fall back to the email in the header.
- No "log out all devices" button; the backend cannot honour it.
