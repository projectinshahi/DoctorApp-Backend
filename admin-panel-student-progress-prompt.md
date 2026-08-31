# Change: the student detail screen now shows how far that student has got

Paste this into Claude inside the **Flutter admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured from the live backend on 2026-08-31.

**Additive.** No existing field changed, no request changed, no status code
changed. `GET /admin/students/:id` gained four things.

---

## The endpoint — unchanged

```
GET /admin/students/:id
```

Note the path: **`/admin/students/:id`**, not `/api/admin/...`. That mount is
different from the tests endpoints and is easy to get wrong.

It already returned `student`, `selectedCourse`, `selectedCourseType`,
`subscriptions`, `hasActiveSubscription`, and `chapters`. All still there.

New: **`progress`**, **`recentQuizAttempts`**, **`recentTestAttempts`**, and
per-lesson/per-chapter progress inside `chapters`.

---

## 1. `progress` — the summary cards

Live, for a real student:

```json
"progress": {
  "lessons": { "total": 6, "completed": 4, "remaining": 2, "percent": 67 },
  "videos":  { "total": 3, "completed": 2, "inProgress": 1, "percent": 67 },
  "notes":   { "total": 1, "completed": 0, "percent": 0 },
  "quizzes": { "total": 2, "attempted": 2, "completed": 2, "remaining": 0, "percent": 100 },
  "qbank":   { "attempted": 5, "correct": 2, "wrong": 3, "accuracy": 40 },
  "tests":   { "attempted": 2, "submitted": 1, "bestScore": 1 },
  "bookmarks": { "questions": 0, "lessons": 1 },
  "lastActivityAt": "2026-08-31T05:32:46.967Z"
}
```

Build a row of cards: **Lessons 4/6 · Videos 2/3 · Notes 0/1 · Quizzes 2/2 ·
Accuracy 40% · Tests 1 submitted**, with `lastActivityAt` as "Last active".

### What each number counts, and what it does not

| field | meaning |
|---|---|
| `lessons.total` | **published** lessons in this student's course. Drafts excluded |
| `lessons.remaining` | `total - completed`, precomputed. Do not subtract yourself |
| `videos.inProgress` | started but not finished — **separate from `completed`** |
| `notes.*` | lessons of type `text` |
| `quizzes.attempted` | quiz lessons with at least one real attempt |
| `quizzes.completed` | quiz lessons with a *submitted* attempt |
| `qbank.attempted` | **distinct questions** answered, across every attempt |
| `qbank.accuracy` | `correct / attempted`, not out of the bank |
| `tests.bestScore` | highest submitted Grand Test score, **`null` if none** |
| `lastActivityAt` | latest of any progress, quiz or test activity. **Nullable** |

Three that will be misread if you skim:

**Drafts are excluded from every denominator.** A draft is not work the student
failed to do. So `lessons.total` here is smaller than the raw count in
`chapters` — that is correct, not a bug. Do not recompute it from
`chapters[].lessons.length`.

**`qbank.attempted` is distinct questions, not answers.** Retakes are
unlimited, so counting answer rows would report a student who retook one quiz
five times as having seen five times the bank.

**`videos.inProgress` is not part of `completed`.** A student halfway through
two videos is `completed: 0, inProgress: 2` — render both or they read as idle.

`percent` never reaches 100 until genuinely finished (199 of 200 is `99`), so
`percent == 100` is safe as a "done" badge.

---

## 2. Per-chapter progress

Each entry in `chapters` gained:

```json
{ "id": 16, "title": "Internal Medicine",
  "lessonCount": 2, "publishedCount": 2,
  "progress": { "total": 2, "completed": 2, "remaining": 0, "percent": 100 },
  "lessons": [ ... ] }
```

A bar per chapter, straight from `chapter.progress`. `lessonCount` includes
drafts, `progress.total` does not — show `progress.total` to an admin asking
"how much has this student done", and `lessonCount` only if the screen is about
authoring.

---

## 3. Per-lesson state

Each lesson inside a chapter gained:

```json
{ "id": 39, "title": "Obstetrics", "type": "video", "status": "published",
  "visibleToStudent": true, "unlockedByPlan": true,
  "completed": false,
  "lastPositionSeconds": 95,
  "lastActivityAt": "2026-08-31T05:32:46.967Z",
  "attempt": null }
```

- `completed` — video/note: the student marked it. quiz: its latest attempt was
  submitted. One flag; do not branch on `type` yourself.
- `lastPositionSeconds` — how far into the video. `0` for quiz lessons.
- `lastActivityAt` — nullable, null when never touched.
- `attempt` — quiz lessons only, `null` otherwise. Same object as everywhere
  else: `attemptId`, `completed`, `correctCount`, `score`, `attemptCount`.

`visibleToStudent` and `unlockedByPlan` are unchanged and still mean what they
did. A lesson can be `completed: true` while `visibleToStudent: false` — the
student finished it, then their subscription lapsed. Show it as completed and
locked, not as an inconsistency.

---

## 4. Attempt history

```json
"recentQuizAttempts": [
  { "attemptId": 7, "lessonId": 44,
    "quiz": { "id": 22, "title": "GYNACOLOGY" },
    "startedAt": "...", "completedAt": "...", "completed": true,
    "totalQuestions": 2, "answeredCount": 1, "correctCount": 0, "score": -0.5 } ],

"recentTestAttempts": [
  { "attemptId": 1, "test": { "id": 1, "name": "Grand Test 1" },
    "startedAt": "...", "submittedAt": "...", "submitted": true,
    "score": 1, "totalMarks": 2 } ]
```

Newest first, **capped at 20 each**. Retakes are unlimited, so an uncapped list
would grow without bound on exactly the students an admin looks at most. There
is no "load more" — if the screen needs full history, ask for a paginated
endpoint rather than assuming these arrays are complete.

`completed: false` on a quiz attempt means still in progress; `submitted:
false` on a test attempt means the same. `score` is genuinely negative when
negative marking bites — `-0.5` above. Never `abs()`, never render `--0.5`.

---

## What to build

**Progress card row** at the top of the student detail screen, from `progress`.

**Chapter accordions** with a bar from `chapter.progress`, and a tick per
lesson from `lesson.completed`. Show `lastPositionSeconds` as "12:45" on a
part-watched video.

**Two history tables** — Quizzes and Grand Tests — from the two arrays. Columns:
name, date, answered/total, correct, score, status.

**Last active** from `progress.lastActivityAt`, with a "never" state for null.

Nothing new is needed on the student *list* screen. If you want progress there,
ask — it would need a separate batched endpoint rather than a call per row.

## Constraints

- Extend the existing student detail screen, model and service.
- `tests.bestScore` and `lastActivityAt` are **nullable**.
- `attempt` is null on every non-quiz lesson.
- Don't recompute totals from `chapters` — the denominators exclude drafts and
  a local count will disagree.
- Scores can be negative.
- The path is `/admin/students/:id`, not `/api/admin/students/:id`.
