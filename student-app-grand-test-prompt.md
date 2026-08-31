# Task: build the Grand Test (real exam) flow in the student app

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Every response below was captured from the live backend on 2026-08-31.

---

## A Test is not a Quiz. Build it separately.

| | Quiz (practice) | Test (Grand Test) |
|---|---|---|
| questions | random draw from the bank, differs per student | **the same fixed paper for everyone** |
| feedback | after each question, immediately | **only after submitting** |
| timer | none | **server-enforced countdown** |
| ranking | none | **leaderboard** |

Do not reuse the quiz screens. Showing a correct answer mid-paper turns an exam
into practice, and it is the one thing this flow must not do.

---

## 1. List the tests

```
GET /api/users/me/courses/22/tests
```

```json
{ "tests": [ {
  "id": 1, "name": "Grand Test 1", "type": "GRAND_TEST",
  "totalQuestions": 2, "durationMinutes": 30,
  "marksCorrect": 1, "marksIncorrect": -0.25,
  "attemptCount": 1,
  "lastAttempt": { "attemptId": 1, "startedAt": "...", "submittedAt": "...",
                   "score": 1, "inProgress": false }
} ] }
```

Published tests only. `lastAttempt` decides the button with no second call:

- `lastAttempt: null` → **Start**
- `inProgress: true` → **Resume**
- `submittedAt` set → **View result** (and Retake — retakes are allowed)

Warn about `marksIncorrect` up front. `-0.25` per wrong answer changes how a
student plays the paper.

---

## 2. Start or resume

```
POST /api/users/me/tests/1/attempts        (no body)
```

**201** fresh, **200** resumed:

```json
{
  "attemptId": 1, "resumed": false,
  "test": { "id": 1, "name": "Grand Test 1", "totalQuestions": 2,
            "durationMinutes": 30, "marksCorrect": 1, "marksIncorrect": -0.25 },
  "startedAt": "2026-08-29T06:11:11.446Z",
  "secondsRemaining": 1800,
  "answered": [],
  "questions": [ {
    "id": 1, "questionOrder": 1,
    "questionText": "What does this show?", "questionImageUrl": "https://res.cloudinary.com/...",
    "optionA": "Afib", "optionAImageUrl": null,
    "optionB": "Sinus", "optionBImageUrl": null,
    "optionC": "VT", "optionCImageUrl": null,
    "optionD": "CHB", "optionDImageUrl": null } ]
}
```

No `correctOption`, no `explanation` — verified. All questions arrive at once,
so the paper can be paged locally with no further calls.

**`secondsRemaining` is the clock.** Start the countdown from it, not from
`durationMinutes` — a resumed attempt gets the real remaining time, not a fresh
30 minutes. Re-read it from every answer response to stay in sync with the
server; a paused app cannot pause the exam.

`resumed: true` returns `answered: [{ testQuestionId, selectedOption }]` —
restore those selections.

**Images:** render `questionImageUrl` and `option*ImageUrl` when non-null. A
question can be image-only (`questionText: null`) and so can an option — an ECG
or a slide is often the whole question. Both fields are nullable; handle either
being absent.

---

## 3. Answer, and change an answer

```
PATCH /api/users/me/test-attempts/1/answers/1
{ "selectedOption": "A" }
```

```json
{ "attemptId": 1, "testQuestionId": 1, "selectedOption": "A",
  "answeredCount": 1, "remainingCount": 1, "secondsRemaining": 1777 }
```

**No `isCorrect` in the response, deliberately.** Do not show right/wrong. Mark
the question as answered and move on.

Re-sending overwrites. To clear an answer back to "skipped":

```
DELETE /api/users/me/test-attempts/1/answers/1
```

That matters — a skipped question scores **0**, while a wrong one scores
`-0.25`. Without an "unmark" the student is stuck with a guess they regret.

`selectedOption` is `"A"|"B"|"C"|"D"`, case-insensitive on the way in.

Errors: **400** bad option or wrong question · **409** `This attempt has
already been submitted` · **409** `Time is up. This attempt was submitted
automatically.`

---

## 4. Submit

```
POST /api/users/me/test-attempts/1/submit
```

```json
{ "attemptId": 1,
  "test": { "id": 1, "name": "Grand Test 1", "durationMinutes": 30 },
  "startedAt": "...", "submittedAt": "...",
  "timeTakenSeconds": 39,
  "totalQuestions": 2, "totalMarks": 2, "score": 1,
  "correctCount": 1, "wrongCount": 0, "skippedCount": 1,
  "results": [ {
    "testQuestionId": 1, "questionOrder": 1, "questionText": "...",
    "selectedOption": "A", "correctOption": "A",
    "isCorrect": true, "answered": true, "marksAwarded": 1,
    "explanation": "...", "subject": "Cardiology", "topic": "MI" } ] }
```

Answers and explanations appear **here**, for the first time.

Safe to call twice — same result, not a 409. `results` covers every question
including skipped ones (`answered: false`, `selectedOption: null`,
`marksAwarded: 0`).

**The clock is the server's.** If it expires the backend submits for you, so
`secondsRemaining` hitting 0 in the app should trigger a submit, but treat the
409 as a normal path rather than an error — the server may have got there first.

`GET /api/users/me/test-attempts/1/result` re-opens the same sheet.

---

## 5. The leaderboard

```
GET /api/users/me/tests/1/leaderboard?limit=50
```

Live, with two real competitors:

```json
{
  "test": { "id": 1, "name": "Grand Test 1", "totalQuestions": 2, "totalMarks": 2 },
  "totalParticipants": 2,
  "me": { "rank": 2, "userId": 30, "name": "Keerthana Bineesh", "score": 1,
          "correctCount": 1, "wrongCount": 0, "skippedCount": 1,
          "timeTakenSeconds": 39, "attemptId": 1, "submittedAt": "..." },
  "entries": [
    { "rank": 1, "userId": 31, "name": "Theertha bineesh14", "avatarUrl": null,
      "score": 2, "correctCount": 2, "wrongCount": 0, "skippedCount": 0,
      "timeTakenSeconds": 8, "submittedAt": "..." },
    { "rank": 2, "userId": 30, "name": "Keerthana Bineesh", "score": 1,
      "correctCount": 1, "timeTakenSeconds": 39, "submittedAt": "..." }
  ]
}
```

### Four rules to render correctly

**`me` is returned separately as well as in `entries`.** Pin it to the bottom of
the screen. A student ranked 87th will never find themselves in a top 50, and
"where am I" is the question a leaderboard exists to answer. `me` is `null` if
they have not submitted an attempt.

**Ties share a rank and the next one skips** — `1, 2, 2, 4`. Do not renumber
rows by index; render `entry.rank`.

**Score ranks, time only breaks ties.** Show both columns so the ordering reads
as fair, and format `timeTakenSeconds` as `mm:ss`.

**One row per student — their best attempt.** `totalParticipants` is the number
of students, not the number of attempts, so `entries.length` is capped by
`limit` while `totalParticipants` is not.

Scores go **negative** with negative marking. Render `-0.5`, never `--0.5`, and
never `abs()`.

---

## What to build

**Test list** — cards with duration, question count, the negative-marking
warning, and Start/Resume/View-result from `lastAttempt`.

**Exam screen** — a persistent countdown from `secondsRemaining`, a question
grid showing answered/skipped/current, single-select A–D with images, and an
unmark control. No feedback of any kind.

**Submit confirmation** — "You have 3 unanswered questions" from
`remainingCount` before letting them finish.

**Result screen** — score, the three counts, `timeTakenSeconds`, then the full
review from `results` with the correct option highlighted and the explanation
underneath. Three states per row: correct, wrong (show both their pick and the
right answer), skipped.

**Leaderboard tab** — the ranked list, with `me` pinned.

## Constraints

- Do not reuse the quiz screens, models or services.
- Never display correctness before submit. The answer key is not in the payload.
- `questionText` and every `option*` are **nullable** — a question or an option
  can be an image alone.
- Drive the timer from `secondsRemaining`, resynced from each answer response.
- Treat the "time is up" 409 as a normal transition to the result screen.
- Render `entry.rank`, never a row index.
- Scores can be negative.
