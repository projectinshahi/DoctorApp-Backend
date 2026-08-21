# Task: add a Quiz Health screen to the Flutter admin panel

Paste this into Claude inside the **Flutter admin panel repo**.

All response bodies below were captured from the live backend at
`https://doctorapp-backend-30gd.onrender.com` on 2026-08-20. They are real, not
illustrative.

---

## Background: why this screen is needed

A quiz in this system is a saved **filter**, not a container of questions. It
stores `subjectId + topicId + optional examTag` and resolves matching questions
fresh every time it is opened. Two failure modes follow from that, and neither
is visible anywhere in the admin panel today:

1. **An orphaned quiz.** A quiz is only reachable by a student if a lesson links
   to it. Right now **8 of 9 quizzes have no lesson**, so they exist in the
   database and appear nowhere in the app. Nothing warns the admin.

2. **An underfilled quiz.** A quiz asking for 10 questions in a topic that holds
   1 silently serves 1. Right now 5 quizzes are in this state. The admin sets
   "10 questions" and has no idea only 1 will appear.

The backend already reports both. The admin panel just doesn't surface them.

---

## API contract

### List — `GET /api/quizzes`

Headers: `Authorization: Bearer <admin token>`

Optional query filters, combined with AND: `subjectId`, `topicId`, `examTag`,
`status`.

```json
{
  "quizzes": [
    {
      "id": 9,
      "title": "Hematology",
      "subjectId": 7,
      "topicId": 9,
      "examTag": null,
      "questionCount": 1,
      "status": "active",
      "subject": { "id": 7, "name": "Internal Med" },
      "topic":   { "id": 9, "name": "Hematology" },
      "lesson":  { "id": 24, "title": "Hematology" },
      "createdAt": "2026-08-20T11:50:22.130Z",
      "updatedAt": "2026-08-20T11:50:22.130Z"
    }
  ]
}
```

`lesson` is `null` for an orphaned quiz. **This is the orphan signal — it is
already in the list response, no extra call needed.**

### Detail — `GET /api/quizzes/:id`

The list does **not** carry pool counts. Only the detail endpoint does:

```json
{
  "quiz": {
    "id": 3,
    "title": "Pulmonology",
    "subjectId": 7,
    "topicId": 2,
    "examTag": null,
    "questionCount": 10,
    "status": "active",
    "subject": { "id": 7, "name": "Internal Med" },
    "topic":   { "id": 2, "name": "Pulmonology" },
    "lesson": null,
    "createdAt": "2026-08-20T07:30:04.613Z",
    "updatedAt": "2026-08-20T07:30:04.613Z",
    "availableQuestions": 1,
    "servedQuestions": 1,
    "isUnderfilled": true
  }
}
```

- `availableQuestions` — how many active questions currently match the filter.
- `servedQuestions` — what a student actually receives.
  `min(questionCount, availableQuestions)`, or all of them when
  `questionCount` is null.
- `isUnderfilled` — `questionCount != null && availableQuestions < questionCount`.

These are computed live, so they change the moment questions are imported or
deactivated. Do not cache them across a pull-to-refresh.

### Delete — `DELETE /api/quizzes/:id`

- **409** when a lesson links to it, with a message naming the lesson. Unlink
  first, or set `status: inactive` via `PATCH /api/quizzes/:id`.
- **200** otherwise.

Surface the 409 message directly — it already tells the admin exactly what to do.

---

## What to build

### Screen: "Quizzes"

A list, reachable from wherever the admin panel lists content. For each row:

- title, and `subject.name › topic.name` beneath it
- `examTag` as a small uppercase chip when non-null
- a status chip when `status != "active"`
- **an "Not linked to a lesson" warning chip when `lesson == null`**
- when linked: "in <lesson.title>" as quiet secondary text
- pool readout: **"serves N of M"** using `servedQuestions` / `availableQuestions`
- **a warning treatment when `isUnderfilled`** — e.g. "asks for 10, only 1
  available"

Sort or group so the broken ones are visible without scrolling: orphaned first,
then underfilled, then healthy.

### Loading the pool numbers

`GET /api/quizzes` gives you every row including the orphan signal. Fire
`GET /api/quizzes/:id` per row to fill in the pool numbers.

**Do this lazily or in a bounded batch — do not block the whole list on all of
them.** Render the list immediately from the list response, then let each row's
pool readout resolve into place. A row whose detail call fails should show the
row without the pool readout, not an error.

There are 9 quizzes today so N+1 is fine. If the count ever reaches the
hundreds, ask the backend to move `availableQuestions` into the list response —
it is deliberately not there yet because it would be premature.

### Empty and healthy states

- No quizzes at all → point the admin at wherever quizzes are created.
- All healthy → say so plainly. Don't render a warnings panel with nothing in it.

---

## Constraints

- Match the existing admin panel's service/model/widget structure. There is
  already a `QuizService` and quiz models from the earlier lesson-quiz work —
  **extend those, do not create a parallel set.**
- `questionCount` is nullable. Null means "serve every matching question", and
  such a quiz is **never** underfilled. Do not render "asks for null".
- `examTag`, `lesson` are nullable. `subject` and `topic` are always present.
- Use the same auth/token handling and error surfacing as the existing screens.
- Do not add a "fix this" button that mutates anything. This screen reports;
  the admin acts through the existing lesson and quiz editors.

---

## One unrelated contract change

If — and only if — the admin panel has a **question bank** screen with a delete
action, note that `DELETE /api/questions/:id` changed:

- **Was:** always `409`, telling the admin to deactivate instead.
- **Now:** `200` with `{ message, questionId, affectedQuizzes }`.

`affectedQuizzes` is how many quiz pools shrank as a result — worth showing in
the confirmation ("Deleted. 3 quizzes now have one fewer question."). Deletion
cascades the question's options and tags and is **not** recoverable, so keep any
confirm dialog, and keep offering deactivate as the softer option.

If there is no question bank screen in the admin panel, ignore this section
entirely — questions are managed from the Google Sheet.
