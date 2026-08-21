# Task: fix the question bank list in the Flutter admin panel

Paste this into Claude inside the **Flutter admin panel repo**.

Every response body below was captured from the live backend at
`https://doctorapp-backend-30gd.onrender.com` on 2026-08-21. Real, not illustrative.

There are exactly two problems, and the first one silently hides data.

---

## Problem 1: the list is truncated at 20 and nothing says so

`GET /api/questions` **defaults to `limit=20`, `sort=newest`**. Calling it without
paging returns the 20 most recently created questions out of 57 — with no error and
no visible sign that anything is missing.

This has already caused a real incident: a sync script called the endpoint bare,
saw only ids 38–57, and reported six existing questions as "ID NOT FOUND".

### The contract

```
GET /api/questions?page=1&limit=100
Authorization: Bearer <admin token>
```

```json
{
  "questions": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 }
}
```

- `limit` maximum is **100**. Asking for more returns **400**.
- Loop until `page >= pagination.totalPages`, or paginate the UI off
  `pagination.total`.
- Optional filters, combined with AND: `subjectId`, `topicId`, `difficulty`,
  `status`, `tag`, `sort`.
- `sort` accepts `newest` (default), `oldest`, `difficulty_asc`, `difficulty_desc`.
  Anything else returns 400.

### What to build

Whichever screen lists questions must either page through to completion before
rendering a total, or show real pagination driven by `pagination.total`.

**Never render a count derived from `questions.length`** unless every page has been
loaded — that is the bug. If the screen shows "57 questions" it must have 57, and if
it shows 20 it must say "20 of 57".

---

## Problem 2: inactive questions are indistinguishable from active ones

`GET /api/questions` applies **no default status filter** — it returns `active` and
`inactive` together. That is correct for an admin view, but the panel currently gives
the reader no way to tell them apart, so deactivated questions look live.

Right now that is 57 rows of which 10 are inactive.

### What to build

Show inactive questions with a **clear visual state** — greyed row plus an
"Inactive" chip — and add a filter control with three options:

- **All** (default, no `status` param)
- **Active only** → `&status=active`
- **Inactive only** → `&status=inactive`

`status` is validated server-side against `active | inactive`; anything else returns
400 with `{"error":{"message":"status must be one of: active, inactive"}}`.

**Do not make active-only the hardcoded default.** Inactive is a real, meaningful
state — a question deliberately switched off in the source spreadsheet. If the panel
hides those entirely, an admin cannot see that a question exists but is disabled, and
the panel stops matching the spreadsheet. Students never see inactive questions
regardless; the quiz serving filter enforces `status = 'active'` server-side.

---

## Question object shape

```json
{
  "id": 57,
  "subjectId": 7,
  "topicId": 6,
  "questionText": "Which lab finding confirms the diagnosis of diabetic ketoacidosis?",
  "questionImageUrl": null,
  "difficulty": "medium",
  "marksCorrect": 2,
  "marksIncorrect": -0.5,
  "explanation": "...",
  "status": "active",
  "subject": { "id": 7, "name": "Internal Med" },
  "topic":   { "id": 6, "name": "Endocrinology" },
  "options": [
    { "id": 320, "optionText": "...", "optionImageUrl": null, "isCorrect": true, "displayOrder": 0 }
  ],
  "tags":      [ { "id": 23, "name": "endocrinology" }, { "id": 5, "name": "nhra" } ],
  "tagIds":    [ 23, 5 ],
  "tagNames":  [ "endocrinology", "nhra" ],
  "correctOptionId": 320,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Notes that matter:

- `tags` are **objects** on read, but writes take **plain strings**:
  `"tags": ["endocrinology","nhra"]`.
- `correctOptionId` is precomputed — don't scan `options` for `isCorrect` yourself.
- `questionImageUrl`, `explanation`, `optionImageUrl` are nullable.
- **`isCorrect` is present here because this is the admin endpoint.** The
  student-facing serve strips it. Never reuse an admin question model for a student
  screen.

---

## If the panel has a delete action

`DELETE /api/questions/:id` changed. It used to return **409** unconditionally,
telling the admin to deactivate instead. It now returns:

```json
{ "message": "Question deleted successfully", "questionId": 54, "affectedQuizzes": 0 }
```

- **200** on success, **404** if the id doesn't exist.
- `affectedQuizzes` = how many quiz pools shrank. Worth surfacing in the confirmation:
  *"Deleted. 3 quizzes now have one fewer question."*
- Deletion **cascades the question's options and tags and is not recoverable.** Keep
  a confirm dialog, and offer "Deactivate instead" as the primary action with delete
  as the secondary.

---

## Constraints

- Match the existing service/model/widget structure. Extend what's there rather than
  adding a parallel set.
- Same auth and error surfacing as other screens. Errors are always
  `{ "error": { "message": "..." } }`.
- Don't add bulk delete. `PATCH /api/questions/bulk-status` exists
  (`{ questionIds: [...], status }`) if you want bulk activate/deactivate, which is
  reversible; there is no bulk delete endpoint and it should stay that way.
