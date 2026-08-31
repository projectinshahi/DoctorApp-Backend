# Change: Test results and analytics in the admin panel

Paste this into Claude inside the **Flutter admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured from the live backend on 2026-08-31.

**Additive.** Two new endpoints. Nothing existing changed.

---

## The two endpoints

```
GET /api/admin/tests/:testId/attempts?page=1&limit=50&status=submitted
GET /api/admin/tests/:testId/analytics
```

These are the Test equivalent of the quiz detail view: who sat the paper, and
how the paper itself performed.

---

## 1. Attempts — who sat it

```
GET /api/admin/tests/1/attempts
```

Live:

```json
{
  "test": { "id": 1, "name": "Grand Test 1", "totalQuestions": 2,
            "durationMinutes": 30, "isPublished": true, "isLocked": true,
            "questionCount": 2, "attemptCount": 2, "readyToPublish": true },
  "pagination": { "page": 1, "limit": 50, "total": 2, "totalPages": 1 },
  "attempts": [
    { "attemptId": 3,
      "student": { "id": 31, "name": "Theertha bineesh14", "email": "...", "avatarUrl": null },
      "submitted": true, "startedAt": "...", "submittedAt": "...",
      "timeTakenSeconds": 8,
      "score": 2, "totalMarks": 2,
      "answeredCount": 2, "correctCount": 2, "wrongCount": 0, "skippedCount": 0 },
    { "attemptId": 1,
      "student": { "id": 30, "name": "Keerthana Bineesh", ... },
      "submitted": true, "timeTakenSeconds": 39,
      "score": 1, "totalMarks": 2,
      "answeredCount": 1, "correctCount": 1, "wrongCount": 0, "skippedCount": 1 }
  ]
}
```

Ordered by score descending. `?status=submitted` or `?status=in_progress`
filters; omit it for both.

### This is every attempt, including retakes

Unlike the student leaderboard — which shows each student's **best** attempt —
this lists them all. An admin investigating a score needs the retakes, not a
tidied summary. So one student can appear several times, and
`pagination.total` counts attempts, not students.

`timeTakenSeconds` is `null` while an attempt is still in progress. Format it
`mm:ss`, and show "in progress" rather than `00:00`.

`skippedCount` is `totalQuestions - answeredCount`, so a student who abandoned
a paper shows a large skip count rather than looking like they failed it.

**Paginate properly** — `limit` maxes at 100. A popular Grand Test will have
hundreds of rows.

---

## 2. Analytics — how the paper performed

```
GET /api/admin/tests/1/analytics
```

Live:

```json
{
  "test": { "id": 1, "name": "Grand Test 1", ... },
  "participants": 2,
  "scoreSummary": { "highest": 2, "lowest": 1, "median": 1, "totalMarks": 2 },
  "timeSummary": { "fastestSeconds": 8, "slowestSeconds": 39,
                   "medianSeconds": 23.5, "durationSeconds": 1800 },
  "questions": [
    { "testQuestionId": 1, "questionOrder": 1, "questionText": "...",
      "correctOption": "A", "subject": "Cardiology", "topic": "MI",
      "answeredCount": 2, "correctCount": 2, "skippedCount": 0,
      "correctPercent": 100,
      "optionCounts": { "A": 2, "B": 0, "C": 0, "D": 0 } },
    { "testQuestionId": 2, "questionOrder": 2,
      "correctOption": "A",
      "answeredCount": 1, "correctCount": 1, "skippedCount": 1,
      "correctPercent": 50,
      "optionCounts": { "A": 1, "B": 0, "C": 0, "D": 0 } }
  ]
}
```

`participants` counts **submitted** attempts only. `scoreSummary` and
`timeSummary` are `null` when nobody has sat it — render an empty state, not
zeros.

### The per-question table is the point of this screen

Sort it by `correctPercent` ascending and the broken questions float to the
top. **A paper where 6% got question 14 right usually means question 14 is
wrong, not that 300 students are.**

`optionCounts` says which distractor they fell for. A wrong option pulling 60%
is either a genuinely good distractor or a sign the key is wrong — show the
four counts as a small bar so an admin can tell at a glance.

### Two numbers that are computed deliberately

**Medians, not means.** One abandoned attempt scoring `-40` drags an average to
a value no actual student sat. `medianSeconds` can be a `.5` on an even count —
it is a number, not an integer.

**`correctPercent` divides by `participants`, not by `answeredCount`.** A
question nobody dared answer would otherwise read as 100% correct. In the live
data above, question 2 was answered by one of two students and correctly — it
shows **50%**, not 100%. That is the intended reading: half the cohort got it.

Compare `timeSummary.medianSeconds` against `durationSeconds` — a median near
the limit means the paper is too long for its time.

---

## What to build

**A Results tab on the test detail screen**, next to the existing Questions
preview. Two sub-views:

**Attempts table** — student name and email, submitted/in-progress, score out
of `totalMarks`, correct/wrong/skipped, time taken. Sortable, paginated, with
the status filter.

**Analytics view** — the score and time summary cards at the top, then the
per-question table sorted by `correctPercent` ascending, with the option-count
bars. Flag anything under about 30% for review.

Link a student row through to the existing student detail screen using
`student.id` — that screen already shows their overall progress.

## Constraints

- Extend the existing test detail screen; do not add a parallel section.
- `timeTakenSeconds` is **nullable** (in-progress attempts).
- `scoreSummary` and `timeSummary` are **null** with zero participants.
- `medianSeconds` and scores are **not integers** — scores go negative with
  negative marking, medians can be `.5`.
- `pagination.total` counts attempts, not students.
- Paginate; `limit` maxes at 100.
