# Task: the Continue Watching row on the home screen

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Captured from the live backend on 2026-09-02.

---

## One call. It already carries everything, including the video URL.

```
GET /api/users/me/home
```

```json
{
  "modules": { "videos": { "total": 3, "completed": 1, "inProgress": 2, "percent": 33 } },
  "inProgressVideos": [
    { "lessonId": 39, "title": "Obstetrics",
      "thumbnailUrl": "https://res.cloudinary.com/...",
      "chapter": { "id": 17, "title": "Obstetrics And Gynecology" },
      "lastPositionSeconds": 40,
      "durationSeconds": null,
      "watchedPercent": null,
      "videoUrl": "https://res.cloudinary.com/...",
      "locked": false,
      "updatedAt": "2026-09-02T05:12:04.881Z" },
    { "lessonId": 37, "title": "Cardiology",
      "lastPositionSeconds": 150, "durationSeconds": 600,
      "watchedPercent": 25, "videoUrl": "...", "locked": false }
  ],
  "continueWatching": { "lessonId": 39, "videoUrl": "...", "lastPositionSeconds": 40 }
}
```

**`videoUrl` is in the payload**, so tapping a card starts playback
immediately. Do not call `GET /lessons/:id` first — that hop is what makes a
Continue Watching row feel slower than the outline it is meant to shortcut.

### What is in the list

Unfinished videos with a resume point, **most recently watched first**, capped
at 10.

Verified: a student with three videos — one at 150s, one at 40s, one completed
— gets **two** rows. A finished video leaves the row; that is the point of
"continue".

`continueWatching` is the **first element of the same list**, kept so an
existing single-card home screen keeps working. If you build the row, render
`inProgressVideos` and ignore `continueWatching` — do not show both or the
first video appears twice.

`modules.videos.inProgress` is the count. It matches `inProgressVideos.length`
until the cap, so bind a "See all" affordance to the count, not the array.

---

## Rendering a card

**Thumbnail, title, chapter title, and a progress bar from `watchedPercent`.**

**`watchedPercent` is nullable.** Null means the video's length is not stored
yet — "cannot tell", not 0%. Render the card **without a bar** rather than a
bar stuck at zero, which reads as "never started" for a video they are 40
seconds into. It fills in by itself: the player reports duration on the next
progress call and the field goes live.

Row two above shows both states side by side — `null` and `25` — and both are
correct.

**Format `lastPositionSeconds` as a resume label** — "Resume at 2:30".

---

## Playing it

```dart
// tap → straight into the player
VideoPlayerController.networkUrl(Uri.parse(video.videoUrl!))
  ..initialize().then((_) {
    controller.seekTo(Duration(seconds: video.lastPositionSeconds));
    controller.play();
  });
```

**Seek to `lastPositionSeconds` before playing**, not after — seeking after
play starts gives an audible jump from the beginning.

### `locked: true`

`videoUrl` comes back **null** and the card must open the paywall, not the
player. A locked row still carries `lastPositionSeconds` and
`watchedPercent` — the resume point is not the media, and a student who let a
subscription lapse should still see where they were.

Null-check `videoUrl` before constructing the controller. `locked` tells you
why it is null.

---

## Keeping it fresh

The player already posts progress every 10 seconds
(`PUT /api/users/me/lessons/:id/progress`). Each response carries `completed`
and `watchedPercent`.

When a video crosses the threshold and comes back `completed: true`, **remove
it from the local row** rather than refetching `/home`. It is no longer in
progress, and waiting for the next home load leaves a finished video sitting in
Continue Watching.

Refetch `/home` on pull-to-refresh and when returning to the tab, not after
every progress call.

---

## What to build

**Horizontal row** under the welcome card, titled "Continue Watching", built
from `inProgressVideos`. Thumbnail, title, chapter, progress bar, "Resume at
m:ss".

**Tap** — player, seeded from `videoUrl` and `lastPositionSeconds`. Paywall
when `locked`.

**Empty state** — hide the whole section when the array is empty. A "nothing in
progress" placeholder on a home screen is noise.

## Constraints

- Do not call `GET /lessons/:id` to play; `videoUrl` is already there.
- Render `inProgressVideos`, not `continueWatching`, once the row exists.
- `watchedPercent` and `durationSeconds` are nullable; null is not zero.
- `videoUrl` is null when `locked` — check before building a controller.
- Seek before play.
- Drop a video from the row when a progress response says `completed: true`.
