# Task: add quiz display to the Flutter admin panel

Our backend now returns quiz data on quiz-type lessons. Implement the admin-panel
side. Follow the existing conventions in this repo — look at `ChapterService`
(in `lib/` under the services/models area) and mirror its structure: a service
class with a `baseUrl`, a `_getToken()` helper reading `AdminLocalStorage.getToken()`,
`Result`-style wrapper classes (`XResult.success` / `XResult.failure`), and
`.timeout(const Duration(seconds: 15))` on every request.

## API contract (all verified against the running backend)

Base URL comes from `ApiConstant.root`. Every request needs:

```
Authorization: Bearer <admin token>
Content-Type: application/json
```

Errors are ALWAYS shaped `{"error": {"message": "..."}}` — never a flat
`{"message": ...}`. Parse accordingly.

### 1. Lesson detail — already exists, response has NEW fields

```
GET /api/lessons/:id
```

Quiz-type lesson response (real example):

```json
{
  "lesson": {
    "id": 21,
    "chapterId": 14,
    "title": "Pulmonology",
    "description": null,
    "type": "quiz",
    "status": "published",
    "accessType": "free",
    "isFreePreview": false,
    "displayOrder": 0,
    "content": null,
    "videoUrl": null,
    "noteUrl": null,
    "thumbnailUrl": null,
    "quizId": 1,
    "quiz": {
      "id": 1,
      "title": "DHA Cardiology Practice",
      "subjectId": 7,
      "topicId": 1,
      "examTag": "dha",
      "questionCount": 10,
      "status": "active",
      "availableQuestions": 1,
      "servedQuestions": 1,
      "isUnderfilled": true
    },
    "plans": [], "planIds": [], "planId": null, "plan": null
  }
}
```

Non-quiz lesson: `"quizId": null, "quiz": null`. Every other field is identical.

`type` is one of `video` | `text` | `quiz`.
`status` is one of `draft` | `published` | `archived`.

### 2. Quiz preview with the answer key — NEW endpoint

```
GET /api/quizzes/:quizId/preview
```

```json
{
  "quiz": { "id": 1, "title": "DHA Cardiology Practice", "examTag": "dha",
            "questionCount": 10, "status": "active",
            "subject": { "id": 7, "name": "Internal Med" },
            "topic":   { "id": 1, "name": "Cardiology" } },
  "availableQuestions": 1,
  "isUnderfilled": true,
  "totalQuestions": 1,
  "totalMarks": 2,
  "questions": [
    {
      "id": 1,
      "questionText": "A 60-year-old with crushing chest pain and ST elevation in leads II, III, aVF. Which artery?",
      "questionImageUrl": null,
      "difficulty": "medium",
      "marksCorrect": 2,
      "marksIncorrect": -0.5,
      "explanation": "II, III, aVF are the inferior leads.",
      "correctOptionId": 1,
      "tagNames": ["cardiology", "mohap", "dha", "ecg"],
      "options": [
        { "id": 1, "optionText": "Right coronary artery",    "optionImageUrl": null, "isCorrect": true,  "displayOrder": 0 },
        { "id": 2, "optionText": "Left anterior descending", "optionImageUrl": null, "isCorrect": false, "displayOrder": 1 },
        { "id": 3, "optionText": "Left circumflex",          "optionImageUrl": null, "isCorrect": false, "displayOrder": 2 }
      ]
    }
  ]
}
```

This is the ONLY endpoint that returns `isCorrect` / `explanation`. It is
admin-only. Use it for the admin's read-only quiz preview.

### 3. Quiz list, for a quiz picker

```
GET /api/quizzes?status=active
GET /api/quizzes?subjectId=7&topicId=1&examTag=dha&status=active
```

```json
{ "quizzes": [ { "id": 1, "title": "DHA Cardiology Practice",
                 "subjectId": 7, "topicId": 1, "examTag": "dha",
                 "questionCount": 10, "status": "active",
                 "subject": { "id": 7, "name": "Internal Med" },
                 "topic": { "id": 1, "name": "Cardiology" },
                 "lesson": { "id": 21, "title": "Pulmonology" } } ] }
```

`lesson` is non-null when the quiz is ALREADY linked to a lesson. A quiz can be
linked to only ONE lesson, so quizzes with a non-null `lesson` must be shown as
unavailable in the picker (disabled row, with the lesson title as the reason).

### 4. Creating / linking on a lesson

```
POST /api/chapters/:chapterId/lessons
PUT  /api/lessons/:id
```

Body for a quiz lesson:

```json
{ "title": "Cardiology Practice", "type": "quiz", "quizId": 1, "status": "published" }
```

Rules the backend enforces — validate in the UI to avoid avoidable 400s:
- `quizId` may only be set when `type == "quiz"` (else 400)
- the quiz must exist and be `status: "active"` (else 400)
- a quiz already linked to another lesson is rejected (400, message names the lesson)
- send `"quizId": null` to unlink
- changing `type` away from `quiz` clears the link automatically

### 5. Creating a quiz

```
POST /api/quizzes
{ "title": "DHA Cardiology Practice", "subjectId": 7, "topicId": 1,
  "examTag": "dha", "questionCount": 20 }
```

`examTag` optional (null = all exam boards). `questionCount` optional
(null = serve every matching question). Taxonomy for the dropdowns:

```
GET /api/subjects                      -> { "subjects": [ { "id": 7, "name": "Internal Med" } ] }
GET /api/subjects/:subjectId/topics    -> { "topics":   [ { "id": 1, "subjectId": 7, "name": "Cardiology" } ] }
```

## What to build

### A. Lesson detail screen — conditional quiz section

The screen currently shows title, type/status/access chips, and a lock banner.
Below that, **only when `lesson.quiz != null`**, render a Quiz card showing:

- quiz title
- subject name / topic name / exam tag (from the preview call, or show the raw ids
  if you only have the lesson payload)
- "Serving X of Y available questions" using `servedQuestions` / `availableQuestions`
- a WARNING badge when `isUnderfilled == true` — text like
  "Only 1 question available, quiz asks for 10"
- a WARNING when `quiz.status != "active"` — the lesson will fail to serve
- a "Preview questions" button → screen B

When `lesson.quiz == null` and `lesson.type == "quiz"`, show an empty state:
"No quiz linked" plus a "Link a quiz" button → screen C.

When `lesson.type != "quiz"`, render nothing quiz-related at all.

### B. Quiz preview screen (read-only)

Calls `GET /api/quizzes/:quizId/preview`. Lists every question with:

- question text, difficulty chip, marks (`+2 / -0.5` style)
- all options, with the correct one visibly marked (use `isCorrect`, or match
  `option.id == correctOptionId`)
- explanation below the options when present
- tag chips from `tagNames`
- a header with `totalQuestions` and `totalMarks`

Read-only — questions are authored in Google Sheets, not in this app. Do NOT
build question create/edit forms.

### C. Quiz picker (used from the lesson editor)

When lesson type is `quiz`, replace the free-text content field with a quiz picker:

- loads `GET /api/quizzes?status=active`
- rows show title, subject/topic, exam tag, question count
- rows where `lesson != null` are disabled, labelled "Already used by <lesson title>"
- selecting one sets `quizId` in the lesson save payload
- a "Clear" action sends `"quizId": null`

## Constraints

- Read-only for questions. This app never creates or edits questions.
- Do not add a Delete button for quizzes that are linked — the backend returns 409.
- Keep the existing `Result` wrapper pattern and the `{"error":{"message"}}` parsing.
- Handle 401 as "Session expired. Please log in again." like `ChapterService` does.
- New endpoints return 404 on the production Render URL until the backend is
  deployed. Test against the local backend base URL.

Create a `QuizService` alongside `ChapterService`, plus model classes for Quiz
and QuizQuestion. Then wire screens A, B and C.
