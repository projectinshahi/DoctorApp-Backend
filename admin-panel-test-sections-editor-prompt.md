# Task: exam parts, instructions, and a per-question editor

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured against the live database on 2026-09-01.

---

## 1. Instructions — written once, read by both sides

A new `instructions` field on the test. Free text: rules, marking, calculator
policy, whatever the paper needs.

Set it at creation:

```
POST /api/admin/courses/22/tests
{ "name": "Grand Test 3", "totalQuestions": 4, "durationMinutes": 10,
  "marksIncorrect": -0.25,
  "instructions": "Answer all questions. Part A is Anatomy, Part B is Physiology. Negative marking applies." }
```

Or later, with `PATCH /api/admin/tests/:testId`. **It sits with `name` in the
always-editable bucket** — it changes nothing that has already been marked, so
a typo in the rules of a live paper is fixable without building a second test.
Every other field still locks the moment a student starts.

It comes back on `GET /api/admin/tests`, the preview, and — this is the point —
on the **student's** test card and start response, verified:

```json
"instructions": "Answer all questions. Part A is Anatomy, Part B is Physiology. Negative marking applies."
```

`null` on a paper that has none. Render a multi-line text area, not a single
input.

---

## 2. Parts — a label on the question, not a table

A paper is split into parts by putting a `section` on each question. There is
no section table and no section CRUD: **a section exists exactly when questions
carry its label.** Nothing to keep in step, and no empty part left behind when
its last question is deleted.

### In the CSV

One new optional column, `section`. The updated
[test-questions-template.csv](test-questions-template.csv) has it:

```csv
question_order,section,question_text,question_image_url,option_a,...
1,Part A,Which bone is the longest?,,Femur,...
2,Part A,How many cervical vertebrae?,,5,...
3,Part B,Normal resting heart rate?,,20-40,...
```

A file with no `section` column imports exactly as before — a paper with no
parts, which is what most of them are.

### Reading them back

`GET /api/admin/tests/:testId/preview` now returns them alongside the questions:

```json
{ "test": { ..., "instructions": "..." },
  "sections": [
    { "name": "Part A", "questionCount": 2, "firstOrder": 1, "lastOrder": 2, "contiguous": true },
    { "name": "Part B", "questionCount": 2, "firstOrder": 3, "lastOrder": 4, "contiguous": true }
  ],
  "unsectionedCount": 0,
  "questions": [ ... ] }
```

Two fields exist to catch a broken split:

**`contiguous: false`** means that part's questions are not consecutive — the
paper runs Part A, Part B, then Part A again. Almost always a reorder that went
wrong, and completely invisible in a flat list of questions. Show a warning row
on the section, not a silent pass.

**`unsectionedCount`** above zero *alongside* a non-empty `sections` means the
paper is half-labelled. Those questions render outside every part, and an admin
who split the paper did not mean to leave them there. Zero with no sections is
normal — that is just a paper without parts.

### Renaming a part

There is no rename endpoint, because there is no part to rename. Change the
`section` on each of its questions (§3), or re-upload the CSV. If a paper ever
needs per-part timing or per-part instructions, say so — *that* is when a
sections table earns its place.

---

## 3. The question editor

The CSV builds the paper; these fix it. A typo in question 87 of a 200-question
import should not mean re-uploading the file, which is what clearing and
re-importing actually costs once images are attached.

```
POST   /api/admin/tests/:testId/questions
PATCH  /api/admin/tests/:testId/questions/:questionId
DELETE /api/admin/tests/:testId/questions/:questionId
```

Fields, all camelCase, matching what `preview` returns:

`questionText` · `questionImageUrl` · `optionA`–`optionD` ·
`optionAImageUrl`–`optionDImageUrl` · `correctOption` · `explanation` ·
`subject` · `topic` · `section` · `questionOrder`

### Editing

PATCH is a merge — send only what changed:

```
PATCH /api/admin/tests/14/questions/238
{ "questionText": "Which is the longest bone in the human body?", "section": "Part A - Anatomy" }
```
```json
{ "question": { "id": 238, "questionOrder": 1, "section": "Part A - Anatomy",
                "questionText": "Which is the longest bone in the human body?", ... },
  "swapped": false }
```

`""` and `null` both clear an optional field.

### Reordering

Send `questionOrder`. The question already in that slot takes this one's place
— which is what dragging a row means:

```
PATCH /api/admin/tests/14/questions/241   { "questionOrder": 1 }
→ { "swapped": true }
```

### Inserting

Omit `questionOrder` to append. Give one to insert, and **everything after it
shifts down** — no renumbering by hand:

```
POST /api/admin/tests/14/questions
{ "questionOrder": 2, "section": "Part A", "questionText": "Inserted mid-paper",
  "optionA": "w", "optionB": "x", "optionC": "y", "optionD": "z", "correctOption": "C" }
```
```json
{ "question": { "id": 242, "questionOrder": 2, ... },
  "questionCount": 5, "readyToPublish": false }
```

Order must be between 1 and `lastOrder + 1`; anything else is a **400**.

### Deleting

The gap closes — the tail renumbers so the paper stays 1..n:

```json
{ "message": "Deleted question 2. The rest have been renumbered.",
  "questionCount": 4, "readyToPublish": true, "expectedQuestions": 4 }
```

### Two rules the editor must respect

**Locked papers refuse everything**, with a **409**:

> This test is locked — students have already sat it. Its questions can no
> longer be changed.

Read `isLocked` from the test and hide the edit controls rather than letting
the admin discover it on save.

**Text or image, never neither.** A stem can be an image with no text — an ECG
is often the whole question — and so can an option. But something must be
there:

```json
400 { "error": { "message": "Option B needs text or an image" },
      "problems": [ { "field": "option_b", "message": "Option B needs text or an image" } ] }
```

This is the *same function* the CSV importer uses, deliberately. An editor that
quietly refused image-only questions would be unable to edit the very questions
the importer accepted.

`readyToPublish` and `questionCount` come back on create and delete — use them
to keep the "4 of 4 questions" counter live without a refetch.

---

## 4. Who attended, and how they did

Both already exist — wire them into the test detail screen.

**`GET /api/admin/tests/:testId/attempts?page=1&limit=50&status=submitted`** —
every attempt, retakes included, with `student`, `score`, `timeTakenSeconds`,
`correctCount`, `wrongCount`, `skippedCount`. This is the attendance list.

**`GET /api/admin/tests/:testId/leaderboard?limit=100`** — one row per student,
their best attempt, ranked, plus a `stats` strip (highest, lowest, average,
median, fastest). Same ranking the students see.

Keep them as two tabs. One hides retakes on purpose; the other exists to show
them. `attemptCount` on the test card is the headline number.

---

## What to build

**Test form** — add the instructions text area. It stays enabled even when
every other field is locked.

**Question editor tab** — the question list from `preview`, grouped under
section headers with the counts from `sections`, and a warning badge on any
section where `contiguous` is false. Per row: edit, move up/down, delete. A
banner when `unsectionedCount > 0` alongside real sections.

**Question form** — every field above, with a section input that offers the
existing section names as suggestions (from `sections`) while still accepting a
new one. Text-or-image validated in the browser too, so the 400 is a backstop
rather than the first the admin hears of it.

**Locked state** — `isLocked: true` hides every edit control on the tab and
shows why.

## Constraints

- Sections are derived. Do not build section CRUD; edit the `section` field on
  questions.
- `section` and `instructions` are both nullable everywhere.
- Send only changed fields to PATCH; it merges.
- `questionOrder` on POST must be ≤ `lastOrder + 1`.
- A question or an option may be an image with no text. Do not require text.
- Nothing in this screen works on a locked test — check `isLocked` first.
