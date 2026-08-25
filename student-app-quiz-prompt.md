# Task: add the quiz lesson screen to the Flutter student app

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` — the same token the rest of
the student app already uses.

Field lists below come from the backend's actual select clauses, so what is
absent is absent by design, not an oversight.

---

## READ THIS BEFORE PLANNING THE SCREEN

**There is no submit endpoint, and no way to score a quiz.**

I checked: no attempt/result/submission model exists, and no submit route
exists. The answer key (`isCorrect`) is stripped server-side and never reaches
the app, so the client **cannot** mark answers itself.

That means this screen can render a quiz and collect answers, but it cannot
show a score, a pass/fail, or which answers were right.

**Do not fake it.** Do not hardcode answers, do not guess, do not show a
fabricated score. Build the quiz-taking flow, hold the selections in memory, and
leave one clearly-marked seam where submission will go:

```dart
// TODO(attempts): POST the answers once the backend has an attempts endpoint.
// Until then the app cannot score — isCorrect is never sent to clients.
```

Ask the backend team for the attempts module before building any results UI.

---

## 1. Detect a quiz lesson

The existing lesson detail call already carries what you need:

```
GET /api/users/me/lessons/:id
```

```json
{
  "lesson": {
    "id": 26,
    "title": "ENT",
    "type": "quiz",
    "videoUrl": null,
    "noteUrl": null,
    "quizId": 11,
    "quiz": { "id": 11, "title": "ENT", "questionCount": 5, "status": "active" },
    "locked": false,
    "plans": [], "planIds": []
  },
  "requiredPlans": [], "requiredPlan": null, "unlockOptions": []
}
```

Branch on `lesson.type == 'quiz'` exactly as you already branch on `video`.

`quiz` is `null` when the lesson is locked — the backend strips it along with
`videoUrl` and `noteUrl`. Treat `locked: true` the same way you do for video:
show the paywall using `requiredPlans` / `unlockOptions`, and never call the
questions endpoint.

---

## 2. Fetch the questions

```
GET /api/users/me/lessons/:id/quiz-questions
```

```json
{
  "lessonId": 26,
  "quiz": { "id": 11, "title": "ENT", "questionCount": 5 },
  "totalQuestions": 5,
  "totalMarks": 10,
  "questions": [
    {
      "id": 57,
      "questionText": "Which lab finding confirms the diagnosis of diabetic ketoacidosis?",
      "questionImageUrl": null,
      "difficulty": "medium",
      "marksCorrect": 2,
      "marksIncorrect": -0.5,
      "options": [
        { "id": 764, "optionText": "Hyperglycemia, ketosis, and acidosis", "optionImageUrl": null, "displayOrder": 0 },
        { "id": 765, "optionText": "Hyperglycemia alone",                  "optionImageUrl": null, "displayOrder": 1 }
      ]
    }
  ]
}
```

### What the student model must and must not contain

Present: `id`, `questionText`, `questionImageUrl`, `difficulty`,
`marksCorrect`, `marksIncorrect`, and options with `id`, `optionText`,
`optionImageUrl`, `displayOrder`.

**Absent: `isCorrect`, `explanation`, `correctOptionId`, `tags`.**

If the app shares a question model with an admin build, make `isCorrect`
**nullable** and never rely on it. A model that requires it will crash on the
first parse.

Options arrive pre-sorted by `displayOrder`. Don't re-sort; don't shuffle —
the ordering is deliberate on hand-authored quizzes.

`marksIncorrect` is a genuine negative (`-0.5`). Render it as "-0.5", not
"--0.5", and don't take an absolute value.

---

## 3. Every failure the endpoint can return

This is the whole set. Each needs a different screen, and mapping them all to
one "something went wrong" would hide the two that are actionable.

| status | body | what the student should see |
|---|---|---|
| **409** | `Select a course before opening a lesson` | route to course selection |
| **404** | `Lesson not found` | not published, or wrong id — back out |
| **403** | `This lesson is not part of your selected course` | back out |
| **403** | `This lesson is locked. Subscribe to unlock it.` + `requiredPlans` | **paywall — show those plans** |
| **409** | `This lesson has no quiz linked` | empty state, not an error |
| **409** | `The quiz linked to this lesson is inactive` | "not available right now" |

The two that matter: the **403 with `requiredPlans`** carries the plans that
unlock the lesson, so the paywall needs no second call — reuse the existing
paywall sheet. The **409 select-a-course** is a real state for a fresh account,
not a bug.

All errors are `{ "error": { "message": "..." } }`.

---

## 4. What to build

**Quiz intro** — title, `totalQuestions`, `totalMarks`, and a Start button.
`marksIncorrect` being negative is worth warning about up front: "wrong answers
lose marks."

**Question view** — one question at a time with the options as single-select,
progress ("3 of 5"), and next/previous. Show `marksCorrect` and, when non-zero,
`marksIncorrect`.

Render `questionImageUrl` and `optionImageUrl` when non-null; both are usually
null, so the layout must not reserve space for them.

**Answer state** — a `Map<int questionId, int selectedOptionId>` held in memory.
Allow changing an answer and leaving questions unanswered.

**End of quiz** — a review list of what was answered and what was skipped, and
the submission seam. **No score.** Say plainly that results are not available
yet rather than showing an empty or zero score.

---

## Constraints

- Match the existing service/model/screen structure — extend, don't duplicate.
- Same token handling and error surfacing as other student screens.
- Don't call the questions endpoint for a locked lesson; `lesson.locked` is
  already known from step 1.
- Don't cache questions across sessions. A filter-based quiz resolves fresh
  every time and its contents can legitimately change between openings.
- Nothing here needs a new backend endpoint. Both calls are live today.

## For testing

Both existing test accounts have `selectedCourseId = null`, so they will hit the
409 until a course is selected. Lesson 25 is a draft (404 for everyone), and
lesson 26 is published but premium, so it needs an active subscription or
`isFreePreview: true` set by an admin. Ask the backend team to flip lesson 26 to
free preview for testing — it clears the paywall while leaving the published and
belongs-to-course checks in force.
