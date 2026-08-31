# Change: bookmark a lesson, the same way QBank bookmarks a question

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` — unchanged.

Every response below was captured from the live backend on 2026-08-31.

**Additive.** No existing field changed, no request body changed, no status code
changed.

---

## The three endpoints

```
POST   /api/users/me/saved-lessons             { "lessonId": 39 }
GET    /api/users/me/saved-lessons
DELETE /api/users/me/saved-lessons/:lessonId
```

Identical semantics to `/saved-questions`, so the two bookmark features can
share one service pattern.

**POST** → `201 { "saved": true, "lessonId": 39, "count": 3 }`
An upsert. Tapping twice is harmless — no duplicate, no error.

**DELETE** → `200 { "saved": false, "lessonId": 39, "removed": true, "count": 2 }`
Removing a bookmark that is already gone returns **200 with `removed: false`**,
not a 404. The end state is what was asked for.

**Both return `count`**, so the badge updates without a refetch. Never
recompute it from a list length.

---

## `isSaved` — draw the button without fetching anything

Every lesson now carries its own bookmark state:

```
GET /api/users/me/lessons/39          → lesson.isSaved, lesson.savedAt
GET /api/users/me/selection/content   → isSaved on every lesson in the tree
```

```json
{ "lesson": {
    "id": 39, "title": "Obstetrics", "type": "video",
    "isSaved": true, "savedAt": "2026-08-31T05:25:02.613Z",
    "completed": false, "lastPositionSeconds": 95, "locked": false } }
```

Live from the tree:

```
37 Cardiology      isSaved=false  done=true   pos=421
39 Obstetrics      isSaved=true   done=false  pos=95
44 GYNACOLOGY      isSaved=false  done=true   pos=0
```

`savedAt` is `null` when not saved. **Do not search the saved list to decide
whether to fill the icon** — that was the old workaround and it does not scale
to a tree of forty lessons.

For an instant toggle: flip `isSaved` optimistically, call POST or DELETE, and
reconcile from the `count` in the response.

---

## The saved list carries everything the tree does

```
GET /api/users/me/saved-lessons
```

```json
{
  "count": 1,
  "lessons": [
    {
      "id": 39, "title": "Obstetrics", "description": "...", "type": "video",
      "videoUrl": "...", "noteUrl": null, "noteFileType": null,
      "thumbnailUrl": "https://res.cloudinary.com/...", "chapter": { "id": 17, "title": "Obstetrics And Gynecology" },
      "accessType": "free", "isFreePreview": false, "quizId": null,

      "savedAt": "2026-08-31T05:25:02.613Z",
      "isSaved": true,
      "completed": false,
      "lastPositionSeconds": 95,
      "attempt": null,
      "locked": false,
      "plans": [], "planIds": []
    }
  ]
}
```

**This is the same shape as a lesson in the tree.** Reuse the existing lesson
model and the existing lesson card widget — do not build a second one. The
saved screen can show a progress tick, a resume position and a paywall with no
extra call per row.

Newest first. `count` is top level for the Bookmarks card.

### Fields worth calling out

| field | note |
|---|---|
| `completed` | video/note: the app said so. quiz: its latest attempt was submitted |
| `lastPositionSeconds` | seek here on open. `0` for quiz lessons |
| `attempt` | quiz lessons only, `null` otherwise — same object as in the tree |
| `locked` | `true` strips `videoUrl` and `noteUrl` but **keeps** `lastPositionSeconds` |
| `plans` | the plans that unlock it — feed the existing paywall sheet directly |
| `isSaved` | always `true` here. Present so one model serves both screens |

**Unpublished lessons are dropped from the list.** A bookmark must not
resurrect content an admin has taken down, so `count` can be lower than the
number the student saved. That is intended — do not treat the difference as an
error, and do not cache a stale count.

---

## What to build

**Bookmark button** — on the lesson detail and on each row in the chapter list.
Bind to `lesson.isSaved`, toggle with POST/DELETE, update the badge from
`count`.

**Saved Lessons screen** — the list endpoint, rendered with the *existing*
lesson card. Tapping a row opens the lesson and seeks to
`lastPositionSeconds`; tapping a locked row opens the paywall from `plans`.

**Bookmarks card on home** — `GET /home` already returns
`modules.bookmarks.lessons` and `modules.bookmarks.questions`. Two counts, two
tabs: Questions and Lessons.

Refresh the saved list when returning to it — progress and lock state move
independently of the bookmark.

## Constraints

- Reuse the lesson model, service and card. The shapes match on purpose.
- `isSaved` is a `bool`, never null. `savedAt` is nullable.
- `lastPositionSeconds` is an `int` defaulting to `0`; `completed` a `bool`
  defaulting to `false`. Neither is ever null.
- `attempt` is null on every non-quiz lesson.
- Don't read progress off a locked lesson's stripped media fields — `videoUrl`
  is null there, `lastPositionSeconds` is not.
- Don't derive the bookmark count from `lessons.length`; use `count`.
