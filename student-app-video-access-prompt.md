# Task: a padlock per video, not per lesson

Paste this into Claude inside the **student app repo** (`dr_app`).

**Ship after backend branch `per-video-access` is deployed and its migration
`20261103090000_lesson_video_access` has run.** Until then every video comes
back without `locked`; treat that as "follow the lesson", as the app does today.

---

## What changed

An admin now sets **free or premium on each video**, not on the lesson. The
point is the free sample: Part 1 of a paid lesson open to everyone, Parts 2–5
behind a subscription.

The rule, enforced on the server:

| video | student without the right plan |
|---|---|
| free | plays, even inside a premium lesson or a premium course |
| premium | locked: no `videoUrl` in the payload |

The lesson's own access now covers only its **quiz, notes and text**.

## What the API sends now

### `GET /api/users/me/lessons/:id`

```jsonc
{
  "lesson": {
    "id": 42,
    "locked": false,          // true only when NOTHING inside opens
    "contentLocked": true,    // the quiz, notes and text are locked
    "videoUrl": "https://.../part1.mp4",   // video 1, null if video 1 is locked
    "videos": [
      { "id": 7, "title": "Part 1", "description": "Anterior pituitary…",
        "videoUrl": "https://.../part1.mp4", "thumbnailUrl": "...",
        "durationSeconds": 610, "accessType": "free", "locked": false },
      { "id": 8, "title": "Part 2", "description": null,
        "videoUrl": null, "thumbnailUrl": null,
        "durationSeconds": 455, "accessType": "premium", "locked": true }
    ],
    "quiz": null,             // null while contentLocked
    "noteUrl": null           // null while contentLocked
  },
  "requiredPlans": [...],     // the plans that open the locked parts
  "unlockOptions": [...]      // all course plans, when no specific plan is required
}
```

Two changes from before:

- A locked lesson used to come back with `videos: []`. **Locked videos are now
  listed**, with title, length and `locked: true`, and `videoUrl: null`.
- `requiredPlans` / `unlockOptions` are filled whenever **any** part is locked,
  not only when the whole lesson is.

### The course tree, home and saved lessons

- `GET /api/users/me/selection/content`: each lesson carries `videos[]`
  (with `accessType` and `locked`), plus `locked` and `contentLocked`.
- `GET /api/users/me/saved-lessons`: the same.
- Home `continueWatching` / `inProgressVideos`: `locked` and `videoUrl` now
  follow **video 1**, because progress is saved against video 1.

`locked` on a lesson row now means "nothing inside opens". A lesson with one
free part and four paid ones is **not** locked.

## What to build

### 1. Lesson screen: the video list

```
▶ [ player — Part 1 ]

VIDEOS · 5                                     1 free · 4 premium
  ● Part 1 — Anatomy         10:10   FREE
  🔒 Part 2                    7:35   PREMIUM
  🔒 Part 3                   12:02   PREMIUM
```

- Draw rows from `videos[]` in order. Show a small **FREE** chip on free rows
  and a padlock on rows where `locked` is true.
- Tap an open row: play it.
- Tap a locked row: open the existing paywall sheet with `requiredPlans`, or
  `unlockOptions` when that is empty. Do not try to play it: there is no URL.
- **Open on the first video that is not locked**, not blindly on video 1. If
  every video is locked, show the player's locked state with the paywall
  button.
- When a video ends, autoplay the next **open** one. Skip locked rows.
- Show `description` under the title when it is not null.

### 2. Quiz and notes

Hide or lock them on `contentLocked`, not on `locked`. A lesson can play its
free videos while its quiz is premium. Tapping a locked quiz opens the same
paywall.

### 3. Lesson rows (course tree, saved list)

- Padlock on the row only when `locked` is true.
- When some videos are locked and some are not, show a **FREE PREVIEW** chip
  (or "1 free · 4 premium") instead of a padlock, so a student knows there is
  something to watch.
- Remove any client-side rule that decides locks from `accessType` /
  `isFreePreview` on the lesson. The server's `locked` flags are the truth.
  The earlier `student-app-lesson-lock-prompt.md` fix is about the same thing.

### 4. Continue watching (home)

Unchanged: it is video 1. If its `locked` is true, the card opens the paywall.

## Known limit

Progress is still one position per lesson, against **video 1**. Save the
resume position only while video 1 plays; start the others at 0 and do not
send progress for them.

## Done when

With a student who has **no** subscription, on a lesson where Part 1 is free and
Parts 2–3 are premium:

1. The lesson row shows FREE PREVIEW, not a padlock.
2. The lesson opens and plays Part 1.
3. Parts 2 and 3 show padlocks. Tapping one opens the paywall and plays
   nothing.
4. When Part 1 ends, nothing auto-plays.
5. With a subscription that includes video lectures, all three play and no
   padlocks show.
6. A lesson whose videos are all premium still shows a padlock on its row.
