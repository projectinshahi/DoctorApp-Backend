# Admin panel — everything the backend added, in build order

Paste this into Claude inside the **admin panel repo**. It is the current
delta: what the server can do that the panel does not yet use.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

**All of it is deployed and live.** Captured against production on 2026-09-02.

Watch the prefix — the panel already has both:
`ApiConstant.baseUrl` = `/api` · `ApiConstant.root` = no prefix.

Already built, do not rebuild: test list, create wizard, CSV upload, image
upload, publish, and the Leaderboard / All Attempts / Analytics tabs.

---

## 1. Comment moderation — the biggest gap

Nothing exists in the panel for this yet.

```
GET    /admin/comments?status=&lessonId=&courseId=&search=&page=&limit=
GET    /admin/comments/:id                    ← one thread, whole
PATCH  /admin/comments/:id                    { "status": "hidden"|"published" }
POST   /admin/comments/:id/reply              { "body" }
PATCH  /admin/comments/:id/body               { "body" }   ← own replies only
POST   /admin/comments/:id/dismiss-reports
DELETE /admin/comments/:id
PATCH  /admin/lessons/:lessonId/comments      { "enabled": bool }
```

**Land on the Reported tab, not All.** A moderator's question is never "show me
all comments", it is *"what needs me?"*. `counts.reported` is the badge.

Five rules that decide whether the screen is any good:

- **Tabs bind to `counts`, never to `comments.length`.** `counts` is the full
  set and does not change with the filter.
- **Hiding moves the replies too**, both directions. `affectedReplies` comes
  back — put it in the toast.
- **Hide is primary, Delete is quiet.** Hide removes it from students just as
  well and is reversible. Delete is permanent.
- **Dismiss reports** is the second button on every reported row. Without it
  the only way out of the queue is to hide something undeserving.
- **`isInstructor: true`** marks the teaching side's own replies. Badge them,
  and show Edit only on those — `PATCH /body` returns **403** on a student's
  comment. Rewriting someone's words is worse than any comment they could
  leave; the tools for a bad one are hide and delete.

Reply is the point of the feature: *"I have a doubt, can you solve this"* is a
question, and a screen that can only hide and delete cannot answer it.

Full detail: `admin-panel-comment-moderation-prompt.md`

---

## 2. CSV upload — three changes to one screen

**Image cells take a file name, not just a URL.**

```csv
question_order,question_text,question_image_filename,option_a,...
1,What pattern is shown?,sample_q1.svg,Pattern A,...
```

`question_image_filename` is an alias for `question_image_url`, same for every
`option_*_image_*`. Case-insensitive. An admin with a folder of
`q1.svg`…`q200.svg` should never paste a Cloudinary URL by hand — show the
uploaded file names beside the image list so they can be copied into the sheet.

**A count mismatch no longer blocks.**

```json
{ "severity": "warning",
  "message": "This test expects 5 questions and the file has 10. It will import, but the test cannot be published until the two match." }
```

The file imports; publish still refuses. Do **not** gate the upload button on
it. Put a one-tap fix beside the warning: `PATCH /api/admin/tests/:id`
`{ "totalQuestions": 10 }`.

**A checkbox: "Import now, add images later"** → `?allowMissingImages=true`.
Unresolvable filenames then import with `questionImageUrl: null` as warnings
naming the question to fix. **Off by default** — a question whose diagram is
missing is a broken question.

### Render warnings differently from errors, or success looks like failure

`severity` is the whole distinction: entries **without** it block and nothing
was saved; `"warning"` entries did not block and the rows are in.

An import that returns `message: "Imported 10 question(s)"` **succeeded**, no
matter how many warnings came with it. Do not render warnings in the same red
error table, and do not put an error icon on the summary.

An external image URL is now **one warning per host**, not one per row:

```json
{ "row": 2, "field": "question_image_url", "severity": "warning",
  "rows": [2, 4, 6, 8, 10],
  "message": "5 rows use images from placehold.co, which were not uploaded to this test. They will import — check the URLs load. Lines: 2, 4, 6, 8, 10" }
```

`rows` carries every affected line so the panel can link to all of them from
the single row. A 200-question paper hosting its figures on a CDN used to
produce 200 identical amber lines; a wall of those on a file that imported
perfectly reads as failure.

Suggested summary line when there are no blocking errors:

> ✅ Imported 10 questions · 1 thing to check

not

> ⚠️ Imported 10 questions, 5 to check

---

## 3. Question images — upload instead of pasting a link

```
POST   /api/uploads/question-image      multipart, field: image
DELETE /api/uploads/question-image      { "publicId" }
```

```json
{ "url": "https://res.cloudinary.com/.../question_images/s2ps....svg",
  "publicId": "question_images/s2ps...", "bytes": 1468, "format": "svg" }
```

JPEG, PNG, WebP, **SVG**, 2MB. Put `url` into `questionImageUrl` or an option's
`optionImageUrl` on `POST /api/questions`.

- **Keep `publicId`**, not just the URL — it is the only handle that can delete
  the file.
- **Delete on cancel.** The upload is not tied to a question (the file goes up
  before the question has an id), so an abandoned form leaves an orphan.
- **`questionText` and `optionText` stay required.** The image is an addition,
  never a replacement — an image-only question is a **400**. (Test questions
  differ; that bank allows image-only.)
- Render from the URL with `<img>`. **Never inline SVG source** — it can carry
  script, and this is only safe because Cloudinary is a different origin.

Full detail: `admin-panel-question-image-prompt.md`

---

## 4. Question editor + sections on a test

```
POST   /api/admin/tests/:id/questions
PATCH  /api/admin/tests/:id/questions/:questionId
DELETE /api/admin/tests/:id/questions/:questionId
```

camelCase fields as `preview` returns them. PATCH merges. `questionOrder`
**swaps**. Insert shifts the tail down; delete closes the gap. All **409** on a
locked test — read `isLocked` and hide the controls.

`GET /api/admin/tests/:id/preview` also returns `sections` — group the list
under headers, and flag two things:

- **`contiguous: false`** — the paper runs Part A, Part B, Part A again.
  Almost always a reorder that went wrong, invisible in a flat list.
- **`unsectionedCount > 0`** with real sections — the paper is half labelled.

No section CRUD. A section exists exactly when questions carry its label.

---

## 5. Reordering — two lists, both endpoints already live

```
PATCH /api/chapters/:chapterId/lessons/reorder   { "lessonIds": [...] }
PUT   /api/admin/quizzes/:id/questions           { "questionIds": [...] }
```

Send the **full array in the new order**; position comes from the array index,
in one transaction.

**A video is a lesson.** One `displayOrder` sequences videos, notes and quizzes
together, so reordering from a videos-only screen renumbers the videos and
silently drops the notes and quizzes to the end of the chapter. Drag on the
full chapter list, or splice into it before sending.

**A quiz has two modes.** `mode: "filter"` samples per student, so "question 3"
differs for each of them — dragging it looks like it worked and changes
nothing. Show handles only when `mode === "manual"`.

Detail: `admin-panel-video-reorder-prompt.md`,
`admin-panel-quiz-reorder-prompt.md`

---

## 6. Test editing, live attempts, two-step delete

```
PATCH  /api/admin/tests/:id
GET    /api/admin/test-attempts/in-progress?courseId=&testId=
DELETE /api/admin/tests/:id[?deleteAttempts=true]
```

- **Edit**: once any student has started, only `name` and `instructions` change.
  Read `attemptCount` and disable the rest up front. Editing a published test
  drops it to draft — `"unpublished": true` — so toast it.
- **`instructions`** is a new field, shown to students before the timer starts.
  Multi-line, and it stays editable even when everything else is locked.
- **Live attempts**: split by **`expired`**. False is someone writing, true is
  someone who walked away. Counting both as live reports a room full of
  candidates who left hours ago.
- **Delete**: the 409 is the confirmation step. Dialog leads with **Unpublish**
  (keeps every result); delete sits behind a type-the-name confirm. Never send
  the flag on a first click.

---

## 7. Settings screen

```
GET   /admin/me           ← call on boot; 401 → login
PATCH /admin/me           { "name", "email" }
POST  /admin/me/password  { "currentPassword", "newPassword" }
```

`role` and `status` are read-only. `emailChanged: true` needs a confirm — the
email is the login and nothing logs out at that moment. Store the token from
the password response **immediately**. No "sign out everywhere" button; tokens
live until they expire and a control that quietly does nothing is worse than
none.

Detail: `admin-panel-settings-prompt.md`

---

## Build order

1. Comment moderation — nothing exists for it
2. CSV upload changes — small, and it unblocks the imports failing today
3. Question image upload
4. Test edit form + delete dialog
5. Question editor + sections
6. Reordering, both lists
7. Live attempts
8. Settings

## Constraints that apply everywhere

- `attemptCount` and `isLocked` gate the test screens. Almost every 409 in this
  module comes from one of them — read both and disable up front.
- CSV `severity: "warning"` does not block.
- Sections are derived; build no section CRUD.
- Send whole arrays to reorder endpoints, never deltas.
- Render `entry.rank`, never a row index. Scores can be negative.
- Never send `?deleteAttempts=true` from a first click.

Full endpoint reference: `admin-panel-test-module-api.md`
