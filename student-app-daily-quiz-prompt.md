# Task: build the Question of the Day screen

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Every response below was captured from the live backend on 2026-09-02.

---

## What this is

Ten questions from the student's course, drawn at random, **the same ten for
everyone that day**, replaced at midnight Gulf time.

Nobody schedules them. The set is derived from `(courseId, date)` with a seeded
shuffle, so tomorrow's quiz already exists and there is no admin screen to
populate and no overnight job to fail.

It is **not** the QBank and not a lesson quiz. Reuse the question card and the
option list; build the rest separately.

---

## 1. Today's set

```
GET /api/users/me/courses/22/daily-quiz
```

```json
{
  "course": { "id": 22, "title": "GP GULF LICENSING EXAM" },
  "date": "2026-09-02",
  "available": true,
  "attemptId": 3,
  "totalQuestions": 10,
  "answeredCount": 0,
  "remainingCount": 10,
  "completed": false,
  "currentStreak": 0,
  "nextSetAt": "2026-09-03T00:00:00+04:00",
  "questions": [ {
    "id": 15,
    "questionText": "At how many weeks of gestation is a fetus generally viable?",
    "questionImageUrl": null, "difficulty": "medium",
    "marksCorrect": 2, "marksIncorrect": -0.5,
    "subject": { "id": 9, "name": "OBGYN" },
    "topic": { "id": 11, "name": "Gynaecology" },
    "options": [ { "id": 268, "optionText": "24 weeks", "optionImageUrl": null, "displayOrder": 0 } ] } ],
  "answers": []
}
```

**No `explanation`, no `isCorrect` on any option.** Verified. The answer key
does not exist in this payload.

### This call creates the attempt — that is deliberate

The first `GET` of the day freezes the set. Call it when the student opens the
screen, not on app boot: opening the screen is the student choosing to start.

**It is safe to call repeatedly.** The set is frozen, so a refetch returns the
identical ten questions — verified twice in a row, and verified identical for a
second student on the same day. Pull-to-refresh cannot reroll the quiz.

### Resuming a half-finished set

`answers` is empty above, but on a partly-done day it carries what was already
submitted:

```json
"answers": [ { "questionId": 15, "selectedOptionId": 268, "isCorrect": true, "marksAwarded": 2 } ]
```

Restore those as already-answered and jump to the first unanswered question.
`answeredCount` and `remainingCount` drive the progress bar.

### `available: false`

```json
{ "available": false, "reason": "No questions are set up for this course yet.",
  "totalQuestions": 0, "questions": [] }
```

A real state, not an error — a course whose question bank is empty. Show
`reason`; do not show a spinner or an error toast.

---

## 2. Answer one question

```
POST /api/users/me/courses/22/daily-quiz/answers
{ "questionId": 15, "optionId": 268 }
```

```json
{ "questionId": 15, "selectedOptionId": 268,
  "isCorrect": true, "correctOptionId": 268,
  "explanation": "Viability is generally considered from around 24 weeks with NICU support.",
  "marksAwarded": 2,
  "answeredCount": 1, "remainingCount": 9, "allAnswered": false }
```

**The answer key arrives here and only here** — after the student commits.
Same shape as the QBank flow, so reuse that reveal component: highlight
`correctOptionId` green, their pick red when wrong, explanation underneath.

**One shot per question.** Re-answering is a **409** —
`You have already answered this question`. There is no changing your mind after
seeing the explanation, which is what makes the score mean anything. Disable
the options once answered.

Other errors: **400** `That question is not in today's set` · **409**
`You have already finished today's quiz` · **409** `Open today's quiz first`
(GET before POST).

Use `allAnswered: true` to move straight to the result screen.

---

## 3. Finish

```
POST /api/users/me/courses/22/daily-quiz/finish
```

```json
{ "date": "2026-09-02", "completedAt": "...",
  "totalQuestions": 10, "answeredCount": 5,
  "correctCount": 1, "wrongCount": 4, "skippedCount": 5,
  "score": 0, "accuracy": 20,
  "currentStreak": 1,
  "results": [ {
    "questionId": 15, "questionText": "...",
    "subject": "OBGYN", "topic": "Gynaecology",
    "options": [ { "id": 268, "optionText": "24 weeks", "isCorrect": true } ],
    "selectedOptionId": 268, "correctOptionId": 268,
    "answered": true, "isCorrect": true, "marksAwarded": 2,
    "explanation": "..." } ] }
```

**Safe to call twice** — returns the same sheet, not a 409. Call it both when
the last question is answered and when the student taps Finish; those can both
happen.

Three row states in the review: correct, wrong (show their pick *and* the right
one), and **skipped** — `answered: false`, `marksAwarded: 0`. A skipped
question is not a wrong one: it scores zero rather than the negative mark, and
the review must not paint it red.

`score` can be **negative** with negative marking. Render `-1.5`, never
`--1.5`.

`accuracy` is out of what they **answered**, not out of ten — so skipping nine
and getting one right is 100%, deliberately. Show `answeredCount` beside it.

---

## 4. History and streak

```
GET /api/users/me/courses/22/daily-quiz/history?days=30
```

```json
{ "days": 30, "currentStreak": 1,
  "history": [
    { "date": "2026-09-02", "attempted": true, "completed": true,
      "totalQuestions": 10, "answeredCount": 5, "correctCount": 1, "score": 0 },
    { "date": "2026-09-01", "attempted": false, "completed": false } ] }
```

**Every day in the window is present, including missed ones** — the gaps are
the point of a calendar. Newest first.

### The streak rule that matters

**Today being unfinished does not break the streak.** At 9am the day is not
lost, so `currentStreak` counts back from yesterday until today is done.
Telling a student their 40-day run ended before they have had breakfast is the
bug that kills the habit the feature exists to build.

---

## 5. The home screen card — MCQ of the Day

**Do not call `GET /daily-quiz` from the home screen.** That call starts the
day's attempt. A student who opened the app and never tapped the card would
have a started, unfinished quiz and a broken streak by midnight.

`GET /api/users/me/home` carries a read-only summary instead:

```json
"modules": {
  "videos": { ... }, "notes": { ... }, "qbank": { ... },
  "bookmarks": { ... },
  "dailyQuiz": {
    "date": "2026-09-02",
    "state": "notStarted",
    "totalQuestions": 10,
    "answeredCount": 0,
    "correctCount": null,
    "score": null,
    "currentStreak": 0,
    "nextSetAt": "2026-09-03T00:00:00+04:00"
  }
}
```

Verified: calling `/home` leaves the attempts table empty. Nothing starts until
the student opens the quiz.

### `state` is the card

| `state` | card | button |
|---|---|---|
| `notStarted` | "10 questions · today's set" | **Start** |
| `inProgress` | "`answeredCount` of `totalQuestions` answered" | **Continue** |
| `completed` | "`correctCount`/`totalQuestions` · score `score`" | **View result**, disabled until `nextSetAt` |

`correctCount` and `score` are **null until completed** — deliberately, so a
half-finished quiz cannot show a score that is really just "what you have got
right so far". Do not render them while `inProgress`.

`dailyQuiz` is `null` when the student has not selected a course yet. Hide the
card.

### The streak

`currentStreak` is on the card and on every daily-quiz response. Show it beside
the title — "🔥 4 days".

It does **not** drop to zero because today is unfinished; it counts back from
yesterday until today is done. So a student opening the app at 9am on day 5
sees "🔥 4", taps in, finishes, and sees "🔥 5". Never render it as lost before
the day is over.

### The countdown

`nextSetAt` is an ISO timestamp with the real `+04:00` offset. When
`state: "completed"`, count down to it — "New set in 4h 12m". Parse the offset;
do not assume the device timezone matches.

---

## What to build

**Home card** — from `modules.dailyQuiz` alone, per the table above. One call,
no side effects.

**Quiz screen** — one question at a time, options A–D, submit, reveal, Next.
The existing QBank card and reveal component work as they are.

**Result screen** — score, correct/wrong/skipped, accuracy, streak, then the
full review from `results`.

**Streak calendar** — a 30-day grid from `history`. Filled = completed,
outlined = attempted but unfinished, empty = missed.

## Constraints

- Do not call `GET /daily-quiz` on app launch or from the home screen; it
  starts the day's attempt. The home card reads `modules.dailyQuiz`.
- `correctCount` and `score` are null until the quiz is completed.
- Never reroll locally. The set is the server's, and refetching returns it
  unchanged.
- The answer key exists only in the answer and finish responses.
- Disable a question's options once answered — re-answering is a 409.
- `skipped` is its own state; it is not wrong.
- Scores can be negative; accuracy is out of answered, not out of ten.
- `questionImageUrl` and `optionImageUrl` are nullable, and an option may be an
  image alone.
