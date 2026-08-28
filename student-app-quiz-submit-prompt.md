# Change: the student app can now score a quiz and show explanations

Paste this into Claude inside the **student app repo**.

This is a **change to an existing screen**, not a new feature. The quiz screen
already fetches and renders questions. Only the *end* of the flow changes.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` — unchanged.

---

## What changed

One new endpoint exists: **`POST /api/users/me/lessons/:id/quiz-submit`**.

Previously the app had a submission seam marked with a TODO, because there was
no way to score a quiz — the answer key is stripped server-side. That seam can
now be filled in, and the results screen can be built for real.

**`GET /api/users/me/lessons/:id/quiz-questions` did not change.** Same request,
same response, still no `isCorrect` and no `explanation`. Do not touch it.

---

## 1. Keep the served question ids

The quiz screen already holds the questions from the serve call. It now also
needs their ids as a list, because the submit body carries them.

```dart
final servedIds = questions.map((q) => q.id).toList();
```

This is not optional bookkeeping. A quiz built from a subject+topic filter
picks its questions **randomly on every call**, so the server cannot work out
afterwards which ones this student was shown. Without `questionIds` the score
is still correct, but every unanswered question is invisible and
`skippedCount` comes back as 0.

---

## 2. Submit

```
POST /api/users/me/lessons/:id/quiz-submit
Content-Type: application/json

{
  "questionIds": [17, 44, 51],
  "answers": [
    { "questionId": 17, "optionId": 276 },
    { "questionId": 51, "optionId": 812 }
  ]
}
```

`answers` holds **only the questions the student actually answered.** Leave
skipped ones out entirely — do not send `optionId: null`, and do not send a
placeholder. The server works out what was skipped by comparing `answers`
against `questionIds`.

Sending an empty `answers: []` is valid and scores 0. That is a student who
skipped everything, not an error.

---

## 3. The response — everything the results screen needs

**200**:

```json
{
  "lessonId": 32,
  "quiz": { "id": 13, "title": "Gynacology" },
  "totalQuestions": 3,
  "totalMarks": 7,
  "score": 1,
  "correctCount": 1,
  "wrongCount": 1,
  "skippedCount": 1,
  "results": [
    {
      "questionId": 17,
      "questionText": "Which is the most common cause of secondary amenorrhea?",
      "questionImageUrl": null,
      "selectedOptionId": 276,
      "correctOptionId": 276,
      "isCorrect": true,
      "answered": true,
      "marksAwarded": 2,
      "explanation": "PCOS is the commonest cause in women of reproductive age.",
      "options": [
        { "id": 276, "optionText": "PCOS", "optionImageUrl": null, "isCorrect": true,  "displayOrder": 0 },
        { "id": 277, "optionText": "Pregnancy", "optionImageUrl": null, "isCorrect": false, "displayOrder": 1 }
      ]
    }
  ]
}
```

`results` is one entry per question in `questionIds`, in id order — **not** in
the order the questions were shown. If the review screen should match the quiz
order, re-sort `results` against `servedIds`.

### The fields that are new to the app

| field | meaning |
|---|---|
| `score` | achieved marks. **Can be negative** — negative marking is real |
| `totalMarks` | the perfect score, not the achieved one |
| `correctCount` / `wrongCount` / `skippedCount` | sum to `totalQuestions` |
| `results[].correctOptionId` | the answer. Use this, don't scan `options` |
| `results[].isCorrect` | this student's result for this question |
| `results[].answered` | `false` = skipped. **Distinct from wrong** |
| `results[].marksAwarded` | `marksCorrect`, `marksIncorrect`, or `0` if skipped |
| `results[].explanation` | nullable — plenty of questions have none |
| `results[].options[].isCorrect` | now present, because the quiz is over |

**`options` here carries `isCorrect`, unlike the serve response.** If the app
reuses one question model for both calls, `isCorrect` must be **nullable** or
parsing the serve response will crash.

---

## 4. Three states per question on the review screen

A skipped question is **not** a wrong question. Treat them separately or the
review lies to the student:

- **Correct** — `isCorrect: true`. Highlight `selectedOptionId` green.
- **Wrong** — `answered: true, isCorrect: false`. Highlight `selectedOptionId`
  red **and** `correctOptionId` green, so the student sees both.
- **Skipped** — `answered: false`, `selectedOptionId: null`. Highlight only
  `correctOptionId`. Marks are `0`, so do not render a penalty.

Show `explanation` under each question when it is non-null. Do not reserve
layout space for it — many questions have none.

---

## 5. Errors

The submit endpoint runs the **same access gates** as the serve, so every error
the quiz screen already handles can come back here too — 409 select-a-course,
404 lesson not found, 403 wrong course, 403 locked + `requiredPlans`, 409 no
quiz linked, 409 quiz inactive. Reuse that handling as-is.

Three are new and specific to submitting, all **400**:

| body | cause |
|---|---|
| `answers must be an array of { questionId, optionId }` | `answers` missing or not a list |
| `Not part of this quiz: question 44` | a stale `questionIds` — the quiz changed since the serve |
| `Option 812 does not belong to question 17` | mismatched ids in `answers` |

The middle one is the one that will actually happen: an admin edits the quiz
while a student has it open. Treat it as recoverable — tell the student the
quiz changed and re-fetch the questions, rather than showing a generic failure.

All errors are `{ "error": { "message": "..." } }`.

---

## What has NOT changed

- The serve endpoint, its response, and its gates.
- Lesson detail, `locked`, `requiredPlans`, the paywall flow.
- Auth and token handling.
- **Nothing is saved.** There is no attempt history and no past-results screen.
  Re-submitting the same answers just re-scores them. Do not build a history
  list, and do not show "your previous attempt" — there is no endpoint for it.
  Hold the result in memory for the session and let it go.

## Constraints

- Extend the existing quiz screen and service. Do not add a parallel set.
- Remove the `TODO(attempts)` seam — it is implemented now.
- `marksAwarded` and `score` are genuinely negative for wrong answers. Render
  `-0.5`, not `--0.5`, and never take an absolute value.
- Do not cache the result. A filter quiz resolves fresh each time and the next
  attempt legitimately contains different questions.
