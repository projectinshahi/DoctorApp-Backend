# Task: make "Free for everyone" actually make a lesson free

Paste this into Claude inside the **admin panel repo** (`admin_drapp`).

Base URL: `https://doctorapp-backend-cl2h.onrender.com`
Admin bearer token on every request. **No backend change is needed** — the
field already exists and both endpoints already accept it.

---

## The bug

In `add_edit_lesson_sheet.dart`, ticking **Free for everyone** sends
`accessType: "free"`. Inside a **premium course that does nothing**, and the
lesson stays locked for students.

The server's gate, verbatim:

```js
if (lesson.isFreePreview) return true;
const premium = lesson.accessType === 'premium' || courseAccessType === 'premium';
if (!premium) return true;
```

A premium **course** locks every lesson in it. `accessType: "free"` is only
consulted when the course itself is free. The one field that opens a lesson
regardless of payment is **`isFreePreview`** — and the sheet has no control for
it, so it is always `false`.

Observed on course 22 (premium), student with no subscription:

```
52  Cardiology premium   accessType premium   locked: true
53  Cardiology           accessType free      locked: true   ← ticked "Free for everyone"
55  Pulmonology Free     accessType free      locked: true   ← ticked "Free for everyone"
```

Setting `isFreePreview: true` on 55 flipped it to `locked: false` immediately.

## Why the server does not just honour `accessType: "free"`

`Lesson.accessType` is `@default(free)`. "Free" therefore means *"nobody set
this"* far more often than *"the admin chose free"*. Making it beat course
premium would unlock every unconfigured lesson in every paid course.
`isFreePreview` has no such ambiguity — it is false unless somebody
deliberately set it.

---

## The change

**The sheet needs the course's `accessType`.** It is opened from
Courses → exam → chapter, so pass it down to the sheet; do not re-fetch it.

Then on save:

| course | checkbox | send |
|---|---|---|
| free | ticked | `accessType: "free"`, `isFreePreview: false` |
| free | unticked | `accessType: "premium"`, `isFreePreview: false` |
| **premium** | **ticked** | `accessType: "free"`, **`isFreePreview: true`** |
| **premium** | unticked | `accessType: "premium"`, `isFreePreview: false` |

Both `POST /api/chapters/:chapterId/lessons` and `PUT /api/lessons/:id` accept
`isFreePreview` already — `createLesson` reads it off the body, `updateLesson`
writes it when present.

**Unticking must send `isFreePreview: false`**, not omit it. On an edit the key
being absent leaves the old value in place, so a lesson could stay open after
being switched to premium.

## The label

Inside a premium course "Free for everyone" is now literally true, but it is
worth saying what it costs:

> **Free preview** — open to everyone, no subscription needed.

And under it, when the course is premium:

> This course is premium, so every other lesson stays locked until a student
> subscribes.

That sentence is the thing an admin currently has no way to learn except by
testing with a real student account.

## Fixing what is already saved

Lessons already ticked as free in a premium course have `accessType: "free"`
and `isFreePreview: false`, so they are still locked. They need re-saving once
the sheet is fixed, or the flag set directly. On course 22 that is lesson 53
("Cardiology", a free video) — lesson 55 is already done.

Worth showing in the lesson list: a lesson that is `accessType: free` with
`isFreePreview: false` inside a premium course is **locked**, and the row
should say so rather than showing a green Free chip.

## Constraints

- Send `isFreePreview` explicitly on every save, true and false alike.
- The sheet must know the course's accessType; a lesson cannot decide this
  alone.
- Do not change `accessType` semantics — `premium` still means premium.
