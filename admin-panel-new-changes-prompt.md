# Task: the six admin panel changes from the latest backend build

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Full endpoint reference:
[admin-panel-test-module-api.md](admin-panel-test-module-api.md). This file is
only the **delta** — what to build now.

**Nothing here works until the backend deploy lands.** Every endpoint below
returns 404 on the old build. That is the "server does not have this endpoint"
message, not a bug in the panel.

Already built, do not rebuild: the test list, the create wizard, CSV upload,
image upload, publish, and the Leaderboard / All Attempts / Analytics tabs.

---

## 1. Instructions on the test form

A new `instructions` field — free text the admin writes once, read by the
panel **and shown to students before the timer starts**.

```
POST  /api/admin/courses/:courseId/tests   { ..., "instructions": "..." }
PATCH /api/admin/tests/:testId             { "instructions": "..." }
```

Comes back on every test object, `null` when unset.

Multi-line text area, not a single input. **It stays enabled even when every
other field is locked** — it changes nothing already marked, so a typo in the
rules of a live paper must be fixable without building a second test.

---

## 2. Edit an existing test

```
PATCH /api/admin/tests/:testId
{ "name", "instructions", "type", "courseTypeId",
  "totalQuestions", "durationMinutes", "marksCorrect", "marksIncorrect" }
```

All optional; send only what changed.

**One rule the form must enforce before the request:** once any student has
started, only `name` and `instructions` can change.

```json
409 { "error": { "message": "3 student(s) have already started this test, so only the name can be changed..." },
      "attemptCount": 3, "lockedFields": ["durationMinutes"] }
```

So read `attemptCount` off the test and disable those six fields when it is
above zero, with a line under the form saying why. An admin should never fill
in a form that is going to 409.

**Editing a published test drops it to draft** and says so:

```json
{ "test": { ..., "isPublished": false }, "unpublished": true }
```

Toast that. A live paper going dark unnoticed is a support ticket.

Other errors, all **400** except where noted: empty `name`; `marksIncorrect`
above zero; `marksCorrect` at or below zero; a `courseTypeId` from another
course; `{}` → `Nothing to update`. **409** if `totalQuestions` is dropped
below the questions already imported.

---

## 3. Question editor tab

The biggest addition. The CSV builds the paper; this fixes it — a typo in
question 87 of a 200-question import should not mean re-uploading the file.

```
GET    /api/admin/tests/:testId/preview
POST   /api/admin/tests/:testId/questions
PATCH  /api/admin/tests/:testId/questions/:questionId
DELETE /api/admin/tests/:testId/questions/:questionId
```

Fields are camelCase, exactly as `preview` returns them: `questionText`,
`questionImageUrl`, `optionA`–`optionD`,
`optionAImageUrl`–`optionDImageUrl`, `correctOption`, `explanation`,
`subject`, `topic`, `section`, `questionOrder`.

- **PATCH merges** — send only changed fields. `""` and `null` both clear.
- **Reorder**: send `questionOrder`. The question in that slot swaps places
  with this one → `{ "swapped": true }`. That is what dragging a row means.
- **Insert**: omit `questionOrder` to append, or give one and everything after
  shifts down. Must be ≤ `lastOrder + 1`, else **400**.
- **Delete**: the gap closes, the tail renumbers, the paper stays 1..n.

POST and DELETE return `questionCount` and `readyToPublish` — keep the
"97 of 100" counter live from those, no refetch.

### Two rules

**A locked test refuses all three**, with **409**:

> This test is locked — students have already sat it. Its questions can no
> longer be changed.

Read `isLocked` and hide the edit controls. Do not let the admin find out on
save.

**Text or image, never neither.** A stem can be an image alone — an ECG is
often the whole question — and so can an option:

```json
400 { "error": { "message": "Option B needs text or an image" },
      "problems": [ { "field": "option_b", "message": "Option B needs text or an image" } ] }
```

Mirror that check in the form so the 400 is a backstop. Do **not** mark the
text fields required — that would make the image-only questions the CSV
accepts uneditable.

---

## 4. Sections in the question list

Parts of a paper are a `section` label on each question. There is no sections
table and **no section CRUD** — a section exists exactly when questions carry
its name. Rename a part by editing `section` on its questions.

`GET /api/admin/tests/:testId/preview` now returns:

```json
{ "sections": [ { "name": "Part A", "questionCount": 2,
                  "firstOrder": 1, "lastOrder": 2, "contiguous": true } ],
  "unsectionedCount": 0,
  "questions": [ { ..., "section": "Part A" } ] }
```

Group the question list under section headers using these counts. Two flags
exist to catch a broken split:

- **`contiguous: false`** — that part's questions are not consecutive. The
  paper runs Part A, Part B, then Part A again. Almost always a reorder that
  went wrong, and completely invisible in a flat list. Warning badge on the
  section.
- **`unsectionedCount > 0` while `sections` is non-empty** — the paper is half
  labelled and those questions render outside every part. Banner above the
  list. Zero sections with a non-zero count is normal: that is just a paper
  with no parts.

The section input on the question form should suggest existing names from
`sections` while still accepting a new one.

CSV: one new optional column, `section`. Updated template at
[test-questions-template.csv](test-questions-template.csv). A file without it
imports exactly as before.

---

## 4b. Image cells accept a file name

An image cell now takes a full URL **or** the name of a file uploaded to this
test, and `question_image_filename` works as an alias for
`question_image_url` (same for every `option_*_image_*`).

```csv
question_order,question_text,question_image_filename,option_a,...
1,What pattern is shown?,sample_q1.svg,Pattern A,...
```

Matching is case-insensitive. An unknown name blocks with a message naming it;
two uploads sharing a name block rather than guess.

In the upload screen, say this on the help text — an admin with a folder of
`q1.svg`…`q200.svg` should never be pasting Cloudinary URLs by hand. Show the
uploaded file names next to the image list so they can be copied into the
sheet.

---

## 5. Live attempts page

```
GET /api/admin/test-attempts/in-progress?courseId=&testId=&page=1&limit=50
```

```json
{ "liveCount": 1, "expiredCount": 0,
  "pagination": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 },
  "attempts": [ {
    "attemptId": 6,
    "student": { "id": 30, "name": "Keerthana Bineesh", "email": "...", "avatarUrl": null },
    "test": { "id": 10, "name": "test 1", "totalQuestions": 10, "durationMinutes": 30 },
    "startedAt": "...", "deadlineAt": "...",
    "secondsRemaining": 1524, "expired": false,
    "answeredCount": 1, "remainingCount": 9 } ] }
```

**`expired` is the field that decides the row.** An attempt whose time is up is
only closed when the student next touches it, so this list holds two different
things:

- `expired: false` → someone is writing. `secondsRemaining` as a live `mm:ss`,
  a progress bar from `answeredCount / totalQuestions`.
- `expired: true` → they walked away; it submits itself on their next request.
  Grey, labelled **Abandoned**.

Rendering both as "in progress" would report a room full of candidates who left
hours ago.

Tick the clock down locally, refetch every 30–60s. Link each row to the student
detail.

---

## 6. Two-step delete

```
DELETE /api/admin/tests/:testId
```

Clean when nobody has attempted it. Otherwise:

```json
409 { "error": { "message": "Cannot delete: 3 student attempt(s) exist, 3 of them completed. Unpublish it instead — deleting erases their results permanently." },
      "attemptCount": 3, "submittedCount": 3, "canForce": true,
      "forceWith": "DELETE /api/admin/tests/1?deleteAttempts=true" }
```

Treat that 409 as the confirmation step, not an error. The dialog:

- quotes `attemptCount` and `submittedCount`
- **primary button is Unpublish** (`POST .../publish` with
  `{"isPublished": false}`) — it hides the paper from students and keeps every
  result, which is what is wanted nine times out of ten
- delete sits behind a secondary, destructive-styled button that requires
  typing the test name

Then repeat with `?deleteAttempts=true`:

```json
{ "message": "Deleted \"test 1\" with 10 question(s) and 0 image(s). This also erased 2 student attempt(s) and 14 answer(s).",
  "deletedAttempts": 2, "deletedAnswers": 14 }
```

Report those counts in the toast. **Never send the flag on a first click** —
there is no undo, no soft delete, no archive.

---

## 7. Settings screen (separate from tests)

Prefix is **`/admin`**, not `/api/admin`.

```
GET   /admin/me
PATCH /admin/me              { "name", "email" }
POST  /admin/me/password     { "currentPassword", "newPassword" }
```

Two cards: **Profile** (name, email; `role` and `status` read-only — the API
refuses them, since a stolen token must not promote itself) and **Password**
(current, new, confirm — confirm is checked in the browser, the API takes two
fields).

Three things that matter:

- **`GET /admin/me` on app boot.** A 401 sends them to login before they lose
  work in a form. 403 means the account was disabled — say so, do not retry.
- **`emailChanged: true` needs a confirm dialog.** The email is the login, and
  nothing logs out at that moment, so the consequence lands at the next login
  hours later.
- **Store the token from the password response immediately.** It is a fresh 8h
  token. A panel that shows "Password changed" and then 401s on the next click
  looks broken.

Password errors: **401** `Your current password is incorrect` (show it under
that field, not as a page banner) · **400** under 8 characters · **400** same
as current.

**No "sign out everywhere" button.** Tokens issued before a password change
stay valid until they expire — admin auth is stateless, there is no session to
revoke. A security control that quietly does nothing is worse than none.

---

## Build order

1. Instructions field (smallest, and the student app needs it)
2. Edit test form — `attemptCount` gating
3. Two-step delete dialog
4. Question editor tab + sections
5. Live attempts page
6. Settings screen

## Constraints

- Read `attemptCount` and `isLocked` and disable controls up front. Almost
  every 409 in this module comes from one of them.
- Sections are derived — build no section CRUD.
- `questionText`, every `option*`, `section` and `instructions` are all
  **nullable**. Do not mark them required.
- Send only changed fields to PATCH; it merges.
- Never send `?deleteAttempts=true` from a first click.
