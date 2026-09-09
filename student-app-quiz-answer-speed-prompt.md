# Task: make answering a quiz question feel instant

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`

**The API has not changed.** Same request, same response, same fields. The
server side of this endpoint got about 400ms faster on its own — this task is
only about the part the app controls.

---

## What is left, and why

```
POST /api/users/me/quiz-attempts/:attemptId/answers
{ "questionId": 2, "optionId": 216 }
```

```json
{ "attemptId": 17, "answeredCount": 3, "remainingCount": 0,
  "result": { "questionId": 2, "selectedOptionId": 216, "correctOptionId": 216,
              "isCorrect": true, "marksAwarded": 2,
              "explanation": "...", "options": [ ... ] } }
```

The remaining wait is the round trip to a database in another region. No amount
of app code removes it. What app code *can* do is stop the student staring at a
frozen screen while it happens.

**The answer key is not in the app.** `correctOptionId` and `explanation`
arrive only in this response — deliberately, so the payload the student
receives up front cannot be read to cheat. So you cannot reveal optimistically.
You can do everything else.

---

## Three changes

### 1. Fill the option immediately, before the request

Selecting an option is a local fact. Paint it the moment they tap:

```dart
setState(() {
  selectedOptionId = option.id;   // instant
  awaitingResult = true;
});
final result = await api.saveAnswer(attemptId, question.id, option.id);
setState(() {
  awaitingResult = false;
  revealed = result;
});
```

Today the radio probably fills when the response lands, which is what makes the
tap feel dead.

### 2. A small spinner where the answer will appear — not a screen blocker

While `awaitingResult`, show a slim progress line in the explanation area only.
Leave the question, the options and the app bar alive. A full-screen modal
turns 600ms into "the app hung".

Do disable the *other* options while in flight, so a second tap cannot race the
first.

### 3. Never re-fetch to get the counts

`answeredCount` and `remainingCount` come back in this response. Drive the
progress indicator from them.

Do **not** call `GET /quiz-attempts/:attemptId` after answering — that is a
second round trip for numbers you were just handed, and it is the most common
way an endpoint that got faster stops feeling faster.

---

## What not to do

**Do not pre-send the answer on selection and reveal on a timer.** The reveal
must come from the server response; guessing it will be wrong.

**Do not batch answers and submit at the end.** Per-question saving is what
survives the app being killed mid-quiz — the attempt resumes with the answers
already stored.

**Do not retry automatically on a slow response.** The upsert is idempotent so a
retry is safe, but a retry storm on a slow network makes it slower. One request
per tap.

---

## What to build

**Instant selection state**, decoupled from the network call.

**Inline pending state** in the reveal area, with the other options disabled.

**Counts from the response**, no follow-up fetch.

## Constraints

- No API change — do not adjust request or response models.
- The reveal comes from the server; never fabricate `correctOptionId`.
- One request per tap.
- Keep per-question saving; do not batch.
