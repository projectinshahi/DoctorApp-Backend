# Admin panel: Rapid Recall — subject is the chapter, lessons follow it

The Rapid Recall form's **Subject** dropdown lists the question bank's subjects
("Internal Med", "OBGYN"). Those have nothing to do with the course's lessons,
so picking one told the lesson dropdown nothing.

A course here is built as **course → exam type → chapter → lesson**, and the
chapters *are* the subjects: "Internal Medicine", "Obstetrics And Gynecology",
"General Surgery". So the form's Subject dropdown should list the chapters of
the chosen exam type, and the Lesson dropdown the lessons of that chapter.

The backend is live at `https://doctorapp-backend-cl2h.onrender.com`. Every
call needs `Authorization: Bearer <admin token>`.

## The form

| Field | Where the options come from |
|---|---|
| Course | `GET /api/courses` |
| Exam type | the chosen course's types |
| **Subject** | `GET /api/course-types/:courseTypeId/chapters` — the chapters |
| **Lesson** | `GET /api/lessons?chapterId=<the chosen chapter>` |

Both new dropdowns are optional: a deck can cover a whole course, a whole exam
type, a chapter, or one lesson.

### Subject options

```
GET /api/course-types/20/chapters
-> 16 Internal Medicine | 17 Obstetrics And Gynecology | 18 General Surgery | 28 new subject
```

Show the chapter title as the subject name. Nothing else.

### Lesson options

```
GET /api/lessons?chapterId=17
{ "lessons": [
    { "id": 39, "title": "Obstetrics", "type": "video", "status": "published",
      "chapter": { "id": 17, "title": "Obstetrics And Gynecology", "courseTypeId": 20 } }
  ],
  "count": 3 }
```

**Show the lesson title alone** — no chapter prefix, no id, no "from quiz".
The chapter is already chosen above:

```
Obstetrics
Obstetrics
GYNACOLOGY
```

Two lessons can share a title (chapter 17 has "Obstetrics" as both a video and
a text lesson). Only when two rows in the same list share a title, add the type
after it — `Obstetrics (video)` — so they can be told apart.

If the chapter has no lessons, show *"No lesson in this subject"* and leave the
deck at chapter level. That is valid; don't block saving.

`GET /api/lessons` also accepts `courseTypeId`, `courseId` and `search` when
you want a wider list.

## Saving

`POST /api/admin/rapid-recalls` and `PUT /api/admin/rapid-recalls/:id` now take
**`chapterId`**:

```json
{ "title": "OBGYN revision cards",
  "courseId": 22, "courseTypeId": 20,
  "chapterId": 17, "lessonId": 44,
  "status": "draft" }
```

- Send `chapterId` where the form used to send `subjectId`.
- **Stop sending `subjectId`.** The field still exists for one old deck, and
  the old dropdown should be removed from the form.
- Sending only `lessonId` is fine — the server fills in that lesson's chapter.

The server refuses a scope that could never be seen, with a message worth
showing as-is:

| Message | Cause |
|---|---|
| `That chapter belongs to a different course` | chapter from another course |
| `That chapter belongs to a different exam under this course` | DHA chapter on a MOHAP deck |
| `That lesson belongs to a different chapter` | subject and lesson don't agree |
| `That lesson belongs to a different exam under this course` | lesson from the other exam type |

## The list screen

`GET /api/admin/rapid-recalls` now accepts `chapterId=` as a filter and each
deck carries `chapter: { id, title }`. Show the chapter as the deck's subject
column, and filter by it the same way the form picks it.

## Clearing dependent fields

When Course changes, clear exam type, subject and lesson. When exam type
changes, clear subject and lesson. When subject changes, clear lesson. Re-fetch
each list as it changes — a stale lesson from the previous chapter is exactly
what the server now rejects.
