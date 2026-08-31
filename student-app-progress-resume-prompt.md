# Change: lessons resume where the student left them, and progress rolls up

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` — unchanged.

Every response below was captured from the live backend on 2026-08-29.

This is **additive**. No existing field changed, no request body changed, no
status code changed. Three endpoints gained fields, and the player gains one
job it never had.

---

## What is new

| endpoint | new fields |
|---|---|
| `GET /api/users/me/lessons/:id` | `lastPositionSeconds`, `completed` |
| `GET /api/users/me/selection/content` | same on every lesson, plus `progress` on each chapter and on the course |
| `PUT /api/users/me/lessons/:id/progress` | (already existed — the player must now call it) |

The write endpoint existed but nothing read it back, so a resume point was only
reachable from the home screen. Opening a lesson from the tree, a deep link or
a bookmark always restarted at zero.

---

## 1. Resume playback

```
GET /api/users/me/lessons/39
```

```json
{ "lesson": {
    "id": 39, "title": "Obstetrics", "type": "video",
    "videoUrl": "...", "locked": false,
    "lastPositionSeconds": 95,
    "completed": false
} }
```

On open:

```dart
if (lesson.lastPositionSeconds > 0) {
  controller.seekTo(Duration(seconds: lesson.lastPositionSeconds));
}
```

**`lastPositionSeconds` survives the lock strip.** A locked lesson has
`videoUrl: null` but keeps its position — a student who subscribes later has
not lost their place. Do not assume `locked: true` means no progress.

A completed lesson keeps its position too. Rewatching resumes where they
stopped rather than jumping to the start; if the design wants a completed
lesson to restart, do that in the client.

---

## 2. Report progress — the player's new job

```
PUT /api/users/me/lessons/39/progress
{ "lastPositionSeconds": 412 }
{ "completed": true }
```

**200** → `{ "lessonId": 39, "completed": false, "lastPositionSeconds": 412, "updatedAt": "..." }`

**Both fields are optional and the update is partial.** Sending a position does
not un-complete a lesson; sending `completed` does not reset the position to 0.
Verified live.

### When to call it

- **while playing** — `lastPositionSeconds`, **debounced to ~10 seconds**
- **on pause and on dispose** — flush the current position
- **when the video ends** — `{ "completed": true }`
- **note lessons** — `{ "completed": true }` on open or close

Debounce it properly. Undebounced this is a database write on every tick.

**`completed` is the client's decision, deliberately.** The server will not
infer it from the position: someone who scrubs to the end has not watched it,
and someone who stops at 95% has. Pick the rule and send it.

Errors, all `{ "error": { "message": "..." } }`:

| status | message |
|---|---|
| 400 | `completed must be a boolean` |
| 400 | `lastPositionSeconds must be a non-negative number` |
| 404 | `Lesson not found` — also for an unpublished lesson |

---

## 3. Progress bars, free with the tree

`GET /api/users/me/selection/content` now returns:

```json
{
  "course": { "id": 22, "title": "GP GULF LICENSING EXAM" },
  "progress": { "total": 5, "completed": 3, "percent": 60 },
  "chapters": [
    {
      "id": 16, "title": "Internal Medicine",
      "progress": { "total": 2, "completed": 2, "percent": 100 },
      "lessons": [
        { "id": 37, "title": "Cardiology", "type": "video",
          "completed": true, "lastPositionSeconds": 412, "attempt": null, "locked": false },
        { "id": 38, "title": "Cardiology", "type": "quiz",
          "completed": true, "lastPositionSeconds": 0,
          "attempt": { "attemptId": 3, "completed": true, "correctCount": 2, "score": 3.5 } }
      ]
    }
  ]
}
```

No extra calls. Draw the course ring from the top-level `progress`, a bar per
chapter from `chapter.progress`, and a tick per lesson from `lesson.completed`.

### `completed` means two things, and you do not have to care

- a **video or note** lesson is complete when the app said so
- a **quiz** lesson is complete when its latest attempt was submitted

Both collapse into the one `completed` flag. Read that; do not branch on type
and do not try to derive it from `attempt` yourself. A quiz lesson always has
`lastPositionSeconds: 0` — it is not a thing you can be part-way through in
seconds.

### Locked lessons stay in the denominator

A chapter with 10 lessons where 8 are premium and the student has done 2 shows
`2/10`, not `2/2`. That is deliberate: dropping locked lessons would render a
full bar and tell a free student the chapter is finished. Do not filter them
out before counting.

### `percent` never reaches 100 until actually finished

199 of 200 returns `99`, not `100`. So `percent == 100` is safe to render as a
completed badge, and an empty chapter is `0/0 → 0%`, never a crash.

---

## What to build

**Video player** — seek to `lastPositionSeconds` on open; debounced position
reporting; `completed: true` on end.

**Note viewer** — `completed: true` on open or close.

**Chapter list** — a bar per chapter from `chapter.progress`, a tick per lesson
from `lesson.completed`.

**Course header** — the ring from the top-level `progress`.

**Continue Watching** — already on `GET /home` as `continueWatching`, which
carries the same `lastPositionSeconds`. Deep-link into the lesson and seek.

Refresh the tree after finishing a lesson or a quiz so the bars move; there is
no push.

## Constraints

- Extend the existing lesson model and service. Do not add a parallel set.
- `lastPositionSeconds` is an `int`, defaults to `0`, never null.
- `completed` is a `bool`, defaults to `false`, never null.
- `progress` on a chapter and on the course is always present, `0/0` for an
  empty one.
- `attempt` stays nullable — it is null for every non-quiz lesson.
- Do not read progress from a locked lesson's stripped media fields. `videoUrl`
  is null there; `lastPositionSeconds` is not.
- Debounce the progress write. It is a database write per call.
