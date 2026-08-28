# Student quiz API — complete reference for the Flutter app

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every call.

All three endpoints are **live on Render** and every response below was captured
from it, not written by hand.

---

## How it works

Three calls, in order. The important part is **where the answer key lives**.

```
  GET  /api/users/me/lessons/:id              ← is this lesson a quiz?
        ↓  lesson.type == "quiz"
  GET  /api/users/me/lessons/:id/quiz-questions   ← questions, NO answers
        ↓  student picks options
  POST /api/users/me/lessons/:id/quiz-submit      ← answers come back HERE
```

The serve call deliberately contains **no** `isCorrect`, **no** `explanation`,
**no** `correctOptionId`. It is stripped at the database query, so the answer
key is never even loaded on a student request.

The app therefore **cannot mark its own answers**. It sends the selections to
the server, the server scores them, and the correct options and explanations
come back in that response. This is not an inconvenience to work around — if
the serve carried `isCorrect`, anyone could open the response in a proxy and
read every correct option before choosing.

---

## 1. Is this lesson a quiz?

```
GET /api/users/me/lessons/32
```

```json
{
  "lesson": {
    "id": 32, "title": "Gynacology", "type": "quiz",
    "videoUrl": null, "noteUrl": null,
    "quizId": 13,
    "quiz": { "id": 13, "title": "Gynacology", "questionCount": 2, "status": "active" },
    "locked": false,
    "plans": [], "planIds": []
  },
  "requiredPlans": [], "requiredPlan": null, "unlockOptions": []
}
```

Branch on `lesson.type == "quiz"` exactly as you already branch on `"video"`.

`quiz` is `null` when the lesson is locked — the backend strips it alongside
`videoUrl`. Treat `locked: true` as you do for video: show the paywall from
`requiredPlans`, and **do not call the questions endpoint**.

---

## 2. Get the questions

```
GET /api/users/me/lessons/32/quiz-questions
```

```json
{
  "lessonId": 32,
  "quiz": { "id": 13, "title": "Gynacology", "questionCount": 2 },
  "totalQuestions": 2,
  "totalMarks": 4,
  "questions": [
    {
      "id": 17,
      "questionText": "Which is the most common cause of secondary amenorrhea in a woman of reproductive age?",
      "questionImageUrl": null,
      "difficulty": "medium",
      "marksCorrect": 2,
      "marksIncorrect": -0.5,
      "options": [
        { "id": 276, "optionText": "Pregnancy",       "optionImageUrl": null, "displayOrder": 0 },
        { "id": 277, "optionText": "Menopause",       "optionImageUrl": null, "displayOrder": 1 },
        { "id": 278, "optionText": "Turner syndrome", "optionImageUrl": null, "displayOrder": 2 }
      ]
    }
  ]
}
```

**Keep the question ids.** Step 3 needs them:

```dart
final servedIds = questions.map((q) => q.id).toList();
```

Not optional bookkeeping. A quiz built from a subject+topic filter picks its
questions **randomly on every call**, so the server cannot work out afterwards
which ones this student saw. Without `questionIds` the score is still right,
but skipped questions are invisible and `skippedCount` comes back `0`.

Options arrive sorted by `displayOrder`. Don't re-sort, don't shuffle.

`marksIncorrect` is genuinely negative (`-0.5`). Never take an absolute value,
and render it `-0.5`, not `--0.5`.

---

## 3. Submit and get the answers

```
POST /api/users/me/lessons/32/quiz-submit
Content-Type: application/json

{
  "questionIds": [17, 44],
  "answers": [ { "questionId": 17, "optionId": 277 } ]
}
```

`answers` holds **only what the student actually answered.** Leave skipped
questions out entirely — no `optionId: null`, no placeholder. The server works
out the skips by comparing `answers` against `questionIds`.

`"answers": []` is valid and scores 0. That is a student who skipped
everything, not an error.

### Response — live, student picked 277 (wrong)

```json
{
  "lessonId": 32,
  "quiz": { "id": 13, "title": "Gynacology" },
  "totalQuestions": 1,
  "totalMarks": 2,
  "score": -0.5,
  "correctCount": 0,
  "wrongCount": 1,
  "skippedCount": 0,
  "results": [
    {
      "questionId": 17,
      "questionText": "Which is the most common cause of secondary amenorrhea...",
      "questionImageUrl": null,
      "selectedOptionId": 277,
      "correctOptionId": 276,
      "isCorrect": false,
      "answered": true,
      "marksAwarded": -0.5,
      "explanation": "Pregnancy is the most common cause and must always be excluded first.",
      "options": [
        { "id": 276, "optionText": "Pregnancy",       "optionImageUrl": null, "displayOrder": 0, "isCorrect": true  },
        { "id": 277, "optionText": "Menopause",       "optionImageUrl": null, "displayOrder": 1, "isCorrect": false },
        { "id": 278, "optionText": "Turner syndrome", "optionImageUrl": null, "displayOrder": 2, "isCorrect": false }
      ]
    }
  ]
}
```

| field | meaning |
|---|---|
| `score` | achieved marks. **Can be negative** |
| `totalMarks` | the perfect score, not the achieved one |
| `correctCount` / `wrongCount` / `skippedCount` | sum to `totalQuestions` |
| `results[].selectedOptionId` | what the student picked. `null` if skipped |
| `results[].correctOptionId` | the right answer. Use this, don't scan `options` |
| `results[].isCorrect` | this student's result for this question |
| `results[].answered` | `false` = skipped. **Distinct from wrong** |
| `results[].marksAwarded` | `marksCorrect`, `marksIncorrect`, or `0` if skipped |
| `results[].explanation` | nullable — many questions have none |
| `results[].options[].isCorrect` | present here, absent on the serve |

`results` is ordered by question id, **not** the order shown. Re-sort against
`servedIds` if the review screen should match the quiz order.

---

## Per-question "check answer" — same endpoint

For instant feedback after each question instead of a summary at the end, send
**one** question:

```json
{ "questionIds": [17], "answers": [ { "questionId": 17, "optionId": 277 } ] }
```

Identical response shape, `results` has one entry. Nothing is persisted, so
calling this once per question costs nothing and leaves no state to clean up.
It is the same endpoint whether you send 1 question or 20.

---

## Drawing the result

```dart
final r = result.results.first;

for (final opt in r.options) {
  if (opt.id == r.correctOptionId)       => green;   // always show the right one
  else if (opt.id == r.selectedOptionId) => red;     // only reached when wrong
  else                                   => normal;
}
// then r.explanation underneath, when non-null
```

**Check `correctOptionId` first.** Reversing these two branches paints a correct
answer red, because a correct answer satisfies both conditions.

### Three states per question, not two

A skipped question is **not** a wrong question. Collapsing them misreports the
result:

- **Correct** — `isCorrect: true`. Highlight the selection green.
- **Wrong** — `answered: true, isCorrect: false`. Selection red **and** the
  correct option green, so the student sees both.
- **Skipped** — `answered: false`, `selectedOptionId: null`. Highlight only the
  correct option. Marks are `0` — do not show a penalty.

---

## Errors

All errors are `{ "error": { "message": "..." } }`.

Both quiz endpoints run the **same gates**, so these apply to serve and submit
alike:

| status | message | what to show |
|---|---|---|
| 409 | `Select a course before opening a lesson` | route to course selection |
| 404 | `Lesson not found` | draft or wrong id — back out |
| 403 | `This lesson is not part of your selected course` | back out |
| 403 | `This lesson is locked...` + `requiredPlans` | **paywall, from that array** |
| 409 | `This lesson has no quiz linked` | empty state, not an error |
| 409 | `The quiz linked to this lesson is inactive` | "not available right now" |

Submit adds three **400**s of its own:

| message | cause |
|---|---|
| `answers must be an array of { questionId, optionId }` | `answers` missing or not a list |
| `Not part of this quiz: question 44` | stale `questionIds` — the quiz changed |
| `Option 812 does not belong to question 17` | mismatched ids in `answers` |

The middle one will actually happen: an admin edits the quiz while a student
has it open. It is recoverable — say the quiz changed and re-fetch, rather than
showing a generic failure.

A **401** with `"code": "SESSION_ENDED"` means the account signed in elsewhere.
Sessions rotate on every sign-in, so this is normal, not a bug — route to login.

---

## Model warning

**`isCorrect` is absent on the serve and present on the submit response.** If
one question model serves both, `isCorrect` must be **nullable**, or parsing the
serve response crashes on the first question. Same for `explanation`.

Two models is also fine, and arguably safer.

---

## What does not exist

**Nothing is persisted.** No attempt history, no past-results screen, no
resume. Re-submitting the same answers just re-scores them.

Do not build a history list or a "your previous attempt" panel — there is no
endpoint behind either. Hold the result in memory for the session and let it go.

Do not cache questions across sessions either: a filter quiz resolves fresh each
time and the next attempt legitimately contains different questions.

---

## Test accounts

`keerthanabineesh5@gmail.com` has `selectedCourseId = 18` and works.
`nived050@gmail.com` has none and will 409 on every lesson.

Quiz lessons in course 18:

| lesson | quiz | access | result |
|---|---|---|---|
| 32 Gynacology | 13 | free | opens |
| 36 testing | 19 | free | opens |
| 31 Pulmanology | — | free | 409, no quiz linked |
| 26 ENT | 12 | premium | paywall, no subscription on this account |

Test against **32** or **36**.
