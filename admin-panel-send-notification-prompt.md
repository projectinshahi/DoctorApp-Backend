# Admin panel: send a notification to a course's students

Add a screen that lets an admin write a push notification and send it to the
students of one course — or to everyone. The backend is live at
`https://doctorapp-backend-cl2h.onrender.com`; nothing new is needed there.

Every request needs the admin token: `Authorization: Bearer <admin token>`.

## The screen

One form:

| Field | Control | Notes |
|---|---|---|
| Send to | dropdown | "All students" or one course, from `GET /api/courses` |
| Exam type | dropdown | Only when a course is chosen. "All exam types" or one of that course's types. Sending to one exam type reaches only the students on it. |
| Title | text | Required, 120 characters max. Shown in bold on the phone. |
| Message | multiline text | Required, 500 characters max. |

Show a live character count on both fields and block sending past the limit —
the server rejects it anyway, and finding out after writing 600 characters is
a bad way to learn.

Below the form: a **Check** button and a **Send** button.

## Check first, then send

Two calls to the same endpoint. The only difference is `dryRun`.

**`POST /api/admin/notifications`**

```json
{
  "title": "Live class tomorrow",
  "body": "Cardiology revision at 7pm. Join from the app.",
  "courseId": 22,
  "courseTypeId": 20,
  "dryRun": true
}
```

- `courseId` — omit it for all students.
- `courseTypeId` — optional. Omit for the whole course.
- `dryRun: true` — counts, does not send.

The dry run replies:

```json
{ "target": "GP GULF LICENSING EXAM", "devices": 3, "sent": 0, "dryRun": true }
```

Show that as **"This will reach 3 device(s) on GP GULF LICENSING EXAM"** and
only then enable **Send**. `devices: 0` must be said plainly — *"No student on
this course has the app installed with notifications on. Nothing will be
delivered."* — because the send will otherwise look like it worked.

For all students, `devices` comes back `null`: the count lives inside Firebase,
not in our database. Say **"Sent to every student"** rather than showing a
number.

Sending is the same call without `dryRun`, and replies:

```json
{ "target": "GP GULF LICENSING EXAM", "devices": 3, "sent": 3, "failed": 0, "pruned": 0 }
```

- `sent` — devices that accepted it.
- `pruned` — dead devices removed (the app was uninstalled). Not an error.

Show `"Sent to 3 of 3 devices"`. If `sent` is 0 and `devices` was above 0,
show the reply's `reason` — that is the real fault, usually the server's
Firebase key.

## Errors to show as they come

| HTTP | Meaning |
|---|---|
| 400 | `title is required`, `body is required`, a length limit, or "That exam type belongs to a different course" |
| 401 | The admin session expired — send them to the login screen |
| 404 | `Course not found` |
| 502 | Firebase refused it; show the `reason` |

Show the server's `error.message` directly. They are written to be read by a
person.

## Is the server able to send at all?

**`GET /api/admin/push/status`** answers it without sending anything:

```json
{ "configured": true, "projectId": "drapp-31ae1", "validated": true, "devices": 4 }
```

`configured: false` comes with a `reason` and a `fix` — show both. Worth
putting on the settings screen, or as a small banner on this one when
`configured` is false, so nobody writes an announcement that cannot leave the
building.

## Keep in mind

- **Nothing is stored.** There is no history of sent notifications; the server
  sends and forgets. Don't build a "sent messages" list against an endpoint
  that does not exist. If the history matters, say so and it can be added.
- **A phone only counts once it has signed in** with a build that registers its
  token. `devices` is the honest number of reachable phones, not of students.
- **There is no undo.** A sent notification cannot be recalled, so the confirm
  dialog should repeat the target and the device count.
