# Task: drag-and-drop reordering of videos within a chapter

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

**No backend work is needed — this endpoint exists and is live.** Everything
below was run against production on 2026-09-02 and restored afterwards.

---

## The one thing to understand first

**A video is a lesson.** There is no separate video ordering. `Lesson.type` is
`video | text | quiz`, and one `displayOrder` sequences all three inside a
chapter.

So chapter 17 is not "one video and some other stuff" — it is an ordered list:

```
0  video  Obstetrics
1  text   Obstetrics
2  quiz   GYNACOLOGY
```

That matters for the UI: **if your Videos screen shows a filtered list, you
cannot reorder from it directly.** Sending only the video ids renumbers them
0,1,2… and drops the notes and quizzes to the end of the chapter, silently
rearranging content the admin never touched.

Two ways to avoid it, in order of preference:

1. **Drag on the full chapter list.** Videos, notes and quizzes in one list
   with a type icon each. This is what the student sees, so it is what the
   admin should be arranging.
2. If you keep a videos-only view: fetch the chapter's full lesson list, splice
   the moved video into that array, and send **the whole thing**.

---

## Reorder

```
PATCH /api/chapters/17/lessons/reorder
{ "lessonIds": [44, 39, 40] }
```

Note the verb: **PATCH**.

Send the **full array in the new order**. `displayOrder` is assigned from the
array index, so there is no "move item X to position N" arithmetic — you send
what the list looks like after the drop.

```json
{ "lessons": [
  { "id": 44, "displayOrder": 0, "title": "GYNACOLOGY", "type": "quiz", ... },
  { "id": 39, "displayOrder": 1, "title": "Obstetrics", "type": "video", ... },
  { "id": 40, "displayOrder": 2, "title": "Obstetrics", "type": "text", ... } ] }
```

The response is the **full reordered chapter**, in the new order, with each
lesson's normal shape (`plans`, `quiz`, `videoUrl`, everything). Replace your
local list from it instead of refetching.

### The guards, confirmed live

```json
400  { "error": { "message": "These lessons do not belong to chapter 17: 37" } }
400  { "error": { "message": "lessonIds contains duplicates" } }
400  { "error": { "message": "lessonIds must be a non-empty array" } }
```

The first one is the important one: it stops a drag between two open chapters
corrupting both. Surface it as a toast rather than swallowing it, because it
means the panel sent something the admin did not intend.

### It is one transaction

Every `displayOrder` update runs inside `prisma.$transaction`, so a
half-applied reorder cannot happen. Either the whole chapter moves or none of
it does.

---

## The student outline follows immediately

The student tree sorts by `[displayOrder asc, createdAt asc]` — the same field
this writes. No cache, no separate ordering table, nothing to invalidate. The
next `/selection/content` is already in the new order.

The `createdAt` tiebreak matters: two lessons sharing a `displayOrder` — a
state older rows can be in, since the column defaults to `0` — stay in a stable
order rather than swapping between requests.

---

## What to build

**Chapter lesson list** — a reorderable list. `ReorderableListView` in Flutter;
one row per lesson with a type icon (video / note / quiz), the title, and a
drag handle.

**On drop**
1. Reorder locally first, so the row moves under the finger.
2. `PATCH` the full array of ids.
3. Replace the list from the response.
4. On failure, **put it back** and toast the message. A row that silently stays
   moved while the server disagrees is worse than one that snaps back.

**Debounce** if you allow several quick drags — send once when the drag
settles, not once per frame.

## Constraints

- **PATCH**, not PUT or POST.
- Send **every lesson in the chapter**, not just the videos, and not a delta.
- Never build the array from a filtered view without splicing into the full
  chapter first.
- Revert the local list if the request fails.
- Do not display the array index as a lesson number; render `displayOrder`.
