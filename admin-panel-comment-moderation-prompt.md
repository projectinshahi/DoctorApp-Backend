# Task: build comment moderation in the admin panel

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Prefix is **`/admin`**, not `/api/admin` — same as the settings screen. In
`ApiConstant` terms that is `root`, not `baseUrl`.

Captured against the live database on 2026-09-01.

---

## The five endpoints

```
GET    /admin/comments?status=&lessonId=&courseId=&search=&page=&limit=
PATCH  /admin/comments/:commentId               { "status": "hidden" | "published" }
POST   /admin/comments/:commentId/dismiss-reports
DELETE /admin/comments/:commentId
PATCH  /admin/lessons/:lessonId/comments        { "enabled": true | false }
```

---

## 1. The list

```json
{
  "counts": { "all": 3, "published": 3, "hidden": 0, "reported": 1 },
  "pagination": { "page": 1, "limit": 25, "total": 3, "totalPages": 1 },
  "comments": [ {
    "id": 1, "parentId": null, "isReply": false, "replyCount": 2,
    "body": "Great explanation of the ECG axis — thanks!",
    "status": "published", "createdAt": "...", "editedAt": "...",
    "user": { "id": 30, "name": "Keerthana Bineesh", "email": "...", "avatarUrl": null },
    "lesson": { "id": 37, "title": "Cardiology", "type": "video", "commentsEnabled": true,
                "chapter": { "id": 17, "title": "Cardiology" },
                "course": { "id": 22, "title": "GP GULF LICENSING EXAM" },
                "courseType": null },
    "reportCount": 1, "openReportCount": 1, "needsReview": true,
    "reports": [ { "id": 1, "reason": "Off topic", "createdAt": "...",
                   "resolvedAt": null, "user": { "id": 31, "name": "Theertha bineesh14" } } ] } ]
}
```

### `status=reported` is the whole point of this screen

A moderator's question is never "show me all comments" — it is **"what needs
me?"**. That is `status=reported`: still visible to students, and with an
unresolved report against it.

Note there is **no `reported` value in the database**. A report is something
that happened *to* a comment, not a state it is in — because the rule is that a
reported comment stays visible until someone acts. Folding the two together
would hide a comment the moment anyone complained.

So `needsReview` is `openReportCount > 0 && status === "published"`, and that
is the row that needs a badge.

**`counts` is the full set and does not change with the filter.** Bind the tabs
to it, never to `comments.length` — a filtered list would make every tab show
the open tab's size.

Filters: `status` (`all` · `published` · `hidden` · `reported`) ·
`lessonId` · `courseId` · `search`.

`search` matches **comment body OR student name**, case-insensitive, in one
field. A moderator chasing a complaint has one of the two and should not have
to know which.

`course` is resolved for you — a lesson reaches its course either through its
chapter or through the chapter's course type, and both columns are in use.
Do not walk that yourself.

---

## 2. Hide and restore

```
PATCH /admin/comments/1   { "status": "hidden" }
```
```json
{ "comment": { "id": 1, "status": "hidden" },
  "affectedReplies": 2,
  "message": "Hidden along with 2 replies. Students can no longer see it." }
```

**Replies follow the parent, both ways.** Hiding an abusive comment while
leaving five replies quoting it behind achieves nothing; restoring brings the
thread back whole. `affectedReplies` tells you how many moved — put it in the
toast, because hiding one row silently affecting three is exactly the surprise
a moderator does not need.

**Either decision closes the open reports** — hiding agrees with them,
restoring overrules them. That is what keeps the queue emptying. Verified:
after a hide, `counts.reported` went `1 → 0`.

---

## 3. Dismiss reports — "I looked, it's fine"

```
POST /admin/comments/1/dismiss-reports
→ { "message": "Dismissed 1 report(s). The comment stays visible.", "dismissed": 1 }
```

Without this the only way out of the queue is to hide something that did not
deserve it. It is the second button on every reported row, next to Hide.

`"No open reports on this comment."` with `dismissed: 0` when there is nothing
to do — not an error.

---

## 4. Delete permanently

```
DELETE /admin/comments/1
→ { "message": "Deleted permanently, along with 2 replies.", "deletedReplies": 2 }
```

**No undo, no soft delete, no archive.** Confirm first, quoting `replyCount`
from the row — other students wrote those replies.

Prefer **Hide**. It removes the comment from students exactly as well and is
reversible. Make Hide the primary action and Delete the quiet one.

**404** on a second delete, which is what a double-click produces.

---

## 5. Turn commenting off for a lesson

```
PATCH /admin/lessons/37/comments   { "enabled": false }
```
```json
{ "lesson": { "id": 37, "title": "Cardiology", "commentsEnabled": false },
  "existingComments": 3,
  "message": "Commenting is off. 3 existing comment(s) stay visible — hide or delete them individually if that is not what you want." }
```

**Turning a discussion off is not erasing it.** New posts get a **409**;
everything already there stays readable. Show `existingComments` in the confirm
dialog so nobody reaches for this expecting it to clear the thread.

`commentsEnabled` also comes back on every comment row's `lesson`, so the list
can offer the switch inline.

---

## What to build

**Moderation page** — tab row from `counts` (All · Published · Hidden ·
**Reported**, the last with a badge), a search box, and course/lesson dropdowns.

**Comment row** — body, author name and email, lesson and course, relative
time, an "edited" marker from `editedAt`, and `Reply to #N` when `isReply`.
Reported rows show the reasons and who filed them from `reports`.

**Row actions** — Hide / Restore, Dismiss reports (reported rows only), Delete
behind a confirm.

**Lesson comment switch** — a toggle on the lesson edit screen, and inline on
the moderation list.

**Default landing tab: Reported.** An empty queue is the answer to "what needs
me?", and any other default buries it.

## Constraints

- Prefix is `/admin/...`, not `/api/admin/...`.
- Tabs bind to `counts`, never to a list length.
- Hiding and restoring move the replies too — say so in the toast.
- Delete is permanent. Hide is the reversible one; make it primary.
- Disabling comments does not remove them.
- `user.name` and `avatarUrl` are nullable; `email` is present for admins only.
