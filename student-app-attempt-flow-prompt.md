# Change: Marrow-style quiz attempts — answer one at a time, review at the end

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` — unchanged.

This replaces the "collect every answer in memory, post once at the end" flow
with a persisted attempt. **The old `POST .../quiz-submit` still works and is
unchanged** — migrate the screen to attempts, don't rip anything out until it
runs.

---

## The flow

```
POST /api/users/me/lessons/:id/quiz-attempts        → start, get attemptId + questions
  ↓  for each question the student answers
POST /api/users/me/quiz-attempts/:attemptId/answers → save one, get ITS result back
  ↓  when they finish
POST /api/users/me/quiz-attempts/:attemptId/finish  → the review screen
```

Two extra calls for history and resume:

```
GET /api/users/me/quiz-attempts/:attemptId          → resume, or re-open a review
GET /api/users/me/lessons/:id/quiz-attempts         → past runs at this lesson
```

### Why it is server-side

Feedback per question needs the answer key, and the answer key must never reach
the app before the student commits. The server holds it, scores each answer as
it arrives, and returns only that question's result.

Persisting also means killing the app mid-quiz no longer loses the run.

---

## 1. Start

```
POST /api/users/me/lessons/38/quiz-attempts
```

**201** on a fresh start, **200** when resuming:

```json
{
  "attemptId": 7,
  "resumed": false,
  "lessonId": 38,
  "quiz": { "id": 20, "title": "Cardiology" },
  "totalQuestions": 3,
  "totalMarks": 6,
  "answered": [],
  "questions": [
    { "id": 2, "questionText": "...", "questionImageUrl": null, "difficulty": "medium",
      "marksCorrect": 2, "marksIncorrect": -0.5,
      "options": [ { "id": 5, "optionText": "...", "optionImageUrl": null, "displayOrder": 0 } ] }
  ]
}
```

No `isCorrect`, no `explanation` — the student has not answered yet.

**`resumed: true` means an unfinished attempt was picked up**, not a new one.
`answered` then holds what they already picked:

```json
"resumed": true,
"answered": [ { "questionId": 2, "selectedOptionId": 5 } ]
```

Restore those selections and drop the student at the first unanswered question.
Do **not** start a second attempt — the backend deliberately reuses the open
one, because replacing it would discard answers already given.

The question set is **frozen** when the attempt starts. Calling start again
returns the same questions.

Errors: the same gates as every lesson call — 409 select-a-course, 404, 403
wrong course, 403 locked + `requiredPlans`, 409 no quiz linked, 409 inactive.
Plus **409 `This quiz has no questions yet`** for an empty pool.

---

## 2. Answer one question

```
POST /api/users/me/quiz-attempts/7/answers
{ "questionId": 2, "optionId": 5 }
```

**200** — the result for *that question only*:

```json
{
  "attemptId": 7,
  "answeredCount": 1,
  "remainingCount": 2,
  "result": {
    "questionId": 2,
    "questionText": "...",
    "selectedOptionId": 5,
    "correctOptionId": 5,
    "isCorrect": true,
    "answered": true,
    "marksAwarded": 2,
    "explanation": "Leads II, III and aVF face the inferior wall.",
    "options": [ { "id": 5, "optionText": "...", "isCorrect": true, "displayOrder": 0 } ]
  }
}
```

This is the Marrow moment: show correct/wrong, highlight the right option, show
the explanation, then let them move on.

**Re-answering overwrites.** Posting a different `optionId` for the same
question replaces the previous answer — no error, no duplicate. Allow changing
an answer before finishing if the design wants it.

Use `remainingCount` to drive the "Finish" button.

Errors, all **400** unless noted:

| status | message | cause |
|---|---|---|
| 400 | `questionId and optionId are required` | missing or non-numeric |
| 400 | `Question 9 is not part of this attempt` | wrong attempt id |
| 400 | `Option 12 does not belong to question 2` | mismatched ids |
| 409 | `This attempt is already finished` | answering after finish |
| 404 | `Attempt not found` | wrong id, **or someone else's attempt** |

---

## 3. Finish → the review screen

```
POST /api/users/me/quiz-attempts/7/finish
```

**200**:

```json
{
  "attemptId": 7,
  "lessonId": 38,
  "quiz": { "id": 20, "title": "Cardiology" },
  "startedAt": "2026-08-28T10:14:02.117Z",
  "completedAt": "2026-08-28T10:19:44.882Z",
  "totalQuestions": 3,
  "totalMarks": 6,
  "score": 1.5,
  "correctCount": 1,
  "wrongCount": 1,
  "skippedCount": 1,
  "results": [ { "...one entry per question, same shape as `result` above..." } ]
}
```

`results` covers **every** question, including ones never answered
(`answered: false`, `selectedOptionId: null`, `marksAwarded: 0`).

**Finishing twice is safe** — it returns the same review rather than a 409, so a
retry or a back-button does not break. `completedAt` keeps its first value.

`results` is ordered by question id, **not** the order shown. Re-sort against
the order from step 1 if the review should match the quiz.

---

## 4. Resume and history

```
GET /api/users/me/quiz-attempts/7
```

Returns `completed: false` with `questions` (no answer key) and `answered`, or
`completed: true` with the full review. **Branch on `completed`** — the two
shapes differ, and an unfinished attempt deliberately withholds the answers
because the student is still taking it.

```
GET /api/users/me/lessons/38/quiz-attempts
→ { "lessonId": 38, "attempts": [
     { "attemptId": 7, "completed": true, "startedAt": "...", "completedAt": "...",
       "totalQuestions": 3, "answeredCount": 2, "correctCount": 1, "score": 1.5 } ] }
```

Newest first, summary rows only. Enough for a history list; tap through to
`GET /quiz-attempts/:id` for the detail.

On opening a quiz lesson, call `POST .../quiz-attempts` first — if it comes
back `resumed: true`, offer "Continue where you left off".

---

## Drawing a result

```dart
for (final opt in r.options) {
  if (opt.id == r.correctOptionId)       => green;   // always show the right one
  else if (opt.id == r.selectedOptionId) => red;     // only reached when wrong
  else                                   => normal;
}
```

**Check `correctOptionId` first.** A correct answer satisfies both conditions,
so reversing the branches paints it red.

Three states, not two — a skip is not a wrong answer:

- **Correct** — `isCorrect: true`. Selection green.
- **Wrong** — `answered: true, isCorrect: false`. Selection red **and** correct
  option green.
- **Skipped** — `answered: false`. Only the correct option green, and
  `marksAwarded` is `0`, so show no penalty.

---

## What to build

**Quiz intro** — title, `totalQuestions`, `totalMarks`, Start. Warn up front
when `marksIncorrect` is negative: wrong answers lose marks.

**Question screen** — one at a time, single-select. On submit, POST the answer
and render `result` inline: correct/wrong banner, the correct option
highlighted, `explanation` below. Then Next.

**Review screen** — the `finish` response. Score, the three counts, then the
list from `results` with the same three-state highlighting and explanations.

**History** (optional) — the list endpoint, if the design wants past attempts.

---

## Constraints

- Extend the existing quiz screen and service. No parallel set.
- `isCorrect` is **absent** on start and **present** on answer/finish. In a
  shared model it must be **nullable**, or parsing the start response crashes.
  Same for `explanation`.
- `score` and `marksAwarded` are genuinely negative. Render `-0.5`, not
  `--0.5`, and never take an absolute value.
- Don't cache questions across attempts — a filter quiz draws a fresh random
  set each time, and the next attempt legitimately differs.
- Keep the `attemptId` for the whole session. Every call after start needs it.
