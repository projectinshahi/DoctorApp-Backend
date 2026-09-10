# Task: reveal the answer instantly in the QBank

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`

The practice-quiz question payload now carries its own answer key, so the app
marks the answer itself. **The reveal stops waiting for the network.**

This applies to the **QBank practice quiz only**. Grand Tests are unchanged and
must stay that way — see the bottom.

---

## What the payload gained

`POST /api/users/me/lessons/:lessonId/quiz-attempts` and
`GET /api/users/me/quiz-attempts/:attemptId` now return, per question:

```json
{ "id": 6,
  "questionText": "Which hepatitis virus is most associated with...",
  "difficulty": "medium", "marksCorrect": 2, "marksIncorrect": -0.5,
  "correctOptionId": 232,
  "explanation": "Hepatitis C progresses to chronic infection in most cases.",
  "options": [
    { "id": 232, "optionText": "Hepatitis C", "displayOrder": 0, "isCorrect": true },
    { "id": 233, "optionText": "Hepatitis A", "displayOrder": 1, "isCorrect": false }
  ] }
```

`correctOptionId` and `options[].isCorrect` always agree — exactly one option is
correct. `explanation` is nullable.

## What to change

**Mark the answer locally and reveal immediately:**

```dart
void onOptionTapped(Option option) {
  setState(() {
    selectedOptionId = option.id;
    isCorrect = option.isCorrect;            // no await, no spinner
    revealed = true;                          // explanation shows now
  });

  // Recorded in the background. The student is already reading the answer.
  api.saveAnswer(attemptId, question.id, option.id)
     .then((r) => setState(() {
        answeredCount = r.answeredCount;
        remainingCount = r.remainingCount;
      }))
     .catchError(queueForRetry);
}
```

**Delete the spinner and the disabled state on reveal.** They existed to cover
a 780ms round trip that no longer blocks anything.

**Still call `POST /quiz-attempts/:attemptId/answers`.** It is what stores the
attempt, so a quiz survives the app being killed, and it is what feeds the
review screen, the resume flow and the admin's per-student stats. It just no
longer gates the UI.

**Take the counts from its response** when it lands — `answeredCount` and
`remainingCount`. Do not re-fetch the attempt for them.

**If the save fails, queue and retry.** The student has already seen the
answer; losing the record silently would make their review screen wrong. A
simple in-memory queue flushed on the next successful call is enough — the
endpoint is an upsert, so re-sending the same answer is harmless.

## Finishing is unchanged

`POST /quiz-attempts/:attemptId/finish` still returns the scored review. Keep
using it as the source of truth for the review screen rather than what the app
computed locally — a queued save that never landed shows up there, and the
server's totals are the ones the admin sees.

---

## The rule that must not be broken

**Grand Tests do not do this.** Verified still true:

```
POST /api/users/me/tests/:testId/attempts
→ fields: id, questionOrder, questionText, questionImageUrl,
          optionA..optionD, option*ImageUrl, section
→ answer key leaked? NO
```

Tests are ranked, timed and compared on a leaderboard, so their key stays on
the server and is released only by `POST /test-attempts/:id/submit`. Never
reuse the QBank question model or the local-marking code in the test screens.

The QBank can do this precisely because it is practice: it reveals the answer
one tap later anyway, nothing is ranked, and no leaderboard exists. If a
leaderboard is ever added to the QBank, this has to be undone on the server
first.

## Constraints

- Local marking in the QBank only.
- Still POST every answer; retry on failure.
- Counts come from the save response, never a refetch.
- The review screen uses `/finish`, not local state.
- Do not touch the Grand Test flow.
