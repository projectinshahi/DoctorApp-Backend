# Change: CSV warnings, delete a test, course-type scoping, SVG

Paste this into Claude inside the **Flutter admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Every response below was captured from the live backend on 2026-08-31.

Four changes to the Grand Test section. The first one is a bug fix you will see
immediately; the rest are new capability.

---

## 1. Warnings must not block the upload — this is the bug

The upload screen currently shows this and refuses the file:

> ⚠ 6 row(s) are invalid. Nothing was saved.
> Line 4 · question_image_url · Image URL is not one of this test's uploaded images

That rule was too strict and has been relaxed. An unrecognised image URL is now
a **warning**, and the rows import.

### The response now distinguishes two severities

```json
{
  "message": "Imported 1 question(s). The test is not published yet.",
  "validRows": 1,
  "errors": [
    { "row": 2, "field": "question_image_url", "severity": "warning",
      "message": "Not one of this test's uploaded images — check it loads: https://cdn.example.com/questions/q3_xray.jpg" }
  ],
  "preview": [ ... ]
}
```

**An entry with `"severity": "warning"` did not block anything.** Entries
without that key are real errors and did block.

Note this is a **200 with a `message`**, not a 400 with an `error`. The panel is
currently treating any populated `errors` array as failure — that is the bug.

### What to change

Split `errors` on `severity`:

```dart
final blocking = errors.where((e) => e['severity'] != 'warning');
final warnings = errors.where((e) => e['severity'] == 'warning');
```

- **Blocking** → red banner, "Nothing was saved", stay on the Upload step.
- **Warnings** → amber list, "Imported N question(s), M to check", **advance to
  Review**.

Decide success from the HTTP status and the presence of `message` vs `error`,
not from `errors.length`.

Warnings you will see: an unrecognised image URL, and duplicate question text.
Neither stops an import.

### What still blocks

| message | why |
|---|---|
| `This test expects 10 questions, the file has 8.` | row count must match exactly |
| `Not a valid URL: q3_xray.jpg` | a bare filename can never load |
| `Question needs text or an image` | a question with neither is empty |
| `Option A needs text or an image` | same, per option |
| `"Z" must be one of A, B, C, D` | invalid answer key |
| `Duplicate order 3, also on line 5` | would silently drop a question |

### The image columns are optional

`question_image_url` and `option_a_image_url` … `option_d_image_url` may be
blank on any row. A paper can mix text-only questions with image ones, and a
question can carry a picture while its options do not. Blank is not an error
and never was.

The shipped template no longer contains `cdn.example.com` placeholders — its
image columns are empty. If the panel bundles its own template, strip the
placeholder URLs from it too.

---

## 2. Delete a test

```
DELETE /api/admin/tests/:testId
```

```json
→ 200 { "message": "Deleted \"DHA Mock Paper 1\" with 200 question(s) and 0 image(s).",
        "testId": 2, "deletedQuestions": 200, "deletedImages": 0 }

→ 409 { "error": { "message": "Cannot delete: 3 student attempt(s) exist. Unpublish it
                    instead — deleting would erase their results." },
        "attemptCount": 3 }
```

Questions, images and attempts all cascade — which is exactly why an attempted
paper cannot be deleted.

**Disable the delete control when `attemptCount > 0`** and put the reason on
hover, rather than letting an admin click into a 409. Every test object already
carries `attemptCount`.

In the confirm dialog make **Unpublish** the primary action and Delete the
secondary. Unpublish is reversible; delete is not, and it takes the Cloudinary
images with it.

---

## 3. A test can be scoped to one course type

`POST /api/admin/courses/:courseId/tests` now accepts an optional
`courseTypeId`:

```json
{ "name": "DHA Only Paper", "courseTypeId": 20,
  "totalQuestions": 200, "durationMinutes": 180,
  "marksCorrect": 1, "marksIncorrect": -0.25 }
```

- **set** → only students whose selected exam matches will see it
- **omitted or null** → the whole course sees it

Every test object now returns both:

```json
"courseTypeId": 20,
"course":     { "id": 22, "title": "GP GULF LICENSING EXAM" },
"courseType": { "id": 20, "title": "DHA (Dubai) Exam" }
```

`courseType` is `null` for a course-wide paper.

**Validation:** a course type belonging to a different course returns
**400 `That course type belongs to a different course`**. Populate the dropdown
from the selected course only — otherwise the paper saves and is then invisible
to everyone.

The list filters too:

```
GET /api/admin/tests?courseId=22&courseTypeId=20&type=GRAND_TEST&isPublished=true
```

### What to build

A **Course type** dropdown in the create dialog, below Course, with an explicit
**"All exam types"** option that sends `null`. Show `courseType.title` (or "All
types") on each row in the test list, and add it as a filter.

---

## 4. SVG images are accepted

```
POST /api/admin/tests/:testId/images     multipart, field "images", up to 200 files, 2MB each
```

Allowed: **JPEG, PNG, WebP, SVG**. Anything else returns
`Unsupported file type image/bmp — use JPEG, PNG, WebP, or SVG`.

Add `svg` to the file picker's allowed extensions.

**Render an SVG only from the returned Cloudinary URL — never inline the file
into a page.** An SVG can contain script; this is safe because Cloudinary
serves it from `res.cloudinary.com`, a different origin from the panel, where an
embedded script has nothing of yours to reach. In Flutter use `flutter_svg`,
which does not execute script at all.

The upload response is unchanged:

```json
{ "uploaded": [ { "imageId": 3, "originalFilename": "diagram.svg",
                  "url": "https://res.cloudinary.com/.../tests/6/hngc....svg" } ],
  "errors": [] }
```

Remember the intended order: **upload images first, copy the URLs into the CSV,
then upload the CSV.** A CSV carries a URL, not binary data.

---

## What did NOT change

- The four-step wizard: create → upload → review → publish.
- Upload never publishes. Publish is still a separate call, still blocked until
  `questionCount == totalQuestions`.
- `isLocked` still freezes a paper permanently on the first submitted attempt.
- Every other field on every test object.

## Constraints

- Split `errors` on `severity`; never treat a warning as a failure.
- Judge success by the status code and `message` vs `error`, not by
  `errors.length`.
- `courseType` and `courseTypeId` are **nullable**.
- Disable delete on `attemptCount > 0` rather than surfacing the 409.
- `marksIncorrect` is negative; never `abs()`.
