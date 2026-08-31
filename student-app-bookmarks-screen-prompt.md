# Task: build the Bookmarks screen — questions and lessons, with type filters

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Every response below was captured from the live backend on 2026-08-31.

---

## One call renders the whole screen

```
GET /api/users/me/saved?type=all
```

```json
{
  "type": "all",
  "counts": { "all": 5, "question": 3, "video": 1, "text": 0, "quiz": 1, "lesson": 2 },
  "questions": [ /* saved questions */ ],
  "lessons":   [ /* saved lessons */ ]
}
```

Chips from `counts`, list from `questions` + `lessons`. No second call, and no
call per chip to label it.

`type` accepts `all` (default), `question`, `video`, `text`, `quiz`.

### `counts` is always the FULL set

It does not change with `type`. Verified live — `?type=video` still returns
`{ "all": 5, "question": 3, "video": 1, ... }`.

That is deliberate: counts derived from the filtered list would make every chip
show the open tab's size. Bind the chips to `counts` and never to
`questions.length` or `lessons.length`.

### The chips

| chip label | `type` to send | count key |
|---|---|---|
| All | `all` | `counts.all` |
| Questions | `question` | `counts.question` |
| Videos | `video` | `counts.video` |
| **Notes** | **`text`** | `counts.text` |
| Quizzes | `quiz` | `counts.quiz` |

**A note lesson's type is `text`, not `note`.** Label the chip "Notes", send
`text`. `?type=note` returns **400**, not an empty list:

```json
{ "error": { "message": "type must be one of: all, question, video, text, quiz" } }
```

That is on purpose. `note` looks right and matches nothing, and it has already
silently zeroed a card elsewhere in this app. A 400 is findable; an empty
screen is not.

Also rejected: `VIDEO` (the enum is lowercase) and `"video "` (untrimmed).

### Filtering can be local

The payload is the complete set, so switching chips does **not** need a
refetch — filter what you already hold. Refetch only on pull-to-refresh or when
returning to the screen. Passing `type` server-side is there for when you want
a single kind without the rest.

---

## Two arrays, not one merged feed

`questions` and `lessons` are separate because they render nothing alike: a
saved question shows options and an answer-key gate; a saved lesson shows a
thumbnail, a progress tick and a resume point.

For an "All" tab that interleaves them visually, merge client-side on
`savedAt` — both carry it, both are newest-first already.

### A saved question

```json
{ "questionId": 6, "savedAt": "...",
  "questionText": "Which hepatitis virus is most associated with...",
  "difficulty": "medium", "marksCorrect": 2, "marksIncorrect": -0.5,
  "subject": { "id": 7, "name": "Internal Med" }, "topic": { "id": 9, "name": "Infectious Dis" },
  "revealed": false, "correctOptionId": null, "explanation": null,
  "options": [ { "id": 40, "optionText": "Hepatitis C", "displayOrder": 0, "isCorrect": null } ] }
```

**`revealed: false` means the answer is withheld** — the student has not
answered this question in a completed attempt. `correctOptionId`, `explanation`
and every `options[].isCorrect` come back `null`. Show it as a plain question;
tapping it opens the quiz.

`isCorrect` here is **`bool?`**. A non-nullable field crashes on the first
unrevealed bookmark.

### A saved lesson

```json
{ "id": 39, "title": "Obstetrics", "type": "video",
  "savedAt": "...", "isSaved": true,
  "completed": false, "lastPositionSeconds": 95,
  "attempt": null, "locked": false, "plans": [], "planIds": [],
  "videoUrl": "...", "thumbnailUrl": "...",
  "chapter": { "id": 17, "title": "Obstetrics And Gynecology" } }
```

**Same shape as a lesson in the course tree.** Reuse the existing lesson model
and lesson card — do not build a second one.

- `completed` — video/note: the app said so. quiz: its latest attempt was submitted.
- `lastPositionSeconds` — seek here on open. Always `0` for a quiz lesson.
- `attempt` — quiz lessons only, `null` otherwise.
- `locked: true` strips `videoUrl`/`noteUrl` but **keeps** `lastPositionSeconds`.
- `plans` — feed the existing paywall sheet directly.

---

## Toggling a bookmark

```
POST   /api/users/me/saved-questions        { "questionId": 17 }
DELETE /api/users/me/saved-questions/:questionId
POST   /api/users/me/saved-lessons          { "lessonId": 39 }
DELETE /api/users/me/saved-lessons/:lessonId
```

POST is an upsert — double-tap is harmless. DELETE on a bookmark that is
already gone returns **200 with `removed: false`**, not 404.

All four return `count` for that kind, so the badge updates without a refetch.

Every lesson everywhere already carries **`isSaved`** —
`GET /users/me/lessons/:id` and every lesson in `/selection/content`. Bind the
button to that; do not search the saved list to decide whether to fill the icon.

Optimistic toggle: flip `isSaved`, call the endpoint, reconcile from `count`.

---

## What to build

**Bookmarks screen** — a chip row from `counts`, and a list below it. One
`GET /saved` on load; filter locally when a chip is tapped.

**Question rows** — the existing question card, with the reveal UI shown only
when `revealed == true`.

**Lesson rows** — the existing lesson card. Tap opens the lesson and seeks to
`lastPositionSeconds`; a locked row opens the paywall from `plans`.

**Empty states per chip** — "No saved videos yet" reads better than one blank
list, and `counts` tells you which chips are empty before the user taps them.

**Home card** — `GET /home` returns `modules.bookmarks.questions` and
`modules.bookmarks.lessons`. Deep-link into this screen with the matching chip.

## Constraints

- Chips bind to `counts`, never to a list length.
- Send `text` for Notes. `note` is a 400.
- `options[].isCorrect`, `correctOptionId` and `explanation` on a saved
  question are all **nullable**.
- `isSaved` is a `bool`, never null. `lastPositionSeconds` is an `int`
  defaulting to `0`. `attempt` is null on non-quiz lessons.
- Unpublished lessons are dropped from the list, so `counts.lesson` can be
  lower than the number saved. That is intended, not an error.
- Reuse the existing question and lesson models. Both shapes match what the
  quiz and tree endpoints already return.
