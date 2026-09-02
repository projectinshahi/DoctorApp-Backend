# Task: drag-and-drop reordering of quiz questions

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

**No backend work is needed — this endpoint already exists and is live.** It
is the same pattern as lesson reordering, so reuse that drag list.

---

## First: a quiz has two modes

```
GET /api/admin/quizzes/12/questions
```

```json
{ "quizId": 12, "mode": "manual", "totalQuestions": 8,
  "questions": [ { "id": 44, "questionText": "...", "difficulty": "medium",
                   "displayOrder": 0, "options": [ ... ] } ] }
```

| `mode` | what it means | reorderable |
|---|---|---|
| `"manual"` | the admin pinned exactly these questions, in this order | **yes** |
| `"filter"` | no pinned questions — the quiz draws from subject + topic at serve time | **no** |

**A filter quiz has nothing to reorder.** Its questions are sampled fresh per
student, so "question 3" is a different question for every one of them. Show
the drag handles only when `mode === "manual"`, and on a filter quiz show a
line saying the questions are drawn automatically, with a button to pin the
current set if the admin wants control.

Trying to drag a filter quiz is the mistake to design out — it looks like it
worked, and then changes nothing a student sees.

---

## Reorder

```
PUT /api/admin/quizzes/12/questions
{ "questionIds": [44, 17, 39, 21, 8, 12, 30, 5] }
```

Send the **full array in the new order**. `displayOrder` is assigned from the
array index, so there is no "move item X to position N" arithmetic in the
panel — you send what the list looks like after the drop.

```json
{ "quizId": 12, "mode": "manual", "totalQuestions": 8,
  "questionIds": [44, 17, 39, 21, 8, 12, 30, 5] }
```

### Three things it already guarantees

**It is one transaction.** The old rows are deleted and the new ones written
together, so a half-applied reorder cannot happen — the quiz never serves a
mix of the old and new order.

**It is also add/remove.** The same call sets the whole set. Dropping an id
removes that question from the quiz; adding one pins it. So a single
"Save order" button can cover reorder, remove and add if your list supports
all three.

**An empty array switches the quiz back to filter mode:**

```json
PUT { "questionIds": [] }  →  { "mode": "filter", "totalQuestions": 0 }
```

That is the escape hatch from manual back to automatic. Make it a deliberate
action — "Use automatic selection" — not something an empty list does by
accident after the admin deletes the last row.

### Related endpoints

```
POST   /api/admin/quizzes/:id/questions              add without touching order
DELETE /api/admin/quizzes/:id/questions/:questionId   remove one
GET    /api/admin/quizzes/:id/preview                 with the answer key
```

`POST` appends. Use `PUT` when order matters.

---

## The student side already honours it

`orderBy: [displayOrder asc, questionId asc]` on the serve path, so the next
student to open the quiz gets the new order. No cache, nothing to invalidate.

The `questionId` tiebreak matters: two questions sharing a `displayOrder` — a
possible state if rows were ever written by hand — stay in a stable order
rather than shuffling between requests.

---

## What to build

**Question list** — the existing drag list from lesson reordering. Handles only
when `mode === "manual"`.

**On drop** — reorder locally for the feel, `PUT` the full array, reconcile
from the response. On failure, put the list back; a row that silently stays
moved is worse than one that snaps back.

**Filter-mode banner** — "Questions are drawn automatically from
`subject / topic`" plus **Pin these questions** (calls `PUT` with the current
preview ids, which switches it to manual).

**Automatic mode button** — "Use automatic selection", confirmed, sends
`{ "questionIds": [] }`.

## Constraints

- Send the whole array, not a delta.
- Drag only in `manual` mode.
- An empty array is a mode switch, not an empty quiz — confirm it.
- Do not renumber rows by index for display; render `displayOrder` if you show
  a number at all.
