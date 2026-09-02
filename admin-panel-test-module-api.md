# The Grand Test module — complete admin API

Paste this into Claude inside the **admin panel repo**. It replaces the
scattered test docs as the single reference.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Captured against the live database on 2026-09-01.

---

## The model, in one page

A **Quiz** is a *filter*. It stores a subject and a topic, and the questions
are drawn from the bank at serve time — a different set per student, every
time. A **Test** is a *paper*. It owns its own questions, in a fixed order, and
every student sits the same one under a server-enforced clock.

That difference is why none of the quiz screens can be reused, and why two
locks exist:

| lock | set when | stops |
|---|---|---|
| **`attemptCount > 0`** | a student *starts* | editing duration, marks, totalQuestions, courseType |
| **`isLocked`** | a student *submits* | editing questions and images |

Both exist for the same reason: `marksCorrect` is stored **per answer, at the
moment the student answers**. Change it later and one attempt is scored two
different ways. Read both flags off the test and disable controls up front,
rather than letting an admin fill a form that will 409.

`name` and `instructions` are always editable. They change nothing already
marked.

**Parts are a label, not a table.** A section exists exactly when questions
carry its name, so nothing falls out of step and no empty part survives its
last question. There is no section CRUD — you edit `section` on questions.

---

## 1. Create the shell

```
POST /api/admin/courses/:courseId/tests
{ "name": "Grand Test 3", "totalQuestions": 100, "durationMinutes": 90,
  "marksCorrect": 4, "marksIncorrect": -1,
  "courseTypeId": 20,
  "instructions": "Answer all questions. Negative marking applies." }
```

**201** → `{ "test": { ... } }`

- `courseTypeId` scopes the paper to one exam (DHA, MOHAP…). `null` means the
  whole course. Get this wrong and a DHA student is served MOHAP papers — it
  has happened.
- `marksIncorrect` must be **zero or negative**. It is added, never subtracted;
  a positive value would reward wrong answers. **400** otherwise.
- `totalQuestions` is a declaration. Publish refuses until the CSV matches it.

Every test carries `questionCount`, `attemptCount` and `readyToPublish`.

## 2. Upload images (before the CSV)

```
POST /api/admin/tests/:testId/images       multipart, field: images
```

```json
{ "uploaded": [ { "id": 4, "url": "https://res.cloudinary.com/.../ecg.svg",
                  "originalFilename": "ecg_lead_ii.svg", "bytes": 1468 } ],
  "errors": [] }
```

JPEG, PNG, WebP, **SVG**. 2MB each, 200 per request. Partial success is normal
— `errors` names the files that failed while the rest go through, so a folder
of 200 does not fail on one bad file. Status is **200** if anything uploaded,
**400** if nothing did.

Images first, because a CSV can carry a URL but not binary data. Copy `url`
into the CSV verbatim.

`GET .../images` lists them · `DELETE .../images/:imageId` removes one, and
refuses (**409**) if a question still points at it, naming which.

> Render SVGs **from the Cloudinary URL**, never inlined. An SVG can carry
> script; this is safe only because it is served from a different origin. In
> Flutter use `flutter_svg`, which does not execute script at all.

## 3. Import the paper

```
POST /api/admin/tests/:testId/questions/upload     multipart, field: file
```

```json
{ "message": "Imported 4 question(s). The test is not published yet.",
  "validRows": 4, "errors": [], "preview": [ ... ] }
```

Columns — only `correct_option` is required:

`question_order` · **`section`** · `question_text` · `question_image_url` ·
`option_a`…`option_d` · `option_a_image_url`…`option_d_image_url` ·
`correct_option` · `explanation` · `subject` · `topic`

### Images: paste a URL, or just the file name

An image cell takes **either** a full Cloudinary URL **or** the name of a file
uploaded to this test:

```csv
question_order,question_text,question_image_filename,option_a,...
1,What pattern is shown?,sample_q1.svg,Pattern A,...
2,Identify the trend.,SAMPLE_Q2.SVG,Rising,...
```

The name wins in practice. An admin uploads a folder of `q1.svg`…`q200.svg`;
pasting 200 Cloudinary URLs into a spreadsheet by hand is the step that
produces the typos this validation exists to catch.

- `question_image_filename` is an accepted alias for `question_image_url`, and
  the same for every `option_*_image_*`. Either header, either kind of value.
- Matching is **case-insensitive** — `Q1.SVG` finds `q1.svg`.
- A name that matches nothing uploaded is a **blocking** error:
  `"sample_q9.svg" is not a URL and no image with that name was uploaded to this test`
- Nothing uploaded at all says so instead, rather than "not a valid URL",
  which would send an admin hunting for a typo that is not there.
- Two uploads sharing a name **block** rather than guess — picking one silently
  would put the wrong picture on a question.

Template: [test-questions-template.csv](test-questions-template.csv)

### Three rules the upload UI must reflect

**`errors` carries a `severity`.** Entries without it block; `severity:
"warning"` do not and the row still imports. A URL outside this test's uploads
is a warning, not a block — it is usually a typo, but it is also how an
existing CDN asset is referenced. Render the two differently or an admin sees
"6 rows invalid" for a file that imported fine.

**Text OR image.** A stem can be an image alone — an ECG is often the whole
question — and so can an option. Only *neither* is an error.

**Nothing is written unless the whole file validates.** All blocking errors
come back at once; fixing a 200-row file one error per upload would take all
day.

### A count mismatch no longer blocks

```json
{ "row": 1, "field": "header", "severity": "warning",
  "message": "This test expects 5 questions and the file has 10. It will import, but the test cannot be published until the two match." }
```

The file imports. **Publish is the real gate** and still refuses with
`Cannot publish: this test expects 5 questions but has 10.` — so the paper
cannot quietly serve the wrong number either way, and the admin is not sent to
edit the test before they are allowed to look at their own file.

Offer a one-tap fix beside that warning: `PATCH /api/admin/tests/:id`
`{ "totalQuestions": 10 }`, which is allowed while nobody has attempted it.

### Importing before the images are uploaded

A filename that is not among this test's uploads **blocks** by default:

```json
{ "row": 2, "field": "question_image_url",
  "message": "No images have been uploaded to this test yet, so \"sample_q1.svg\" cannot be resolved. Upload the images first." }
```

That is right for the normal path — a question whose diagram is missing is a
broken question, and importing one silently is how a student meets it in an
exam. **Images before CSV** stays the recommended order.

For an admin building the paper text-first:

```
POST /api/admin/tests/:testId/questions/upload?allowMissingImages=true
```

Those rows import with `questionImageUrl: null`, and each one comes back as a
warning naming the question to fix:

> …Imported without an image — add it to question 3 before publishing.

Verified on a 10-row file with images on alternating rows: 5 blocking errors
without the flag, 10 questions imported with it, and after uploading the images
a plain re-import resolved every one with no errors at all.

Put it behind a checkbox on the upload screen — "Import now, add images
later" — not on by default.

`DELETE /api/admin/tests/:testId/questions` clears the paper and unpublishes
it.

## 4. Edit it — one question at a time

```
POST   /api/admin/tests/:testId/questions
PATCH  /api/admin/tests/:testId/questions/:questionId
DELETE /api/admin/tests/:testId/questions/:questionId
```

camelCase fields, matching what preview returns: `questionText`,
`questionImageUrl`, `optionA`–`optionD`, `optionAImageUrl`–`optionDImageUrl`,
`correctOption`, `explanation`, `subject`, `topic`, `section`, `questionOrder`.

- **PATCH merges** — send only what changed. `""` and `null` both clear.
- **`questionOrder` swaps.** Send a taken slot and the two exchange places —
  what dragging a row means. `{ "swapped": true }` comes back.
- **POST inserts.** Omit the order to append; give one and the tail shifts
  down. Must be ≤ `lastOrder + 1`.
- **DELETE closes the gap** — the paper stays numbered 1..n.

Create and delete return `questionCount` and `readyToPublish`, so the "97 of
100" counter stays live without a refetch.

**409 on a locked test.** Text-or-image failures are **400** with a `problems`
array of `{ field, message }` — the same rules the CSV uses, so a row the
importer accepted is always editable.

## 5. Review

```
GET /api/admin/tests/:testId/preview
```

```json
{ "test": { ..., "instructions": "..." },
  "sections": [ { "name": "Part A", "questionCount": 2,
                  "firstOrder": 1, "lastOrder": 2, "contiguous": true } ],
  "unsectionedCount": 0,
  "questions": [ ... with correctOption and explanation ... ] }
```

**The only endpoint that shows the answer key.** Students never receive it
before submitting.

- **`contiguous: false`** — that part's questions are not consecutive. The
  paper runs A, B, then A again. Almost always a reorder that went wrong, and
  invisible in a flat list. Warn on the section.
- **`unsectionedCount > 0` alongside real sections** — the paper is half
  labelled. Those questions render outside every part.

## 6. Publish

```
POST /api/admin/tests/:testId/publish     { "isPublished": true }
```

**409** unless `questionCount === totalQuestions`, with both numbers in the
body. Send `false` to pull it back — this is the safe alternative to deleting.

## 7. Edit the test itself

```
PATCH /api/admin/tests/:testId
{ "name": "...", "instructions": "...", "durationMinutes": 25, ... }
```

Once **any** student has started:

```json
409 { "error": { "message": "3 student(s) have already started this test, so only the name can be changed..." },
      "attemptCount": 3, "lockedFields": ["durationMinutes"] }
```

Editing a *published* test drops it back to draft and says so —
`"unpublished": true`. Toast it; a live paper going dark unnoticed is a support
ticket.

## 8. Results

```
GET /api/admin/tests/:testId/attempts?page=1&limit=50&status=submitted
```
Every attempt, **retakes included**. `student`, `score`, `timeTakenSeconds`,
`correctCount`, `wrongCount`, `skippedCount`. This is the attendance list.

```
GET /api/admin/tests/:testId/leaderboard?limit=100
```
One row per student — **their best attempt** — ranked, with `email` and
`attemptCount`, plus:

```json
"stats": { "highest": 2, "lowest": 1, "average": 1.5, "median": 1.5, "fastestSeconds": 8 }
```

Same ranking the students see, from the same function. Score ranks; time only
breaks ties. Ties share a rank and the next skips (`1, 2, 2, 4`) — render
`entry.rank`, never a row index. Scores can be **negative**.

`median` sits beside `average` because one abandoned zero drags a mean
somewhere no student actually sat.

Keep these as two tabs. One hides retakes on purpose; the other exists to show
them.

```
GET /api/admin/tests/:testId/analytics
```
Per question: `correctPercent`, `optionCounts` A–D, `skippedCount`. A question
everyone missed is usually a broken question, not 300 broken students.
`correctPercent` is out of everyone who **sat the paper**, so one nobody dared
answer reads as hard rather than as a perfect score.

## 9. Live invigilation

```
GET /api/admin/test-attempts/in-progress?courseId=&testId=
```

```json
{ "liveCount": 1, "expiredCount": 0,
  "attempts": [ { "student": {...}, "test": {...},
    "deadlineAt": "...", "secondsRemaining": 1524, "expired": false,
    "answeredCount": 1, "remainingCount": 9 } ] }
```

**`expired` is the field that matters.** An attempt whose time is up is only
closed when the student next touches it, so `expired: true` means they walked
away. Grey those out as Abandoned; counting them as live reports a room full of
candidates who left hours ago.

Tick `secondsRemaining` down locally and refetch every 30–60s.

## 10. Delete

```
DELETE /api/admin/tests/:testId
```
Clean when nobody has attempted it. Otherwise:

```json
409 { "attemptCount": 3, "submittedCount": 3, "canForce": true,
      "forceWith": "DELETE /api/admin/tests/1?deleteAttempts=true" }
```

Repeat with the flag and it goes, reporting `deletedAttempts` and
`deletedAnswers`.

**No undo.** Two steps in the UI: the dialog leads with **Unpublish** (keeps
every result), and delete sits behind a type-the-name confirm. Never send the
flag on the first click.

---

## Screens

**Test list** — cards from `GET /api/admin/tests?courseId=&courseTypeId=`, each
showing `questionCount / totalQuestions`, `attemptCount`, and a Draft /
Published / Locked chip.

**Wizard**, in this order: Details → Images → Upload CSV → Review → Publish.
The order is load-bearing: images before CSV, review before publish.

**Test detail tabs** — Questions · Attempts · Leaderboard · Analytics.

**Questions tab** — grouped under section headers with counts from `sections`,
a warning badge where `contiguous` is false, a banner when
`unsectionedCount > 0`. Per row: edit, move up/down, delete. All hidden when
`isLocked`.

**Live attempts page** — split Live / Abandoned by `expired`, auto-refreshing.

**Student detail** — `GET /admin/students/:id` returns `recentTestAttempts`,
each with a `leaderboard` block (`rank`, `totalParticipants`, `bestScore`).
It is `null` while an attempt is still running, and identical across a
student's retakes of the same paper — a leaderboard ranks students, not
attempts.

## Constraints

- Read `attemptCount` and `isLocked` and disable up front.
- `severity: "warning"` in CSV errors does not block.
- `questionText`, every `option*`, `section` and `instructions` are all
  **nullable**.
- Render `entry.rank`, never a row index. Scores can be negative.
- Sections are derived — no section CRUD.
- Never send `?deleteAttempts=true` from a first click.
