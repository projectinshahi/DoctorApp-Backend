# Task: exam instructions screen and section headers

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Captured from the live backend on 2026-09-01. This adds two things to the Grand
Test flow already described in
[student-app-grand-test-prompt.md](student-app-grand-test-prompt.md) — nothing
else about that flow changes.

---

## 1. Instructions, before the timer starts

`GET /api/users/me/courses/22/tests` now returns `instructions` on every card:

```json
{ "id": 14, "name": "Grand Test 3", "totalQuestions": 4, "durationMinutes": 10,
  "marksCorrect": 1, "marksIncorrect": -0.25,
  "instructions": "Answer all questions. Part A is Anatomy, Part B is Physiology. Negative marking applies.",
  "attemptCount": 0, "lastAttempt": null }
```

It is also on `test` in the start response.

**Build an instructions screen between the card and the paper.** Tapping Start
shows the rules with a "Begin test" button; the countdown starts on the second
tap, not the first.

That is not decoration. `POST /tests/:id/attempts` **starts the clock on the
server** — `startedAt` is set the moment it is called. A student who lands
straight on question 1 and then reads the rules is reading them on exam time.
So call the start endpoint from the **Begin** button, never from **Start**.

Alongside the admin's text, show what the app already knows:

- `durationMinutes` — "10 minutes"
- `totalQuestions` — "4 questions"
- `marksCorrect` / `marksIncorrect` — **"+1 correct, −0.25 wrong"**, and say
  plainly that skipping scores 0. That changes how a student plays the paper
  and it is the one thing they must know before the first tap.

`instructions` is **nullable**. On a paper without them, show the derived facts
alone — do not skip the screen, and do not render an empty box.

On **Resume**, skip this screen. The clock is already running; making them
re-read the rules costs them exam time.

---

## 2. Sections — the paper's parts

`POST /api/users/me/tests/:testId/attempts` now returns a `sections` summary,
and every question carries a `section`:

```json
{ "attemptId": 12, "resumed": false,
  "test": { "id": 14, "name": "...", "instructions": "..." },
  "secondsRemaining": 600,
  "sections": [
    { "name": "Part A", "questionCount": 2, "firstOrder": 1, "lastOrder": 2 },
    { "name": "Part B", "questionCount": 2, "firstOrder": 3, "lastOrder": 4 }
  ],
  "answered": [],
  "questions": [
    { "id": 238, "questionOrder": 1, "section": "Part A",
      "questionText": "Which bone is the longest?", "questionImageUrl": null,
      "optionA": "Femur", "optionAImageUrl": null, ... } ] }
```

Verified: no `correctOption`, no `explanation`. The answer key still arrives
only on submit.

### Render headers by walking the list, not by grouping

Emit a section header whenever `section` differs from the previous question's.

Do **not** group questions by section and render the groups — that silently
reorders the paper. Sections can interleave if an admin reordered questions
(the backend flags it to them, but the app must render what it is given, in
`questionOrder`).

### `section` is nullable

Most papers have none — every question comes back with `section: null`. Render
no headers at all in that case, exactly as the app does today. A paper can also
be half-labelled; a `null` question simply gets no header.

### Where sections earn their place

- **The question grid.** Group the jump-to-question pad by section, with the
  part name above each block. `firstOrder`/`lastOrder` give you the range
  without scanning the questions.
- **A progress line per part** — "Part A: 2 of 2 answered" — from the same
  ranges against your answered set.
- **The app bar**, showing the current question's part while scrolling.

`sections` is `[]` on a paper with no parts. Guard on that rather than on
`questions[0].section`.

---

## What to build

**Instructions screen** — the admin's text plus duration, question count and
the marking line. "Begin test" is what calls the start endpoint. Skipped on
resume.

**Section headers** in the question list, emitted on change.

**Sectioned question grid**, with per-part answered counts.

## Constraints

- Call `POST /attempts` from **Begin**, not from **Start** — it starts the
  server clock.
- `instructions` and `section` are both **nullable**; `sections` can be `[]`.
- Render questions in `questionOrder`. Never group by section.
- Nothing else about the timer, answering, submit or leaderboard changes.
