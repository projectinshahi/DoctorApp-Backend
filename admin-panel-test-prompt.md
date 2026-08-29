# Task: build the Grand Test section in the Flutter admin panel

Paste this into Claude inside the **Flutter admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured from the live backend on 2026-08-29.

---

## What a Test is, and how it differs from a Quiz

The panel already has a Quiz section. **Do not reuse its screens.** A Quiz and a
Test are different objects with different rules:

| | Quiz | Test |
|---|---|---|
| where questions come from | the shared bank, via a subject/topic filter | uploaded CSV, owned by that test |
| what students see | a random draw, different per student | the same fixed paper for everyone |
| editing questions | any time | **frozen once anyone has attempted** |
| timer | none | server-enforced `durationMinutes` |
| feedback | per question, immediately | only after submit |

A Test is an exam paper. Build it as its own section.

---

## The workflow — four steps, in order

```
1. create the shell        POST /api/admin/courses/:courseId/tests
2. upload the CSV          POST /api/admin/tests/:testId/questions/upload
3. review                  GET  /api/admin/tests/:testId/preview
4. publish                 POST /api/admin/tests/:testId/publish
```

**Upload never publishes.** That is deliberate: a paper that goes live the moment
a file lands has no point at which anyone can check it. Build the UI as a
four-step wizard, not a single form.

---

## 1. Create the shell

```
POST /api/admin/courses/22/tests
{ "name": "Grand Test 1", "type": "GRAND_TEST",
  "totalQuestions": 200, "durationMinutes": 180,
  "marksCorrect": 1, "marksIncorrect": -0.25 }
```

**201**:

```json
{ "test": {
    "id": 1, "courseId": 22, "name": "Grand Test 1", "type": "GRAND_TEST",
    "totalQuestions": 200, "durationMinutes": 180,
    "marksCorrect": 1, "marksIncorrect": -0.25,
    "isPublished": false, "isLocked": false,
    "questionCount": 0, "attemptCount": 0, "readyToPublish": false,
    "createdAt": "...", "updatedAt": "..." } }
```

| field | rule |
|---|---|
| `name` | required, non-empty |
| `type` | `GRAND_TEST` only, for now. Send it anyway — more types are coming |
| `totalQuestions` | required positive integer. **The CSV must match it exactly** |
| `durationMinutes` | required positive integer |
| `marksCorrect` | defaults to `1` |
| `marksIncorrect` | defaults to `0`. **Must be zero or negative** — `0.25` is rejected, `-0.25` is right |

That last rule catches the mistake that would otherwise reward wrong answers.
Make the form field say "negative marks (e.g. -0.25)" and validate the sign
before submitting.

`totalQuestions` is the contract for the whole workflow — the upload is blocked
if the file has a different number of rows, and publish is blocked if the stored
count does not match. Explain that next to the field.

---

## 2. Upload the CSV

```
POST /api/admin/tests/1/questions/upload
Content-Type: multipart/form-data
file: <the .csv>
```

Field name is **`file`**. Max 5 MB.

### Columns

```
question_order,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,subject,topic
```

Required: `question_text`, `option_a`–`option_d`, `correct_option`.
Optional: `question_order` (falls back to row position), `explanation`,
`subject`, `topic`, `question_image`.

Header matching is case-insensitive and trimmed. Excel's BOM is handled.
Quoted fields, embedded commas and newlines, and `""` escapes all work — a stem
like `"A 60-year-old man, previously well"` imports intact.

Offer a template download. There is a working example in the backend repo at
`test-questions-template.csv`.

### Success — 200

```json
{ "message": "Imported 2 question(s). The test is not published yet.",
  "validRows": 2, "errors": [],
  "preview": [ { "id": 1, "questionOrder": 1, "questionText": "...",
                 "optionA": "Inferior wall", "correctOption": "A", "explanation": "..." } ] }
```

`preview` is the **first 5 rows only** — enough to confirm the columns landed in
the right place. For the whole paper use the preview endpoint.

Still `isPublished: false`. Say so in the success message.

### Failure — 400, and this is the important screen

Two different shapes:

**Wrong row count:**
```json
{ "error": { "message": "This test expects 2 questions, the file has 3. Fix the file, or change the test's totalQuestions." },
  "expected": 2, "received": 3, "validRows": 3, "errors": [] }
```

**Invalid rows:**
```json
{ "error": { "message": "2 row(s) are invalid. Nothing was saved." },
  "validRows": 0,
  "errors": [
    { "row": 2, "field": "option_b", "message": "Option B is empty" },
    { "row": 3, "field": "correct_option", "message": "\"Z\" must be one of A, B, C, D" }
  ] }
```

**Render `errors` as a scrollable table: Row · Field · Message.** Every problem
in the file comes back at once, on purpose — an admin fixing a 200-row file one
error per upload would be there all afternoon. Do not show only the first, and
do not collapse them into one "invalid file" message.

**`row` is the physical line number in the CSV**, so "row 147" is line 147 in
their spreadsheet. Say "line 147" in the UI; that is what they will look for.

### Warnings

An entry with `"severity": "warning"` did **not** block the import:

```json
{ "row": 5, "field": "question_text", "severity": "warning",
  "message": "Same text as line 3" }
```

Duplicate question text is usually a copy-paste slip but can be intentional, so
it is reported and allowed. Show warnings in amber, separate from errors, and
never let one block the Continue button.

### Refusals — 409

```
"This test is locked — students have already attempted it. Its questions can no longer be changed."
"This test is published and already has questions. Unpublish or clear its questions first, then re-upload."
```

The second is recoverable — offer a **"Clear & re-upload"** button that calls the
DELETE below.

---

## 3. Review before publishing

```
GET /api/admin/tests/1/preview
→ { "test": { ...same shape as create... },
    "questions": [ { "id": 1, "questionOrder": 1, "questionText": "...",
                     "optionA": "...", "optionB": "...", "optionC": "...", "optionD": "...",
                     "correctOption": "A", "explanation": "...",
                     "subject": "Cardiology", "topic": "MI" } ] }
```

The full paper **with answers**. This is the only place they are visible to an
admin. Show all questions with the correct option highlighted.

---

## 4. Publish

```
POST /api/admin/tests/1/publish     { "isPublished": true }
```

`isPublished` defaults to `true` if the body is empty. Send `false` to unpublish.

**409 if the paper is short:**
```json
{ "error": { "message": "Cannot publish: this test expects 2 questions but has 0." },
  "expected": 2, "actual": 0 }
```

Use `readyToPublish` (on every test object) to enable or disable the button
rather than waiting for the 409.

---

## Clear & re-upload

```
DELETE /api/admin/tests/1/questions
→ 200 { "message": "Removed 2 question(s). The test is now unpublished.", "removed": 2 }
→ 409 if locked
```

**It unpublishes as a side effect** — a published test with no questions would be
a broken row in the student's list. Say that in the confirm dialog: *"This
removes all 200 questions and unpublishes the test."*

---

## The test list

```
GET /api/admin/tests?courseId=22&type=GRAND_TEST&isPublished=true
→ { "tests": [ ...test objects... ] }
```

All filters optional, combined with AND. Newest first. Not paginated.

### The three flags drive the whole UI

| flag | meaning | what the row shows |
|---|---|---|
| `isPublished: false` + `questionCount: 0` | shell only | **Draft** — "Upload questions" |
| `isPublished: false` + `readyToPublish: true` | uploaded, unreviewed | **Ready** — "Review & publish" |
| `isPublished: true` | live | **Published** — "Unpublish" |
| `isLocked: true` | someone has sat it | **Locked** badge, editing disabled |

**`isLocked` is permanent and cannot be undone.** Once a student submits an
attempt, the paper is frozen so their score cannot be rewritten by a later edit.
Disable Upload, Clear, and any edit control on a locked test, and explain why on
hover — an admin who does not know will keep clicking and getting 409s.

`questionCount` vs `totalQuestions` is worth showing as "148 / 200" on any test
that is not `readyToPublish`.

---

## What to build

**Test list** — per course, with the status chips above and a "New test" button.

**Create dialog** — the six fields, with the negative-marks sign check and a
note that `totalQuestions` must match the CSV.

**Upload step** — file picker, template download link, and the error table.
Upload is not the end of the flow: on success, move the admin to Review.

**Preview screen** — the full paper with correct answers highlighted, and a
Publish button gated on `readyToPublish`.

**Locked state** — a clear badge and disabled controls, not silent 409s.

## Constraints

- Do not reuse the Quiz screens, models, or services. Different object,
  different rules; sharing them will leak filter behaviour into an exam.
- `marksIncorrect` is negative. Never `abs()`, never render `--0.25`.
- Multipart field name is exactly `file`.
- All errors are `{ "error": { "message": "..." } }`, sometimes with the extra
  keys shown above. Surface `error.message` — it is written to be read by a human.
