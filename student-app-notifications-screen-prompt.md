# dr_app: a notifications screen

Push notifications arrive once and are gone. If the phone had notifications
switched off, or the student signed in on a new device, there was nothing to
see. The backend now keeps every notification it sends, scoped to the course
the student has selected, and the app can show them in a list.

Live at `https://doctorapp-backend-cl2h.onrender.com`. All calls go through
`ApiClient`, which already attaches the access token.

## 1. The list

**`GET /api/users/me/notifications?limit=30`**

```json
{
  "notifications": [
    { "id": 12, "type": "new_test", "title": "New mock test",
      "body": "DHA Grand Test 3",
      "data": { "type": "new_test", "testId": "9", "courseId": "22" },
      "createdAt": "2026-09-23T06:10:00.000Z", "read": false }
  ],
  "unreadCount": 3,
  "nextBefore": "2026-09-21T09:00:00.000Z"
}
```

- Newest first.
- `read` — already seen, based on when the student last opened this screen.
- `unreadCount` — for the badge on the bell icon.
- `nextBefore` — pass it back as `?before=<value>` for the next page. It is
  `null` on the last page, so stop asking. Paging is by timestamp rather than
  page number because new notifications arrive while a student scrolls, and a
  page number would show the same row twice.

`limit` defaults to 30 and caps at 100.

## 2. Marking them read

**`POST /api/users/me/notifications/read`** (empty body)

Call it when the screen opens, not on each row. It marks everything up to now
as read and replies `{ "readAt": "...", "unreadCount": 0 }`. Clear the badge
from that reply rather than re-fetching.

## 3. Tapping a row

`data` is the same map a push carries, so route a tap exactly as `onOpen`
routes a push:

| `type` | Opens |
|---|---|
| `new_course` | the course list |
| `course_join` | the selected course |
| `new_test` | the test, from `data.testId` |
| `new_quiz`, `new_lesson` | the lesson, from `data.lessonId` |
| `new_rapid_recall` | rapid recall, from `data.rapidRecallId` |
| `new_questions` | the question bank, or the subject from `data.subjectId` |
| `admin_message` | nothing — it is an announcement, stay on the screen |

An unknown `type` must stay on the screen rather than crash: types get added
on the server without an app release.

**Every value in `data` is a string**, including ids — FCM refuses a message
otherwise. Parse before use: `int.parse(data['testId'])`.

## 4. Where it belongs

A bell icon on the home screen with the unread count, opening this list. When a
push arrives while the app is open, bump the badge; the row is already stored,
so nothing else is needed.

## Empty and error states

- No notifications: *"Nothing yet. New tests, lessons and quizzes for your
  course will show up here."* — not an error.
- 401: the session expired; the existing refresh flow covers it.
- The list is scoped to **the course selected right now**. Changing course
  changes the list, which is intended — say so if a student asks where their
  old notifications went, rather than treating it as a bug.

## Do not

- Do not store the list locally as the source of truth. The server decides what
  a student can see, and it changes with their course.
- Do not mark rows read one at a time. There is one timestamp per student, and
  no endpoint for a single row.
- Do not build a delete button. Nothing on the server removes a single
  notification; ask for it if you want it.
