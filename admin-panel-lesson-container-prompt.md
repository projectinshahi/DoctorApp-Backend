# Admin panel: a lesson holds several videos, its quiz and its decks

The backend changed. A lesson is no longer "one video **or** one quiz" — it is
a container that can hold **several videos**, **a quiz**, and the **Rapid
Recall decks** filed against it, all at once. The client asked for this.

Live now on `https://doctorapp-backend-cl2h.onrender.com`.
Backend commit `dda141a`.

Nothing you have today breaks. `lesson.videoUrl` is still sent and still
holds the first video. If you ship none of this, the panel keeps working as a
one-video panel.

---

## 1. What the API now accepts

### `POST /api/chapters/:chapterId/lessons` and `PATCH /api/lessons/:id`

One new field on the body:

```jsonc
{
  "title": "Cardiology",
  "type": "video",
  "quizId": 12,            // ← allowed on a video lesson now. See §3.
  "videos": [
    {
      "videoUrl": "https://res.cloudinary.com/.../one.mp4",  // required
      "title": "Part 1 — Anatomy",                            // optional
      "videoPublicId": "lesson_videos/abc",                   // optional
      "thumbnailUrl": "https://.../frame.jpg",                // optional
      "durationSeconds": 610                                  // optional
    },
    { "videoUrl": "https://res.cloudinary.com/.../two.mp4", "title": "Part 2" }
  ]
}
```

Rules, exactly as the server applies them:

| You send | What happens |
|---|---|
| no `videos` key at all | the lesson's videos are left alone |
| `"videos": []` or `"videos": null` | every video is removed |
| `"videos": [a, b, c]` | the list becomes exactly a, b, c — **replace-all** |

- **Order is the array's order.** There is no `displayOrder` to send. Reorder
  in the panel by reordering the list. The server numbers them 0, 1, 2.
- **`videoUrl` is the only required field** on a row. A row without one is a
  `400`: `videos[0].videoUrl is required`.
- A title that is blank or only spaces is stored as no title.
- `durationSeconds` must be a number if present, otherwise
  `400 videos[0].durationSeconds must be a number`.

Because it is replace-all, **always send the full list the form is
showing** — including rows the admin did not touch. A row you leave out is a
row the admin deleted.

### Uploading

Unchanged. `POST /api/uploads/lesson-video` (multipart, field `video`) still
returns exactly what a row needs:

```json
{ "url": "...", "publicId": "lesson_videos/abc", "durationSeconds": 610.4 }
```

Call it once per video and map `url → videoUrl`, `publicId → videoPublicId`,
`durationSeconds → durationSeconds`. The server rounds the duration.

---

## 2. What the API now returns

Every lesson response — create, update, list, detail — carries two new arrays:

```jsonc
{
  "lesson": {
    "id": 42,
    "type": "video",
    "videoUrl": "https://.../one.mp4",   // ← still here: video 1, unchanged
    "videoPublicId": "lesson_videos/abc",
    "durationSeconds": 610,               // ← video 1's length
    "thumbnailUrl": "https://.../cover.jpg",  // the lesson's cover image, NOT a video frame

    "videos": [
      { "id": 7, "title": "Part 1 — Anatomy", "videoUrl": "...", "videoPublicId": "...",
        "thumbnailUrl": null, "durationSeconds": 610, "displayOrder": 0 },
      { "id": 8, "title": "Part 2", "videoUrl": "...", "videoPublicId": null,
        "thumbnailUrl": null, "durationSeconds": 455, "displayOrder": 1 }
    ],

    "quizId": 12,
    "quiz": { "id": 12, "title": "Cardiology MCQ", "questionCount": 40, "status": "active" },

    "rapidRecalls": [
      { "id": 3, "title": "ECG patterns", "status": "published", "displayOrder": 0 }
    ]
  }
}
```

- `videos[]` is ordered and may be empty.
- `videoUrl` / `videoPublicId` / `durationSeconds` on the lesson mirror
  `videos[0]`. Read them if you only want the first video; do not write them
  and `videos` in the same request — `videos` wins.
- `thumbnailUrl` on the lesson is the **cover image** from the form. It is
  deliberately not touched by the video list.
- `rapidRecalls[]` is **read-only here.** Decks are still created and edited
  on the Rapid Recall screen, which already has the Course → Exam type →
  Subject → Lesson picker. This array only tells you what is attached.

---

## 3. The quiz is no longer locked to `type: "quiz"`

The old rule — `quizId can only be set when type is 'quiz'` — is gone.

`type` now means **what the lesson leads with**, not all it may hold. A
`type: "video"` lesson with three videos and a quiz is valid and is what the
client wants.

Still enforced: the quiz must exist, must be `active`, and one quiz can only
be attached to one lesson (`Quiz 12 is already linked to lesson 9`).

---

## 4. What to change in the Add / Edit Lesson sheet

Working from the sheet as it is today (Lesson Title · Description · Publish
Status · Primary Type · Free preview · Cover image · …):

**a. Replace the single video field with a Videos list.**

```
VIDEOS                                            + Add video
Write as many as the lesson needs — they are all saved together.
Drag to reorder; the order on screen is the order students get.

┌ ⠿  Video 1                                              🗑 ┐
│    Title · optional    [ Part 1 — Anatomy            ]     │
│    [ ✔ one.mp4 · 10:10 ]                      Replace      │
└────────────────────────────────────────────────────────────┘
┌ ⠿  Video 2                                              🗑 ┐
│    Title · optional    [ Part 2                      ]     │
│    [ ✔ two.mp4 · 7:35 ]                       Replace      │
└────────────────────────────────────────────────────────────┘
```

Reuse the Rapid Recall notes editor's list — same add / drag / delete
behaviour, same "the order on screen is the order students get" sentence. It
already does exactly this job one screen over.

A lesson with no videos is valid (a quiz-only lesson). Do not block save on
an empty list; do block save on a row whose upload has not finished.

**b. Show the quiz picker regardless of Primary Type.** It is currently
revealed only when `quiz` is selected. Show it always, labelled something like
"Quiz · optional — attach a quiz students take inside this lesson."

**c. Add a read-only Rapid Recall strip.** List `lesson.rapidRecalls` by
title with its status chip, and a "Manage on the Rapid Recall screen" link.
When it is empty say so — "No revision decks filed against this lesson yet" —
rather than hiding the section, so an admin knows the slot exists.

**d. Keep Primary Type, change its help text.** It no longer decides what the
lesson may contain, only what students see first. Something like: "What this
lesson leads with. It can still hold videos and a quiz together."

**e. The lesson row in the syllabus list** (the screen with the Video /
PUBLISHED / Premium / Any subscription chips) should count what is inside:
`2 videos · Quiz · 1 deck` instead of a bare `Video` chip, when there is more
than one thing.

---

## 5. Worth knowing

- **Existing lessons are already migrated.** Every lesson that had a video now
  has exactly one row in its `videos` list, so the new editor is never empty
  for content that already exists.
- **Progress is still per lesson, not per video.** `lastPositionSeconds` is
  one number against the whole lesson. A student who gets halfway through
  video 3 resumes at that number, which the player will apply to video 1.
  Say so in the UI if it matters; the backend can add per-video progress when
  someone asks for it.
- **Access is still per lesson.** A premium lesson locks everything inside it
  — all videos, the quiz, the decks. There is no per-video pricing, and the
  entitlement checked is the one for `type` (`video` → `video_lecture`,
  `quiz` → `mcq`). A lesson that leads with video but also holds a quiz is
  checked as a video lesson.
- A locked lesson comes back to students with `videos: []`, so no URL leaks
  past the paywall.
