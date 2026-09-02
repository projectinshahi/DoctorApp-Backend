# Task: watched / unwatched indicator on every video in the outline

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Captured from the live backend on 2026-09-02.

---

## The app no longer decides what "watched" means

It reports **where the player is**. The server owns the threshold — 90% — so
Android, iOS and web cannot drift apart, and a video finished on the phone
shows a tick on the web the moment the outline is refetched.

Delete any client-side completion rule you already have.

---

## 1. Report position while playing

```
PUT /api/users/me/lessons/37/progress
{ "lastPositionSeconds": 545, "durationSeconds": 600 }
```

Note the verb: **PUT**, not PATCH.

```json
{ "lessonId": 37,
  "completed": true,
  "lastPositionSeconds": 545,
  "durationSeconds": 600,
  "watchedPercent": 91,
  "completionThresholdPercent": 90,
  "updatedAt": "..." }
```

**`completed` comes back from the server.** Do not compute it. Verified on a
600-second video:

| you send | you get back |
|---|---|
| `120` (20%) | `completed: false, watchedPercent: 20` |
| `530` (88%) | `completed: false, watchedPercent: 88` |
| `545` (91%) | **`completed: true`** |
| `60` after that | **`completed: true`** — a rewind does not un-finish it |

That last row is the rule that matters. Rewinding to rewatch a section is not
un-watching the video, so the tick only ever turns on.

### Send `durationSeconds` on the first call of a session

Every video uploaded before today has no stored length, and the server cannot
judge a percentage without one — 300s into a 310s clip is finished, 300s into
an hour is not. Your player knows it, so send it and the back catalogue fills
in as students watch. Once stored it is ignored, so sending it every time is
harmless.

### How often to call

Every **10 seconds** while playing, plus on pause, seek and dispose. Not every
frame. The response is small but it is still a request per call.

`completionThresholdPercent` is returned so the UI can say "watch 90% to mark
complete" without hardcoding a number that might change.

### `completed: true` still works by hand

```
PUT /api/users/me/lessons/41/progress   { "completed": true }
```

Keep this for **notes** and for a manual "Mark as done" — an explicit
`completed` in the body wins and skips the threshold entirely. Sending only a
position never clears a tick.

---

## 2. Render the indicator from the outline

`GET /api/users/me/selection/content` — every lesson row already carries it:

```json
{ "id": 37, "title": "Cardiology", "type": "video",
  "completed": true,
  "watchedPercent": 10,
  "durationSeconds": 600,
  "lastPositionSeconds": 60,
  "isSaved": false, "locked": false }
```

Four states per video row:

| condition | render |
|---|---|
| `completed: true` | filled tick, "Watched" |
| `watchedPercent > 0` | thin progress bar, "Resume at 1:00" |
| `watchedPercent == 0` | empty circle, "Not started" |
| `watchedPercent == null` | empty circle only — **no bar** |

**`watchedPercent` is null when the video's length is not known yet.** That is
"cannot tell", not "0%". A bar stuck at zero would read as "never watched" for
a video the student is halfway through. It is also always null for notes and
quizzes — only videos have a percentage.

Note in the example above: `completed: true` with `watchedPercent: 10`. Both
are correct — they finished it, then rewound. **The tick wins; do not derive
the tick from the percentage.**

Chapter and course rollups are already there too:

```json
"progress": { "total": 12, "completed": 7, "percent": 58 }
```

`GET /api/users/me/lessons/:id` returns the same fields for a deep link where
no outline was loaded.

---

## 3. Meeting the acceptance criterion

> *Indicator updates immediately after a video crosses the completion
> threshold.*

The crossing is in the **response to the progress call you already make**. So:

1. The 10-second tick posts `545`.
2. The response says `completed: true`.
3. Update the row in your local outline state from that response — no refetch.

Do not wait for the next `/selection/content`. The tick should appear while the
video is still playing, which is only possible because the server tells you on
the same call.

---

## What to build

**Player** — a 10s timer posting position and duration. On every response,
write `completed` and `watchedPercent` back into the outline state.

**Outline row** — tick / bar / empty circle per the table above, plus
"Resume at m:ss" when `lastPositionSeconds > 0` and not complete.

**Chapter header** — "7 of 12" from the existing `progress` block.

## Constraints

- **PUT**, not PATCH.
- Never compute `completed` in the app. Read it from the response.
- Never clear a tick locally — a rewind keeps it.
- `watchedPercent` is nullable, and null is not zero.
- Send `durationSeconds` at least once per video so old uploads backfill.
- Notes and quizzes have `watchedPercent: null`; a quiz's `completed` comes
  from its attempt, not from a player.
