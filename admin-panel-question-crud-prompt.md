# Task: build question create + read in the Flutter admin panel

Paste this into Claude inside the **Flutter admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response body below was captured from the live backend on 2026-08-21.

---

## Availability — read this first

| endpoint | status |
|---|---|
| `POST /api/questions` | **live now** |
| `GET /api/questions` | **live now** |
| `GET /api/questions/:id` | **live now** |
| `PUT /api/questions/:id` | **live now** |
| `DELETE /api/questions/:id` | **live now** |
| `PATCH /api/questions/:id/status` | **live now** |
| `PATCH /api/questions/bulk-status` | **live now** |
| `POST /api/questions/bulk` | **not deployed yet — currently 404** |

Build against the live ones. The bulk-create section is marked clearly; leave it
behind a flag or build it last.

---

## 1. Create one question

```
POST /api/questions
```

Request:

```json
{
  "subjectId": 7,
  "topicId": 6,
  "questionText": "Which lab finding confirms the diagnosis of diabetic ketoacidosis?",
  "questionImageUrl": null,
  "difficulty": "medium",
  "marksCorrect": 2,
  "marksIncorrect": -0.5,
  "explanation": "DKA is defined by hyperglycemia, ketosis, and metabolic acidosis.",
  "status": "active",
  "tags": ["endocrinology", "dha", "doh"],
  "options": [
    { "optionText": "Hyperglycemia, ketosis, and acidosis", "optionImageUrl": null, "isCorrect": true,  "displayOrder": 0 },
    { "optionText": "Hyperglycemia alone",                  "optionImageUrl": null, "isCorrect": false, "displayOrder": 1 },
    { "optionText": "Ketosis alone",                        "optionImageUrl": null, "isCorrect": false, "displayOrder": 2 },
    { "optionText": "Normal blood glucose with acidosis",   "optionImageUrl": null, "isCorrect": false, "displayOrder": 3 }
  ]
}
```

Returns **201**:

```json
{ "question": { "id": 57, "...": "full object, see section 3" } }
```

**The new id is `response.question.id`, not `response.id`.**

### Field rules the form must enforce before submitting

| field | rule |
|---|---|
| `subjectId`, `topicId` | required, and the topic must belong to that subject |
| `questionText` | required, non-empty after trimming |
| `difficulty` | exactly `easy` \| `medium` \| `hard` |
| `marksCorrect` | required, number |
| `marksIncorrect` | optional, defaults to `0`. **Send negatives as negative** (`-0.5`) |
| `status` | `active` \| `inactive`, defaults to `active`. No other value exists |
| `options` | **2 to 6**, and **exactly one** with `isCorrect: true` |
| `tags` | array of **plain strings** on write. Created automatically if new |
| `questionImageUrl`, `explanation`, `optionImageUrl` | nullable |

`displayOrder` on options is optional — it defaults to array position. Send it
anyway if the form supports drag-to-reorder.

Unknown fields are ignored, not rejected, but they are not stored either.

### Errors

Always `{ "error": { "message": "..." } }` with a 400. Real messages:

```
"questionText is required"
"difficulty must be one of: easy, medium, hard"
"Exactly one option must be marked correct (got 0)"
"A question must have between 2 and 6 options"
"status must be one of: active, inactive"
```

Surface `error.message` directly — it is written to be shown to a human.

---

## 2. List questions

```
GET /api/questions?page=1&limit=100&subjectId=7&topicId=6
```

```json
{
  "questions": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 }
}
```

**The default is `limit=20`. This has already caused a production bug** — a
client called it bare, received the 20 newest of 57, and reported the rest as
missing. Always pass `page` and `limit`, and loop until
`page >= pagination.totalPages`. Maximum `limit` is **100**; more returns 400.

Filters combine with AND: `subjectId`, `topicId`, `difficulty`, `status`, `tag`,
`sort`. `sort` accepts `newest` (default), `oldest`, `difficulty_asc`,
`difficulty_desc`.

**No default status filter** — active and inactive come back together. Pass
`&status=active` when you want only live ones. Show inactive rows greyed with an
"Inactive" chip rather than hiding them, so the panel matches the source data.

---

## 3. Read one question — the full object

```
GET /api/questions/:id
```

This is the exact shape, live from the API:

```json
{
  "question": {
    "id": 57,
    "subjectId": 7,
    "topicId": 6,
    "questionText": "Which lab finding confirms the diagnosis of diabetic ketoacidosis?",
    "questionImageUrl": null,
    "difficulty": "medium",
    "marksCorrect": 2,
    "marksIncorrect": -0.5,
    "explanation": "DKA is defined by hyperglycemia, ketosis, and metabolic acidosis.",
    "status": "active",
    "subject": { "id": 7, "name": "Internal Med" },
    "topic":   { "id": 6, "name": "Endocrinology" },
    "options": [
      { "id": 764, "optionText": "Hyperglycemia, ketosis, and acidosis", "optionImageUrl": null, "isCorrect": true,  "displayOrder": 0 },
      { "id": 765, "optionText": "Hyperglycemia alone",                  "optionImageUrl": null, "isCorrect": false, "displayOrder": 1 },
      { "id": 766, "optionText": "Ketosis alone",                        "optionImageUrl": null, "isCorrect": false, "displayOrder": 2 },
      { "id": 767, "optionText": "Normal blood glucose with acidosis",   "optionImageUrl": null, "isCorrect": false, "displayOrder": 3 }
    ],
    "tags":     [ { "id": 23, "name": "endocrinology" }, { "id": 3, "name": "dha" } ],
    "tagIds":   [ 23, 3 ],
    "tagNames": [ "endocrinology", "dha" ],
    "correctOptionId": 764,
    "createdAt": "2026-08-21T04:17:09.369Z",
    "updatedAt": "2026-08-21T06:46:48.129Z"
  }
}
```

Three asymmetries that will bite if missed:

- **`tags` are objects on read, plain strings on write.** Model them as
  `List<Tag>` for reads and map to `List<String>` when saving, or use `tagNames`
  which is already the string list.
- **`correctOptionId` is precomputed** — don't scan `options` yourself.
- **`isCorrect` is present because this is the admin endpoint.** The
  student-facing serve strips it at the database layer. **Never reuse this model
  on a student screen** — make `isCorrect` nullable in a shared model, or keep
  two models.

---

## 4. Update

```
PUT /api/questions/:id
```

**Partial despite the verb.** Any field you omit is left alone, so
`{"status":"inactive"}` on its own is a valid request and preserves options and
tags. There is **no** `PATCH /api/questions/:id` — that 404s.

If you send `options`, the whole set is **replaced** (old rows deleted, new ones
created with fresh ids). Same for `tags`. Send the complete set or omit the key
entirely — never a partial array.

Same validation as create. Returns **200** with the full question.

For a status toggle prefer the cheaper dedicated endpoint:

```
PATCH /api/questions/:id/status          { "status": "inactive" }
PATCH /api/questions/bulk-status         { "questionIds": [1,2,3], "status": "inactive" }
```

---

## 5. Delete

```
DELETE /api/questions/:id
→ 200 { "message": "...", "questionId": 54, "affectedQuizzes": 2 }
→ 404 if it does not exist
```

`affectedQuizzes` = how many quizzes now serve one question fewer. Worth showing:
*"Deleted. 2 quizzes now have one fewer question."*

**Cascades options and tags. Not recoverable.** Make "Deactivate" the primary
action in the confirm dialog and delete the secondary.

---

## 6. Bulk create — NOT DEPLOYED YET (currently 404)

Build this last, or behind a flag.

```
POST /api/questions/bulk
{ "questions": [ { ...same shape as section 1... }, { ... } ] }
```

Max **100** per request. **All-or-nothing**: if any row is invalid, nothing is
saved and you get the failing indexes back:

```json
{
  "error": { "message": "2 of 2 question(s) are invalid. Nothing was saved." },
  "problems": [
    { "index": 0, "message": "questionText is required" },
    { "index": 1, "message": "difficulty must be one of: easy, medium, hard" }
  ]
}
```

Success is **201** `{ "created": 5, "questions": [...], "questionIds": [58,59,60,61,62] }`.

Use `problems[].index` to mark that specific card red in a multi-question form
rather than showing one error for the whole batch.

---

## What to build

**Question form** — subject/topic dropdowns, question text, difficulty, marks
and negative marks, explanation, a tag input, and a dynamic option list of 2–6
rows with a single-select "correct" radio. Disable submit until exactly one
option is marked correct and at least two options have text; those are the two
rules that generate most 400s.

**Question list** — paginated properly per section 2, with subject/topic/status
filters and an inactive treatment.

**Detail / edit** — load via section 3, save via section 4, remembering that
sending `options` replaces the whole set.

## Constraints

- Extend the existing service/model/widget structure; don't add a parallel set.
- `marksIncorrect` is genuinely negative (`-0.5`). Don't take an absolute value
  and don't render it as "--0.5".
- Subjects come from `GET /api/subjects` → `{"subjects":[...]}`, topics from
  `GET /api/subjects/:id/topics` → `{"topics":[...]}`. Both are wrapped objects,
  not bare arrays. Reload topics whenever the subject changes.
