# Task: build lesson comments in the student app

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request. There is
no anonymous read — a signed-out request is **401**.

Every response below was captured from the live backend on 2026-09-01.

---

## The five endpoints

```
GET    /api/users/me/lessons/:lessonId/comments?page=1&limit=20
POST   /api/users/me/lessons/:lessonId/comments      { body, parentId? }
PATCH  /api/users/me/comments/:commentId             { body }
DELETE /api/users/me/comments/:commentId
POST   /api/users/me/comments/:commentId/report      { reason? }
```

---

## 1. The thread

```json
{
  "lesson": { "id": 37, "title": "Cardiology", "type": "video" },
  "commentsEnabled": true,
  "totalComments": 3,
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "comments": [ {
    "id": 1, "parentId": null,
    "body": "Great explanation of the ECG axis — thanks!",
    "createdAt": "...", "editedAt": "...", "edited": true,
    "author": { "id": 30, "name": "Keerthana Bineesh", "avatarUrl": null },
    "isMine": true, "reportedByMe": false,
    "replies": [
      { "id": 2, "body": "Agreed, the lead II part helped.",
        "author": { "id": 31, "name": "Theertha bineesh14", "avatarUrl": null },
        "isMine": false, "reportedByMe": false, "replies": [] } ] } ]
}
```

**Threads are newest-first; replies inside a thread are oldest-first.** A
conversation reads forwards even though the list of conversations reads
backwards.

**`isMine` and `reportedByMe` decide the buttons** — Edit/Delete on your own,
Report on everyone else's, never both, and "Reported" instead of "Report" once
you have. Do not compare user ids yourself; the server already did it.

**Pagination counts threads, not comments.** `pagination.total` is top-level
comments; `totalComments` includes replies and is the "12 comments" label.
Replies are never paginated — they arrive with their parent.

**`commentsEnabled: false` means read-only.** Render the thread, hide the
input box. It is a per-lesson switch a moderator controls; existing comments
stay visible.

**`edited: true`** shows an "edited" marker. Use that field, not a timestamp
comparison — a moderator hiding and restoring a comment moves `updatedAt` and
must not make it read as edited.

---

## 2. Posting and replying

```
POST /api/users/me/lessons/37/comments
{ "body": "Great explanation of the ECG axis." }
```
```json
201 { "comment": { "id": 1, "parentId": null, ... }, "parentId": null }
```

To reply, add `parentId`.

### Nesting is one level, and the server enforces it

Send the id of whatever the student tapped Reply on — including a reply. The
server re-parents it onto the thread root and **tells you where it actually
went**:

```
POST { "body": "Same here.", "parentId": 2 }   ← 2 is itself a reply
→ { "comment": { "id": 3 }, "parentId": 1 }    ← attached to the thread root
```

**Insert the new comment using the `parentId` in the response, not the one you
sent.** Trusting your own value puts the comment in a tier that does not exist,
and it will jump on the next refresh.

Errors: **400** empty body · **400** over 2000 characters · **404** parent gone
· **409** `Commenting is turned off for this lesson` · **403** the lesson is
locked (premium, no subscription) · **401** signed out.

---

## 3. Edit and delete — your own only

```
PATCH  /api/users/me/comments/1   { "body": "..." }
DELETE /api/users/me/comments/1
```

- **403** `You can only change your own comments` on someone else's.
- **404** once a moderator has hidden it. Not 403 — a hidden comment is gone
  from the student's view, and "you may not edit that" would confirm it is
  still there.

Deleting a thread root takes its replies with it, and the response says so:

```json
{ "message": "Comment deleted, along with 2 replies.", "deletedReplies": 2 }
```

**Warn before deleting a comment with replies.** Other students wrote those.
`replies.length` on the row tells you before you ask.

---

## 4. Reporting

```
POST /api/users/me/comments/2/report   { "reason": "Off topic" }
→ { "message": "Reported. A moderator will review it.", "reported": true }
```

`reason` is optional. **400** on your own comment.

### The comment stays visible

Verified: after reporting, it is still in the list. Reporting sends it to a
moderator; it does not remove it. Anything else would make one student with a
grudge a censor.

So do **not** hide it locally. Flip the button to "Reported" (`reportedByMe`
comes back true on the next load) and leave the comment where it is. Reporting
twice is harmless — the server keeps one report per student.

---

## What to build

**Comment section under the video player** — count from `totalComments`, input
box gated on `commentsEnabled`, threads with their replies inline.

**Comment row** — avatar, name, relative time, body, "edited" marker. Overflow
menu: Edit/Delete when `isMine`, Report otherwise.

**Reply composer** — inline under the thread, prefilled with nothing. Place the
result by the response's `parentId`.

**Optimistic post** is fine, but reconcile: the server assigns the id and may
change the parent.

**Empty state** — "No comments yet. Be the first." Plus a distinct read-only
state when `commentsEnabled` is false.

## Constraints

- Signed-in only. There is no public read; handle **401** by prompting sign-in.
- Bind buttons to `isMine` / `reportedByMe`, never to your own id comparison.
- Place replies using the **response's** `parentId`.
- Never nest past one level; the server will not produce it.
- Do not hide a comment locally when it is reported.
- `author.name` and `author.avatarUrl` are **nullable** — fall back to a
  placeholder, never to the email (it is not sent).
