# Task: edit a test, see its leaderboard, and watch live attempts

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured against the live database on 2026-09-01.

---

## 1. Edit a test — `PATCH /api/admin/tests/:testId`

```
PATCH /api/admin/tests/11
{ "name": "Grand Test 3", "totalQuestions": 8, "durationMinutes": 25,
  "marksCorrect": 2, "marksIncorrect": -0.5, "courseTypeId": 20 }
```

Every field is optional; send only what changed.

```json
{ "test": { "id": 11, "name": "Grand Test 3", "totalQuestions": 8,
            "durationMinutes": 25, "marksCorrect": 2, "marksIncorrect": -0.5,
            "courseTypeId": 20, "courseType": { "id": 20, "title": "DHA (Dubai) Exam" },
            "isPublished": false, "isLocked": false,
            "questionCount": 0, "attemptCount": 0, "readyToPublish": false },
  "unpublished": false }
```

### One rule, and the UI has to say it

**Once a single student has started the paper, only `name` can change.**

```json
409
{ "error": { "message": "3 student(s) have already started this test, so only the name can be changed. Create a new test instead — editing this one would rewrite their results." },
  "attemptCount": 3, "lockedFields": ["durationMinutes"] }
```

That is not caution, it is arithmetic. `marksCorrect` is stored **per answer at
the moment the student answers**, so raising it mid-paper would score one
attempt two different ways. `durationMinutes` is the deadline of an attempt
running right now. `totalQuestions` is what the score is out of.
`courseTypeId` decides who can see the paper — moving it hides the test from
the very students who sat it.

So: **read `attemptCount` from the test and disable those five fields when it
is above zero.** Leave the name field enabled. Show a line under the form —
"3 students have started this test; only the name can be changed" — rather than
letting an admin fill in a form that will 409.

### Editing a published test drops it back to draft

Change anything except the name and `isPublished` flips to `false`, and the
response says so:

```json
{ "test": { ..., "isPublished": false }, "unpublished": true }
```

Toast it: *"Test unpublished — review it and publish again."* An admin who
changes the duration of a live paper and does not notice it went dark is a
support ticket.

Re-publish with the existing `POST /api/admin/tests/:testId/publish`.

### Validation errors, all **400**

| body | message |
|---|---|
| `{"name": ""}` | `name cannot be empty` |
| `{"marksIncorrect": 0.5}` | `marksIncorrect must be zero or negative (e.g. -0.25)` |
| `{"marksCorrect": 0}` | `marksCorrect must be greater than zero` |
| `{"durationMinutes": 0}` | `durationMinutes must be a positive integer` |
| `{"courseTypeId": 28}` | `That course type belongs to a different course` |
| `{}` | `Nothing to update` |

And **409** if `totalQuestions` is dropped below the questions already
imported:

```json
{ "error": { "message": "This test already holds 10 questions. Clear them first to shrink it to 8." },
  "questionCount": 10 }
```

`courseTypeId: null` is valid — it widens the paper back to the whole course.

---

## 2. The leaderboard — `GET /api/admin/tests/:testId/leaderboard?limit=100`

```json
{
  "test": { "id": 1, "name": "Grand Test 1", "course": { "id": 22, "title": "GP GULF LICENSING EXAM" },
            "totalQuestions": 2, "attemptCount": 3, "isPublished": true, "isLocked": true },
  "totalMarks": 2,
  "totalParticipants": 2,
  "stats": { "highest": 2, "lowest": 1, "average": 1.5, "median": 1.5, "fastestSeconds": 8 },
  "entries": [
    { "rank": 1, "userId": 31, "name": "Theertha bineesh14", "email": "bineeshtheertha2@gmail.com",
      "score": 2, "correctCount": 2, "wrongCount": 0, "skippedCount": 0,
      "timeTakenSeconds": 8, "attemptCount": 1, "attemptId": 3, "submittedAt": "..." },
    { "rank": 2, "userId": 30, "name": "Keerthana Bineesh", "email": "keerthanabineesh5@gmail.com",
      "score": 1, "correctCount": 1, "wrongCount": 0, "skippedCount": 1,
      "timeTakenSeconds": 39, "attemptCount": 2, "attemptId": 1, "submittedAt": "..." }
  ]
}
```

**This is the student leaderboard, from the same function.** An admin
explaining "why am I 4th?" has to be quoting the number the student was shown,
not a second ordering that happens to agree most of the time.

Two differences only: unpublished papers are visible here, and rows carry
`email`.

### Reading it correctly

- **Score ranks; time only breaks ties.** Show both columns.
- **Ties share a rank and the next skips** — `1, 2, 2, 4`. Render `entry.rank`,
  never the row index.
- **One row per student, their best attempt.** `attemptCount` is how many times
  that student sat it — a rank-1 first attempt and a rank-1 sixth attempt are
  not the same result, so put that column on the table.
- `totalParticipants` counts students, not attempts, and is **not** capped by
  `limit`.
- Scores go negative with negative marking. Render `-0.5`, never `--0.5` or
  `abs()`.
- `stats` is `null` when nobody has submitted.

**`median` is there next to `average` on purpose.** One abandoned zero drags a
mean down far enough to misread a cohort that mostly did fine.

### Leaderboard vs the attempts table

You already have `GET /api/admin/tests/:testId/attempts` — keep both, as two
tabs:

| | Leaderboard | Attempts |
|---|---|---|
| rows | one per student, best only | **every attempt, including retakes** |
| ranked | yes | no, sorted by score |
| for | publishing a result | investigating one |

---

## 3. Live attempts — `GET /api/admin/test-attempts/in-progress`

Who is sitting an exam **right now**, across every test.

```json
{ "pagination": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 },
  "liveCount": 1, "expiredCount": 0,
  "attempts": [ {
    "attemptId": 6,
    "student": { "id": 30, "name": "Keerthana Bineesh", "email": "...", "avatarUrl": null },
    "test": { "id": 10, "name": "test 1", "totalQuestions": 10, "durationMinutes": 30 },
    "startedAt": "2026-09-01T04:13:09.347Z",
    "deadlineAt": "2026-09-01T04:43:09.347Z",
    "secondsRemaining": 1524,
    "expired": false,
    "answeredCount": 1, "remainingCount": 9 } ] }
```

Filters: `?testId=`, `?courseId=`, `?page=`, `?limit=` (max 100).

### `expired` is the field that matters

An attempt whose time is up is only closed when the student next touches it, so
the table holds two different things:

- `expired: false` — a student is writing. Count it in `liveCount`, show
  `secondsRemaining` as a live `mm:ss` countdown.
- `expired: true` — they walked away. The paper submits itself on their next
  request. Show it greyed, as "Abandoned", under `expiredCount`.

Rendering both as "in progress" would report a room full of candidates who left
hours ago.

`secondsRemaining` is computed when the response is built, so tick it down
locally and refetch every 30–60s rather than every second.

`answeredCount / totalQuestions` gives you a progress bar per candidate.

---

## 4. Student detail already carries their exam history

`GET /admin/students/:id` — the existing endpoint. Two fields are new.

```json
"progress": { "tests": { "attempted": 5, "submitted": 4, "inProgress": 1, "bestScore": 1 } }
```

```json
"recentTestAttempts": [ {
  "attemptId": 4, "test": { "id": 1, "name": "Grand Test 1", "totalQuestions": 2, "marksCorrect": 1 },
  "startedAt": "...", "submittedAt": "...", "submitted": true,
  "timeTakenSeconds": 232, "score": 0.75, "totalMarks": 2,
  "leaderboard": { "rank": 2, "totalParticipants": 2, "bestScore": 1,
                   "correctCount": 1, "wrongCount": 0, "skippedCount": 1,
                   "timeTakenSeconds": 39, "attemptCount": 2 } } ]
```

**`leaderboard` is this student's standing in that paper**, from the same
ranking the students see. Render it as `Rank 2 of 2`.

Two things to hold on to:

- It is **identical across their retakes of the same test**, because a
  leaderboard ranks students, not attempts. `rank` on the row is not the rank
  of *that* attempt.
- It is **`null` while an attempt is still running** (`submitted: false`) —
  there is no result to rank yet. `timeTakenSeconds` is `null` there too.

So `leaderboard.bestScore` can be higher than the row's own `score`: the row is
one attempt, `bestScore` is their best. That is the point of showing both.

`progress.tests.inProgress` is the count of unsubmitted attempts — a badge for
"currently sitting an exam".

---

## 5. Deleting an exam students have already sat

`DELETE /api/admin/tests/:testId` refuses, and the refusal tells you how:

```json
409
{ "error": { "message": "Cannot delete: 3 student attempt(s) exist, 3 of them completed. Unpublish it instead — deleting erases their results permanently." },
  "attemptCount": 3, "submittedCount": 3,
  "canForce": true,
  "forceWith": "DELETE /api/admin/tests/1?deleteAttempts=true" }
```

Repeat the call with that flag and it goes:

```json
200
{ "message": "Deleted \"zz-temp\" with 1 question(s) and 0 image(s). This also erased 1 student attempt(s) and 1 answer(s).",
  "deletedQuestions": 1, "deletedImages": 0,
  "deletedAttempts": 1, "deletedAnswers": 1 }
```

**Nothing brings those results back** — scores, ranks and review sheets go
with the paper, and there is no undo. So build the two steps as two steps:

1. First call. On the 409, show a dialog quoting `attemptCount` and
   `submittedCount`, and lead with **Unpublish** as the primary button — it
   hides the paper from students and keeps every result. That is what an admin
   wants nine times out of ten.
2. Behind a secondary, destructive-styled button: make them type the test name
   to enable it, then send `?deleteAttempts=true`.

A test with **no** attempts deletes on the first call with no flag, as before.
`deletedAttempts` and `deletedAnswers` come back either way — report them in
the success toast so the admin sees what actually went.

---

## What to build

**Test form** — an Edit button on each test card opening the same form as
Create, pre-filled. Disable everything but the name when `attemptCount > 0` and
say why. Warn before saving a published test that it will go back to draft.

**Test detail tabs** — Questions (preview) · Attempts · **Leaderboard** ·
Analytics. The leaderboard tab is a ranked table with the `stats` strip above
it: highest, average, median, fastest.

**Delete flow** — the 409 dialog above. Unpublish primary, type-the-name
delete secondary.

**Live attempts page** — the in-progress table, auto-refreshing on a timer,
split into Live and Abandoned by `expired`. Link each row to the student
detail.

**Student detail** — a Grand Tests section from `recentTestAttempts`, each row
showing score out of `totalMarks`, time taken, and `Rank n of m`.

## Constraints

- `attemptCount` on the test drives what the edit form allows. Do not
  re-derive it.
- Render `entry.rank`, never a row index.
- Scores can be negative.
- `stats` is `null` with no submissions; `leaderboard` is `null` on an
  unsubmitted attempt.
- Do not merge the Leaderboard and Attempts tabs — one hides retakes on
  purpose, the other exists to show them.
- Never send `?deleteAttempts=true` from the first click. The flag exists so
  that destroying results takes a deliberate second action.
