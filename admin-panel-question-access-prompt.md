# Task: free / premium on a question

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-cl2h.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

A question now carries the same free/premium choice a lesson does. Free
questions are served to everyone; premium ones only to students with a live
subscription.

---

## The field

| | |
|---|---|
| name | `accessType` |
| values | `"free"` · `"premium"` |
| default | `"free"` |
| required | no — omit it and the question is free |

Invalid values are refused:

```json
400 { "error": { "message": "accessType must be one of: free, premium" } }
```

It appears on **every** question response — list, detail, create, update — so
the table can show a chip without a second call.

---

## Endpoints

```
POST   /api/questions                  create — accepts accessType
POST   /api/questions/bulk             bulk create — accepts it per question
GET    /api/questions?accessType=      list — filter by it
GET    /api/questions/:id              detail — returns it
PUT    /api/questions/:id              update — accepts it, partial
```

### Create

```json
POST /api/questions
{ "subjectId": 7, "topicId": 9,
  "questionText": "Which artery is occluded in an inferior MI?",
  "difficulty": "medium",
  "marksCorrect": 1, "marksIncorrect": -0.25,
  "accessType": "premium",
  "options": [
    { "optionText": "Right coronary",   "isCorrect": true },
    { "optionText": "LAD",              "isCorrect": false },
    { "optionText": "Left circumflex",  "isCorrect": false },
    { "optionText": "Posterior descending", "isCorrect": false } ] }
```

Remember options are **4 minimum, 6 maximum**, exactly one correct.

### Update — partial

```json
PUT /api/questions/:id   { "accessType": "free" }
```

Sending only `accessType` leaves everything else alone. You do not have to
resend the options.

### List and filter

```
GET /api/questions?accessType=premium&subjectId=7&page=1&limit=20
```

Combines with the filters already there — `subjectId`, `topicId`,
`difficulty`, `status`, `search`, `sort`.

```json
{ "questions": [ { "id": 28, "questionText": "…", "difficulty": "easy",
                   "status": "inactive", "accessType": "free", … } ],
  "pagination": { "page": 1, "limit": 20, "total": 60, "totalPages": 3 } }
```

---

## What to build

**A toggle on the question form** — *Free* / *Premium*, defaulting to **Free**,
beside the existing difficulty and status controls. One control, two states; it
does not need its own section.

**A chip in the question list.** Premium questions want to be findable at a
glance, so give the chip a colour and leave free ones plain — most questions
will be free and a chip on all 60 rows is noise.

**A filter in the list toolbar** — All / Free / Premium, wired to
`?accessType=`.

**Bulk create** — if the importer builds the payload itself, add the column.
If it uploads a CSV, say in the help text that omitted means free.

**Do not add it to the quiz builder.** Access is a property of the question,
not of the quiz that happens to use it. The same question can appear in two
quizzes and must mean the same thing in both.

---

## One thing worth telling the admin

A **premium course already locks all its lessons**, so an unsubscribed student
never reaches the questions at all. This field only changes anything where the
student can already open the lesson:

- a **free course** holding some premium questions as a teaser
- a **free-preview lesson** inside a premium course, with a mix

On a fully premium course it does nothing — the course gate fires first. Worth
a line of help text under the toggle so an admin does not mark a hundred
questions premium expecting a change they will not see.

## How the gate behaves

A premium question is **dropped from the set**, not shown locked. A quiz is
answered end to end, and a locked question at number 7 of 20 would stop a
student finishing a paper they were entitled to take. A filter-based quiz
simply samples a replacement from the free pool.

## Constraints

- Default is `free`. Never send `premium` because a field was left blank.
- `PUT` is partial — send only `accessType` when that is all that changed.
- Values are exactly `free` and `premium`, lowercase.
- Access belongs to the question, not the quiz.
