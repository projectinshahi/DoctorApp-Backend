# Task: build the Marrow-style home screen

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on both endpoints.

Every response below was captured from the live backend on 2026-08-28.

---

## What is new

Two endpoints, and one thing the app must start doing that it never did.

```
GET /api/users/me/home                        the whole home screen, one call
PUT /api/users/me/lessons/:id/progress        the app reports how far it got
```

**The second one is not optional.** Nothing tracked watch progress before, so
until the player reports it the video and notes cards read 0 forever. The
QBank and Tests cards work already — they come from quiz attempts the backend
records itself.

---

## 1. The home screen — one call

```
GET /api/users/me/home
```

```json
{
  "course": { "id": 22, "title": "GP GULF LICENSING EXAM", "thumbnail": null, "accessType": "free" },
  "courseType": { "id": 20, "title": "DHA (Dubai) Exam", "description": "..." },
  "hasPaid": true,

  "modules": {
    "videos": { "total": 2, "completed": 1, "inProgress": 1, "percent": 50 },
    "notes":  { "total": 0, "completed": 0, "percent": 0 },
    "qbank":  { "totalQuestions": 7, "attempted": 5, "correct": 2, "accuracy": 40 },
    "tests":  { "total": 2, "attempted": 2, "completed": 1, "percent": 50 },
    "bookmarks": { "questions": 2, "lessons": 0 }
  },

  "continueWatching": {
    "lessonId": 39,
    "title": "Obstetrics",
    "thumbnailUrl": "https://res.cloudinary.com/.../bv7f5c6269we4crxovz5.png",
    "chapter": { "id": 17, "title": "Obstetrics And Gynecology" },
    "lastPositionSeconds": 95,
    "locked": false
  },

  "continueQuiz": {
    "attemptId": 7,
    "lessonId": 44,
    "title": "GYNACOLOGY",
    "totalQuestions": 2,
    "answeredCount": 1,
    "remainingCount": 1
  }
}
```

Five cards and two continue rows, no other call. Don't assemble any of this
from the content tree.

### What each number means

| field | meaning |
|---|---|
| `videos.total` | published video lessons **in the selected course** |
| `videos.completed` | ones the app reported `completed: true` for |
| `videos.inProgress` | started, not finished — **separate from completed** |
| `notes.*` | same, for note lessons |
| `qbank.totalQuestions` | active questions this course's quizzes can draw on |
| `qbank.attempted` | distinct questions answered, across every attempt |
| `qbank.correct` | of those, how many were right |
| `qbank.accuracy` | `correct / attempted` as a percent |
| `tests.total` | quiz lessons in the course |
| `tests.attempted` | quiz lessons with at least one real attempt |
| `tests.completed` | quiz lessons with a finished attempt |
| `bookmarks.*` | counts only — the lists live at `/saved-questions` and `/saved-lessons` |

Three that are easy to misread:

**`accuracy` is out of what they answered, not out of the bank.** It does not
fall when an admin adds questions.

**`percent` never reaches 100 until a module is genuinely finished.** 199 of
200 returns `99`, not `100`. So `percent == 100` is safe to render as a
completed badge.

**`inProgress` is not part of `completed`.** A student halfway through two
videos has `completed: 0, inProgress: 2` — render both or they look idle.

### Continue rows

`continueWatching` is the most recently touched **unfinished** video, or
`null`. It carries `lastPositionSeconds` — seek there rather than restarting —
and `locked`, so a lapsed subscription shows the paywall instead of a player.

`continueQuiz` is the open attempt, or `null`. `remainingCount` is the label
("1 question left"). Resume with `POST /lessons/:lessonId/quiz-attempts`, which
returns `resumed: true` with the answers already given.

### No course selected

Returns **200** with `course: null` and every module zeroed. That is a real
state for a fresh account, not an error — render the empty cards and prompt
for course selection. Do not show an error screen.

---

## 2. Reporting progress

```
PUT /api/users/me/lessons/39/progress
{ "lastPositionSeconds": 412 }
{ "completed": true }
{ "completed": true, "lastPositionSeconds": 900 }
```

**200**:

```json
{ "lessonId": 39, "completed": false, "lastPositionSeconds": 412,
  "updatedAt": "2026-08-28T12:26:12.261Z" }
```

**The body is partial and both fields are optional.** Sending only a position
does not un-complete a lesson; sending only `completed` does not reset the
resume point to 0. Verified live: position 412 survived a later
`{"completed": true}`.

### When to call it

**Video player** — `lastPositionSeconds` every ~10 seconds while playing, and
on pause and on dispose. Then `completed: true` when it ends.

Debounce it. One call per second per student is wasted traffic, and the resume
point does not need that resolution.

**Note viewer** — `completed: true` on open, or on close if "read" should mean
something stronger.

**`completed` is the client's decision**, deliberately. The server will not
infer it from the position, because someone who scrubs to the end has not
watched it and someone who stops at 95% has. Pick the rule (95%? reached the
end?) and send it.

### Errors

| status | body |
|---|---|
| 400 | `Invalid lesson id` |
| 400 | `completed must be a boolean` |
| 400 | `lastPositionSeconds must be a non-negative number` |
| 404 | `Lesson not found` — also returned for an unpublished lesson |

All errors are `{ "error": { "message": "..." } }`.

---

## What to build

**Home screen** — one `GET /home` on load and on pull-to-refresh. Five module
cards from `modules`, two continue rows above or below them.

A card needs `completed / total` and the percent ring. The QBank card is
`attempted / totalQuestions` plus accuracy. The Bookmarks card is just the two
counts, tapping through to the saved lists.

**Video player** — the debounced position reporter and the completion call.
Seek to `lastPositionSeconds` when arriving from `continueWatching`.

**Note viewer** — the completion call.

Refresh home after finishing a quiz or a video so the counts move; there is no
push.

## Constraints

- `continueWatching` and `continueQuiz` are both nullable, independently.
- `course` and `courseType` are nullable — `courseType` is null for a course
  with no exam type, which is not an error.
- `thumbnail`, `thumbnailUrl`, `description` are nullable.
- Don't compute any of these counts client-side from the content tree. They
  are scoped to the selected course and to real attempts; a local count will
  disagree.
- Debounce the progress call. It is a write on every tick otherwise.
