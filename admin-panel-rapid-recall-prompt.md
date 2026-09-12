# Task: build the Rapid Recall screens

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Prefix is `/api/admin`. Everything below was run against the live database on
2026-09-12.

---

## What a Rapid Recall is

A titled deck of revision cards. Each card is an **image, a note, or both**.
The deck can also carry one uploaded **PDF or DOC** handout.

It is filed under a course, and narrowed as far as the admin wants.

## Scoping is a funnel, not a path

Only `courseId` is required. `courseTypeId`, `subjectId` and `lessonId` each
narrow it further and **each may be left empty**.

| filled in | who sees it |
|---|---|
| course only | everyone on that course |
| + course type | only that exam (DHA, MOHAP…) |
| + subject | shown against that subject |
| + lesson | shown on that one lesson |

That matters for the form: **do not make the dropdowns mandatory in sequence.**
An admin writing one pharmacology deck for a whole subject should not have to
attach it to forty lessons.

The chain is validated server-side on every write:

```json
400 { "error": { "message": "That course type belongs to a different course" } }
400 { "error": { "message": "That lesson belongs to a different course" } }
```

A cross-course pick produces a deck nobody can see, so the API refuses it
rather than saving something invisible.

### The dropdowns — all four endpoints already exist

```
GET /api/courses                              → course
GET /api/courses/:id/course-types             → course type, filtered by course
GET /api/subjects                             → subject
GET /api/chapters?courseTypeId=…              → then
GET /api/chapters/:chapterId/lessons          → lesson
```

Filter each dropdown by the one above it, and clear the ones below when a
parent changes — otherwise the form keeps a stale lesson from the previous
course and the save 400s.

---

## The endpoints

```
POST   /api/admin/rapid-recalls
GET    /api/admin/rapid-recalls?courseId=&courseTypeId=&subjectId=&lessonId=&status=&search=
GET    /api/admin/rapid-recalls/:id            ← includes the cards
PATCH  /api/admin/rapid-recalls/:id
PUT    /api/admin/rapid-recalls/:id/cards      ← the whole deck at once
DELETE /api/admin/rapid-recalls/:id
```

### Create

```json
POST /api/admin/rapid-recalls
{ "courseId": 22, "courseTypeId": 20, "subjectId": 7, "lessonId": 41,
  "title": "ECG rapid recall",
  "description": "Read these the night before.",
  "noteUrl": "https://res.cloudinary.com/.../handout.pdf",
  "noteFileType": "pdf" }
```

```json
201 { "rapidRecall": { "id": 2, "title": "ECG rapid recall", "status": "draft",
      "cardCount": 0, "courseTypeId": 20, "subjectId": 7, "lessonId": 41,
      "course": { "id": 22, "title": "GP GULF LICENSING EXAM" },
      "courseType": { "id": 20, "title": "DHA (Dubai) Exam" },
      "subject": { "id": 7, "name": "Internal Med" },
      "lesson": { "id": 41, "title": "Cardiology" } } }
```

Created as **draft**. Students see nothing until you publish.

### The cards — one call, not four

```json
PUT /api/admin/rapid-recalls/2/cards
{ "cards": [
  { "imageUrl": "https://res.cloudinary.com/.../ecg1.svg", "note": "Inferior MI — II, III, aVF" },
  { "note": "Anterior MI — V1 to V4. No image needed." },
  { "imageUrl": "https://res.cloudinary.com/.../ecg2.svg" } ] }
```

```json
{ "recallId": 2, "cardCount": 3, "cards": [ { "id": 5, "displayOrder": 0, ... } ] }
```

**This replaces the whole deck.** Add, edit, remove and reorder are all the
same call — send the list as it looks on screen and `displayOrder` comes from
the array index. One **Save** button, no diffing.

It runs in a transaction, so a half-applied deck cannot happen.

A card must carry something:

```json
400 { "error": { "message": "Card 2 needs an image or a note" } }
400 { "error": { "message": "Card 3: imageUrl is not a valid URL" } }
```

The message names the position, because a deck of forty is unfixable
otherwise. `{ "cards": [] }` is valid — it clears the deck.

### Publish

```json
PATCH /api/admin/rapid-recalls/2   { "status": "published" }
```

`draft` | `published`. Verified: a draft returns **0 results** to the student,
and appears the moment it is published.

---

## Uploads — reuse what exists, do not add new ones

**Card images** → `POST /api/uploads/question-image`, multipart field `image`.
JPEG, PNG, WebP, SVG, 2MB. Returns `{ url, publicId }`. Put `url` on the card;
keep `publicId` so the image can be deleted if the card is removed.

**The handout** → `POST /api/uploads/lesson-note`, multipart field `note`.
Returns `{ url, publicId, fileType }` → store as `noteUrl`, `notePublicId`,
`noteFileType`.

Both already exist and both already decide which file types are allowed. Adding
Rapid-Recall-specific upload endpoints would give you two places to change the
rules and one of them would get missed.

> Render an SVG card from its URL with `<img>`. Never inline the file's text —
> an SVG can carry script, and this is only safe because Cloudinary serves it
> from another origin.

---

## What to build

**List screen** — filters across the top for course, course type, subject,
lesson and status, all optional and all matching the query parameters. Each row
shows title, `cardCount`, the scope as a breadcrumb
(`GP GULF › DHA › Internal Med › Cardiology`), and a Draft/Published chip.

Send `?subjectId=null` to find the decks that are *not* narrowed to a subject —
useful for "what applies course-wide?".

**Editor** — the scope dropdowns, title, description, a handout upload, then
the card list.

**Card list** — reorderable rows, each with an image slot and a note field.
Either may be empty; not both. One Save that PUTs the whole array.

**Delete** — confirm with the count from the response:
`Deleted "ECG rapid recall" and its 3 card(s).`

## Constraints

- Only `courseId` is required. Do not force the other three dropdowns.
- Clear child dropdowns when a parent changes.
- `PUT /cards` sends the entire deck, never a delta.
- A card needs an image or a note; the API refuses neither.
- Reuse the existing upload endpoints.
- New decks are `draft` — nothing reaches students until published.
