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
- `subjectFromQuiz` — the subject id borrowed from the lesson's quiz. Useful
  when managing lessons; **not something to show in this dropdown**.
- `fallback` — always `false` unless you ask for it (see below).

**Show the lesson title alone.** No chapter prefix, no "from quiz" label, no
id. The dropdown says which subject it is filtered by; repeating it on every
row is noise:

```
testing
cardilogy based test
```

not

```
Internal Medicine › testing · from quiz
```

**An empty list stays empty.** If no lesson carries the chosen subject, show
*"No lesson for this subject"* in the dropdown. Adding `&fallback=true` returns
every lesson in the course with `fallback: true`, but don't use it here: a
dropdown labelled "Internal Med" must not offer a Dermatology lesson.

Call it again whenever course, exam type or subject changes, and clear the
selected lesson when the list no longer contains it.

## Order and duplicates

Lessons come back in the order they appear in the course, grouped by chapter.

Two lessons can share a title — "Obstetrics" exists today as both a video and a
text lesson. When two rows in the list have the same title, and only then, add
the type after it (`Obstetrics (video)`) so they can be told apart. Don't label
every row for the sake of the rare pair.

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
