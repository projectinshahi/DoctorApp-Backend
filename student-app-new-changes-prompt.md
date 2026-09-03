# Student app — everything the backend added, in build order

Paste this into Claude inside the **student app repo**. It is the current
delta: what the server can do that the app does not yet use.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

**All of it is deployed and live.** Captured against production on 2026-09-02.

Already built, do not rebuild: course tree, lesson player, QBank quiz flow with
per-question save and review, bookmarks, Grand Tests, home screen shell.

---

## 1. Sign-in policy changed — do this first

**A second device is now refused, not let in.** The old rule signed the first
device out; the new one keeps it and blocks the newcomer.

```
POST /api/auth/google   { idToken, deviceId }
```

**409** is the new case, and it is not an error to retry:

```json
{ "error": { "code": "SESSION_ACTIVE_ELSEWHERE",
             "message": "This account is signed in on another device. Sign out there first, or try again in a few minutes." },
  "previousSession": { "deviceId": "PHONE-A", "lastSeenAt": "..." },
  "retryAfterMinutes": 30 }
```

Stay on the login screen, show the message with the minutes filled in. **No
auto-retry, and build no "force sign in" — the API has no such flag.**

**200** now carries `notice`, non-null only when an idle device was released:

```json
{ "notice": "Your other device had been inactive, so it has been signed out.",
  "signedOutOtherDevice": true, "isNewUser": false, "previousSession": {...} }
```

Show it verbatim, in a dialog, **before** navigating — or it is lost behind the
home screen.

### Two consequences

**`deviceId` is now load-bearing.** It decides whether a student can reach
their own account. Generate once, persist, and prefer an id that survives a
reinstall (`androidId` / `identifierForVendor`) over a SharedPreferences uuid —
otherwise reinstalling looks like a new device and they wait out 30 minutes.

**Log out has to be visible and real.** `POST /api/auth/logout` releases the
lock immediately. Forgetting used to cost nothing; now it costs the student 30
minutes on their next device.

Detail: `student-app-device-alert-prompt.md`

---

## 2. Watched / unwatched is decided by the server

**Delete any client-side completion rule.** The app reports position; the
server owns the 90% threshold.

```
PUT /api/users/me/lessons/37/progress
{ "lastPositionSeconds": 545, "durationSeconds": 600 }

→ { "completed": true, "watchedPercent": 91, "completionThresholdPercent": 90 }
```

Post every 10s while playing, plus on pause, seek and dispose. Send
`durationSeconds` on the first call per video — older videos have no stored
length, and your player knows it.

`completed` comes back from the server; never compute it. A rewind never
un-finishes a video.

Every lesson in `/selection/content` now carries `watchedPercent` and
`durationSeconds`. **`watchedPercent` is nullable** — null is "length unknown",
not 0%. Render the tick with **no bar** rather than a bar stuck at zero.

Detail: `student-app-watched-indicator-prompt.md`

---

## 3. Continue Watching row on the home screen

`GET /api/users/me/home` now returns `inProgressVideos` — every unfinished
video with a resume point, newest first, capped at 10:

```json
{ "lessonId": 39, "title": "Obstetrics", "thumbnailUrl": "...",
  "chapter": { "id": 17, "title": "Obstetrics And Gynecology" },
  "lastPositionSeconds": 40, "durationSeconds": null, "watchedPercent": null,
  "videoUrl": "https://res.cloudinary.com/...", "locked": false }
```

**`videoUrl` is in the payload** — tap plays immediately. Do not call
`GET /lessons/:id` first.

`continueWatching` is now the first element of the same list, kept so the
existing single card keeps working. Once you build the row, render
`inProgressVideos` and ignore it, or the first video appears twice.

`locked: true` nulls `videoUrl` but keeps `lastPositionSeconds` — open the
paywall, not the player.

Detail: `student-app-continue-watching-prompt.md`

---

## 4. MCQ of the Day

Ten questions from the course, **the same ten for everyone that day**, replaced
at midnight Gulf time. Nothing is scheduled — the set is derived from
`(courseId, date)`.

```
GET  /api/users/me/courses/:courseId/daily-quiz          ← starts + freezes it
POST /api/users/me/courses/:courseId/daily-quiz/answers  { questionId, optionId }
POST /api/users/me/courses/:courseId/daily-quiz/finish
GET  /api/users/me/courses/:courseId/daily-quiz/history?days=30
```

**Do not call the GET from the home screen or on app launch** — it creates the
day's attempt. The home card reads `modules.dailyQuiz` instead, which has no
side effects:

```json
"dailyQuiz": { "date": "2026-09-02", "state": "notStarted",
               "totalQuestions": 10, "answeredCount": 0,
               "correctCount": null, "score": null,
               "currentStreak": 0, "nextSetAt": "2026-09-03T00:00:00+04:00" }
```

`state` is `notStarted` | `inProgress` | `completed` → Start / Continue / View
result. `correctCount` and `score` are **null until completed**.

Answering returns the key immediately — reuse the QBank reveal component. One
shot per question; re-answering is a 409.

**The streak does not drop because today is unfinished.** It counts back from
yesterday until today is done.

Detail: `student-app-daily-quiz-prompt.md`

---

## 5. Comments under a video

```
GET    /api/users/me/lessons/:lessonId/comments?page=1&limit=20
POST   /api/users/me/lessons/:lessonId/comments   { body, parentId? }
PATCH  /api/users/me/comments/:commentId          { body }
DELETE /api/users/me/comments/:commentId
POST   /api/users/me/comments/:commentId/report   { reason? }
```

Threads newest-first, replies oldest-first, one level deep. Replies arrive with
their parent and are never paginated.

**Bind buttons to `isMine`, `canReport` and `reportedByMe`** — not to your own
id comparison. Student and admin ids come from different tables and overlap.

**`isInstructor: true`** marks a reply from the teaching side. Badge it; never
show Report or Edit on it. That is the reply the student opened the thread for.

**Replying to a reply is re-parented.** Place the new comment using the
`parentId` in the *response*, not the one you sent.

**Reporting hides nothing.** Flip the button to "Reported" and leave the
comment where it is.

`commentsEnabled: false` → render the thread, hide the input box.

Detail: `student-app-comments-prompt.md`

---

## 6. Grand Test: instructions and sections

Test payloads gained two fields.

`instructions` on the test list and on start — free text the admin wrote, shown
**before the timer starts**. Null on papers that have none.

`sections` on start, plus `section` on each question:

```json
"sections": [ { "name": "Part A", "questionCount": 2, "firstOrder": 1, "lastOrder": 2 } ]
```

Render a section header when `question.section` **changes** as you walk the
questions in order — do not group, or the paper's order and the headers can
disagree. `section` is nullable; a paper with no parts is normal.

Detail: `student-app-test-sections-prompt.md`

---

## Build order

1. Sign-in 409 + stable `deviceId` + visible Log out — it blocks real students
2. Watched threshold (delete the client rule)
3. Continue Watching row
4. MCQ of the Day + home card
5. Comments
6. Test instructions and sections

## Constraints that apply everywhere

- Handle 401 by `error.code`. `SESSION_ENDED` and `REFRESH_TOKEN_REUSED` →
  log out and show the message; **never refresh**, or the interceptor loops.
- 409 on login is a message, not a retry.
- Nullable and not zero: `watchedPercent`, `durationSeconds`, `section`,
  `instructions`, `correctCount`, `score`.
- Never compute `completed` for a video, or `isMine` for a comment.
- Scores can be negative wherever negative marking applies.
