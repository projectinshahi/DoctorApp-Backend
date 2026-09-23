# Admin panel: filter the Rapid Recall lesson dropdown by subject

The Rapid Recall form asks for a course, an exam type, a subject and a lesson,
but the lesson dropdown ignores the chosen subject. The backend now supports
filtering it. Two changes: a **Subject** field on the lesson form, and the
**lesson dropdown** in the Rapid Recall form calling the new endpoint.

Backend is live at `https://doctorapp-backend-cl2h.onrender.com`. Every request
needs `Authorization: Bearer <admin token>`.

## Why a lesson needs a subject at all

Nothing in the data connected a lesson to a subject. A quiz lesson could borrow
its quiz's subject, but a video or a note had none, so filtering by subject
returned almost nothing. Lessons now carry an optional `subjectId` that an
admin sets.

## 1. Lesson form: add a Subject dropdown

On the create and edit lesson form, add **Subject** — optional, with a clear
"None" option.

- Options come from the existing subject list (`GET /api/admin/courses/:courseId/subjects`,
  the same call the Rapid Recall form already uses).
- Send it as `subjectId` in the existing `POST /api/chapters/:chapterId/lessons`
  and `PUT /api/lessons/:id` bodies. `null` clears it.
- `Subject 42 not found` comes back as a 400 if the id is wrong.

For a quiz lesson, show the quiz's subject greyed out as the default when no
subject is set — it is what the filter will use anyway.

## 2. Rapid Recall form: filter the lesson dropdown

**`GET /api/lessons?courseId=22&courseTypeId=20&subjectId=7`**

All three parameters are optional and narrow the list:

- `courseTypeId` — lessons under that exam type. Prefer this when the form has
  one, since chapters hang off exam types.
- `courseId` — the whole course, across its exam types.
- `subjectId` — lessons carrying that subject, **or** quiz lessons whose quiz
  has it.
- `search` — matches the title, case-insensitive.

```json
{
  "lessons": [
    { "id": 49, "title": "testing", "type": "quiz", "status": "published",
      "subjectId": null, "subject": null, "subjectFromQuiz": 7,
      "chapter": { "id": 12, "title": "Cardiology", "courseTypeId": 20 } }
  ],
  "fallback": false,
  "count": 1
}
```

- `subject` — the subject an admin set, or null.
- `subjectFromQuiz` — the subject id borrowed from the lesson's quiz, when no
  subject was set. Worth showing as "from quiz" so an admin can see which
  lessons still need tagging.
- **`fallback: true` means the subject matched nothing**, and the list is every
  lesson in that course/exam instead. Show a line above the dropdown: *"No
  lesson is tagged with this subject yet — showing all lessons."* Do not hide
  the list; an empty dropdown is how this screen failed before.

Call it again whenever course, exam type or subject changes, and clear the
selected lesson when the list no longer contains it.

## Order and labels

Lessons come back grouped by chapter, in the order they appear in the course.
Show the chapter name under or beside the lesson title — two chapters commonly
hold a lesson of the same name ("Obstetrics" exists as both a video and a text
lesson today), and the id alone tells an admin nothing.

## Errors

| HTTP | Meaning |
|---|---|
| 400 | `courseId must be an integer`, `subjectId must be an integer`, `Subject 42 not found` |
| 401 | Admin session expired |

## Keep in mind

- The subject on a lesson is **for filtering only**. It does not change what a
  student sees, it does not move the lesson, and it is not required.
- Existing lessons have no subject, so the first time an admin opens this the
  filter will fall back for every subject. Tagging a few lessons is what makes
  it useful; the message above tells them that without a support call.
