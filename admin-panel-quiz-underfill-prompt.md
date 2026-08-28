# Change: quiz responses now carry pool counts

Paste this into Claude inside the **Flutter admin panel repo**.

This is **additive**. Every existing field on every quiz response is unchanged
and every current screen keeps working untouched. Three new fields appear on
four endpoints, and one new warning belongs in the UI.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` — unchanged.

---

## The problem this solves

A quiz is not a list of questions. It is a **filter** — subject + topic (+
optional examTag) — resolved fresh every time a student opens it.

So `questionCount: 10` does not mean "this quiz has 10 questions". It means
"serve up to 10 of whatever matches". If the bank only holds 4 matching
questions, the student silently gets 4. No error, no warning, nothing in any
response to notice it by.

That is happening right now: **quiz 1 asks for 10 and the pool has 4.**

The backend can't reject it — the filter is legitimate and the bank might fill
up tomorrow. So it reports the numbers instead, and the panel warns.

---

## The three new fields

| field | meaning |
|---|---|
| `availableQuestions` | how many active questions the filter actually matches right now |
| `servedQuestions` | how many a student will really get — `min(questionCount, availableQuestions)` |
| `isUnderfilled` | `true` when `questionCount > availableQuestions` |

Plus `mode`, which already existed on `GET /api/quizzes/:id` and now appears
everywhere: `"filter"` (draws from the pool) or `"manual"` (admin pinned
specific questions).

They now appear on:

```
POST  /api/quizzes           ← new here
GET   /api/quizzes           ← new here
PUT   /api/quizzes/:id       ← new here
GET   /api/quizzes/:id       ← already had them
GET   /api/quizzes/:id/preview  ← already had them
```

Example — a quiz that promises more than the bank holds:

```json
{
  "quiz": {
    "id": 1, "title": "DHA Cardiology Practice", "status": "active",
    "subjectId": 7, "topicId": 4, "examTag": null,
    "questionCount": 10,

    "mode": "filter",
    "availableQuestions": 4,
    "servedQuestions": 4,
    "isUnderfilled": true
  }
}
```

`isUnderfilled` is always `false` when `questionCount` is `null` — that means
"serve the whole pool", which cannot fall short. An empty pool with no
`questionCount` is empty, not underfilled.

---

## What to build

### 1. Warn when a quiz is saved

`POST /api/quizzes` and `PUT /api/quizzes/:id` still return **201/200**. The
save succeeded — do not treat `isUnderfilled` as an error and do not block it.

Show a non-blocking warning after a successful save:

> **Only 4 of 10 questions available.** Students will see 4. Add more
> Cardiology questions to the bank, or lower the question count.

This is the moment the admin can actually act on it. Nobody reopens a quiz they
just created, which is why reporting it on read alone was not enough.

### 2. Badge the quiz list

`GET /api/quizzes` now carries the counts for every quiz, so the list can badge
without extra calls. Show `servedQuestions / questionCount` per row and an
"Underfilled" chip when `isUnderfilled`.

Add a filter or sort for underfilled quizzes if the list grows — there are 21
quizzes today and 1 is underfilled.

### 3. Re-check the list after changing questions

Deactivating or deleting a question shrinks the pool of every quiz whose filter
matched it, which can underfill quizzes that were fine a moment ago.

There is no new endpoint for this and none is needed: **refetch
`GET /api/quizzes` after any question status change or delete** and the badges
update themselves. `DELETE /api/questions/:id` already returns
`affectedQuizzes` — the count of quizzes whose pool shrank — which is worth
showing in the confirmation, but the badges are the durable answer.

### 4. Show `mode` on the quiz detail screen

- `"filter"` — the quiz draws from the pool. Show the subject/topic filter
  editor and the pool counts.
- `"manual"` — the admin pinned an explicit set via
  `PUT /api/quizzes/:id/questions`. Show the question picker instead, and note
  that `availableQuestions` is the pinned count, not a pool size.

**No quiz is in manual mode today** — all 21 use filters. Pinning is deployed
and unused. It is how you would build a fixed-question mock test, where every
student must see the identical paper, as opposed to a practice quiz that draws
a fresh random set each time.

---

## What did NOT change

- Every existing field on every quiz response.
- Every request body. `POST`/`PUT` take exactly the same fields as before.
- Status codes. An underfilled quiz still saves with 201/200.
- All question bank endpoints.
- The student app. **It needs no changes at all** — these fields are on admin
  endpoints only, and the student serve is untouched.

If the quiz model is generated or strictly typed, the three fields must be
added or parsing will drop them. If it is a lenient map-based model, the new
fields simply appear.

---

## Constraints

- Extend the existing quiz service, model, and screens. No parallel set.
- `isUnderfilled` is a warning, never an error. Never block a save on it.
- Show `servedQuestions`, not `questionCount`, when telling an admin what
  students will actually see. `questionCount` is the request; `servedQuestions`
  is the reality.
