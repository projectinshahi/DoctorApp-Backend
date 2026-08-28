# Backend changes for BACKEND-REQUESTS.md — all five, live

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on everything below.

Every response here was captured from the live backend on 2026-08-28.

---

## 1. Retake policy: unlimited. Take the one-attempt restriction out.

**Decision: the Marrow model. A student can retake a quiz as often as they
like**, and history keeps every run.

So the client-side rule — read history, see a completed attempt, force the
review screen — should be **removed**. It was never enforceable anyway, and it
now contradicts the backend.

`POST /lessons/:id/quiz-attempts` still starts a fresh attempt every time the
previous one is finished. What changed is only what happens to *abandoned*
ones, below.

### 1b. Empty attempts are gone

An attempt with zero answers is a quiz someone opened and closed — not
progress. Starting a quiz now **deletes** any such attempt rather than resuming
its stale question draw, and empty attempts are excluded from history, the
course tree, and the in-progress list.

Attempt #4 with `answeredCount: 0` no longer appears anywhere. Verified:
`GET /lessons/38/quiz-attempts` returns `[3, 2, 1]`.

Consequence worth knowing: opening a quiz, answering nothing, and reopening
gives a **new random draw**, not the same questions. That is correct for a
QBank; don't cache the question list across opens.

---

## 2. Saved questions

```
POST   /api/users/me/saved-questions          { "questionId": 17 }
GET    /api/users/me/saved-questions
DELETE /api/users/me/saved-questions/:questionId
```

**POST** → `201 { "saved": true, "questionId": 17, "count": 3 }`
It is an upsert, so a double tap is harmless — no duplicate, no error.

**DELETE** → `200 { "saved": false, "questionId": 17, "removed": true, "count": 2 }`
Deleting a bookmark that is already gone returns **200 with
`removed: false`**, not 404. The end state is what was asked for.

Both return `count`, so the bookmark badge updates without a second call.

**GET** → `count` at the top level, for the QBank card:

```json
{
  "count": 3,
  "questions": [
    {
      "questionId": 6,
      "savedAt": "2026-08-28T10:12:44.001Z",
      "questionText": "Which hepatitis virus is most associated with...",
      "questionImageUrl": null,
      "difficulty": "medium",
      "marksCorrect": 2,
      "marksIncorrect": -0.5,
      "subject": { "id": 7, "name": "Internal Med" },
      "topic": { "id": 9, "name": "Infectious Dis" },

      "revealed": false,
      "correctOptionId": null,
      "explanation": null,
      "options": [
        { "id": 40, "optionText": "Hepatitis C", "optionImageUrl": null, "displayOrder": 0, "isCorrect": null },
        { "id": 41, "optionText": "Hepatitis A", "optionImageUrl": null, "displayOrder": 1, "isCorrect": null }
      ]
    }
  ]
}
```

### `revealed` — branch on this

`revealed` is `true` only when the student has answered that question in a
**completed** attempt. Answering it in an attempt they never finished does not
count.

When `revealed` is `false`:

- `correctOptionId` is `null`
- `explanation` is `null`
- **every `options[].isCorrect` is `null`**

The question text and all option texts are still there, so the bookmark is
fully usable — the student just cannot see the answer they have not earned.

That third one matters for the model: `isCorrect` on a saved question's option
is `bool?`, never `bool`. A non-nullable field crashes on the first unrevealed
bookmark.

Show the reveal UI only when `revealed == true`. Otherwise render it as a plain
question, and let tapping it open the quiz.

---

## 3. Attempt state now rides on the course tree — the N+1 is gone

`GET /api/users/me/selection/content` (the tree the topic screen already
loads) now carries an `attempt` object on **every lesson**:

```json
{
  "id": 38, "title": "Cardiology", "type": "quiz",
  "attempt": {
    "attemptId": 3,
    "completed": true,
    "startedAt": "2026-08-28T09:30:18.862Z",
    "completedAt": "2026-08-28T09:43:50.468Z",
    "totalQuestions": 3,
    "answeredCount": 3,
    "remainingCount": 0,
    "correctCount": 2,
    "score": 3.5,
    "attemptCount": 3
  }
}
```

- `null` when the lesson is not a quiz, **or** when there is no attempt yet.
- `attempt` describes the **latest** attempt; `attemptCount` is how many exist.
- `completed: false` with `remainingCount > 0` → draw the **Continue** pill.
- `completed: true` → draw **Review** (or Retake — retakes are allowed).

**Delete the per-quiz history calls from the topic screen.** It costs one
batched query for the whole tree now, and the data is already in a response
that screen fetches anyway.

I did **not** add `GET /quiz-attempts/status?lessonIds=...`. It would be a
second way to ask what the tree already answers. If a screen needs this without
the tree, say so and it can be added.

---

## 4. Continue MCQs across the whole course

```
GET /api/users/me/quiz-attempts?status=in_progress
```

`status` accepts `in_progress` (default), `completed`, `all`.

```json
{
  "status": "in_progress",
  "count": 1,
  "attempts": [
    {
      "attemptId": 7,
      "lessonId": 38,
      "lessonTitle": "Cardiology",
      "quiz": { "id": 20, "title": "Cardiology" },
      "completed": false,
      "startedAt": "2026-08-28T10:02:11.400Z",
      "completedAt": null,
      "totalQuestions": 3,
      "answeredCount": 1,
      "remainingCount": 2,
      "correctCount": 1,
      "score": 2
    }
  ]
}
```

Carries `lessonId` and `lessonTitle`, so the QBank card can label the row and
deep-link straight into the lesson. Empty attempts never appear.

---

## 5. Lesson bookmarks

```
POST   /api/users/me/saved-lessons          { "lessonId": 38 }
GET    /api/users/me/saved-lessons
DELETE /api/users/me/saved-lessons/:lessonId
```

Identical semantics to saved questions — upsert POST, 200 DELETE, `count` on
all three.

```json
{ "count": 1,
  "lessons": [ { "id": 38, "title": "Cardiology", "description": "...",
                 "type": "quiz", "thumbnailUrl": null, "accessType": "free",
                 "isFreePreview": false, "quizId": 20,
                 "chapter": { "id": 16, "title": "Internal Medicine" },
                 "savedAt": "2026-08-28T10:20:03.918Z" } ] }
```

Unpublished lessons are **dropped from the listing** — a bookmark must not
resurrect content an admin has taken down. `count` reflects what is returned,
so it can be lower than what was saved. That is intended; do not treat the
difference as an error.

Replace the video screen's local `setState` bookmark with these.

---

## What to build

**Bookmarks** — replace SharedPreferences with the two endpoints. On sign-in
they arrive from the server; on sign-out just drop the local copy. Wire the
"Bookmarks" card to `count` from `GET /saved-questions`.

**Saved question detail** — render from the list. Only show correct answer and
explanation when `revealed`.

**Topic screen** — read `lesson.attempt` from the tree. Delete the per-quiz
history calls.

**QBank Continue card** — `GET /quiz-attempts?status=in_progress`.

**Quiz screen** — remove the one-attempt restriction. Offer Retake on a
finished quiz.

## Constraints

- `options[].isCorrect` on a saved question is **nullable**. So are
  `correctOptionId` and `explanation`.
- `lesson.attempt` is nullable on every lesson, quiz or not.
- `score` and `marksIncorrect` are genuinely negative. Never take an absolute
  value.
- Don't cache a quiz's question list across opens — each attempt draws fresh.
- All errors are `{ "error": { "message": "..." } }`.
