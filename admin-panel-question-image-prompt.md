# Task: upload an image (including SVG) when creating a question

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` on every request.

Captured against the live backend on 2026-09-02.

---

## What was missing

`POST /api/questions` has always accepted `questionImageUrl` and each option's
`optionImageUrl` — but as **strings**. Nothing produced those strings, so an
admin had to host the file somewhere else and paste a link.

The upload endpoint now exists. Two steps: upload, then create the question
with the URL you get back.

---

## Step 1 — upload the file

```
POST /api/uploads/question-image
Content-Type: multipart/form-data
image: <your file>
```

Field name is **`image`**. One file per request.

```json
{ "url": "https://res.cloudinary.com/uyrqd22f/image/upload/v1788332269/question_images/s2pshzwu3pecn0emfwyq.svg",
  "publicId": "question_images/s2pshzwu3pecn0emfwyq",
  "originalFilename": "sample-ecg-lead-ii.svg",
  "bytes": 1468,
  "format": "svg" }
```

Accepted: **JPEG, PNG, WebP, SVG**. 2MB max.

```json
400 { "error": { "message": "Unsupported file type application/pdf — use JPEG, PNG, WebP, or SVG" } }
```

**Keep `publicId` in your form state.** It is the only handle that can delete
the file later. Lose it and the asset is unreachable, not merely unreferenced.

This upload is **not tied to a question** — the file goes up while the question
is still being written and has no id yet. So an admin who uploads and then
abandons the form leaves an orphan. Call the delete below on cancel:

```
DELETE /api/uploads/question-image   { "publicId": "question_images/s2ps..." }
→ { "deleted": true, "publicId": "..." }
```

A second delete of the same file is also `deleted: true`, not an error — the
goal is that it is gone.

> Cloudinary's CDN can keep serving a deleted URL for a short while. That is
> caching, not a failed delete; the response is the truth.

## Step 2 — put the URL on the question

```
POST /api/questions
{ "subjectId": 7, "topicId": 9,
  "questionText": "What rhythm does this strip show?",
  "questionImageUrl": "https://res.cloudinary.com/.../s2pshzwu3pecn0emfwyq.svg",
  "difficulty": "medium", "marksCorrect": 1, "marksIncorrect": -0.25,
  "explanation": "Regular narrow-complex rhythm.",
  "options": [
    { "optionText": "Sinus rhythm", "isCorrect": true, "displayOrder": 0 },
    { "optionText": "Atrial fibrillation", "isCorrect": false, "displayOrder": 1 } ] }
```

Verified end to end: uploaded, created, read back with the URL intact,
deleted.

An **option** takes one the same way:

```json
{ "optionText": null, "optionImageUrl": "https://res.cloudinary.com/...", "isCorrect": true }
```

Both `questionText` and `optionText` may be null when an image carries the
content — "which slide shows..." has picture answers. Do not mark the text
fields required in the form.

`PUT /api/questions/:id` takes the same fields for editing.

---

## Rendering it — the part that needs care

**Load it from the Cloudinary URL. Never inline an SVG's text into the page.**

An SVG can carry script. This is only safe because `res.cloudinary.com` is a
different origin from your panel — a script inside it has nothing of yours to
reach. Inlining it hands that script your session.

### Flutter

```dart
Widget questionImage(String url) {
  final isSvg = Uri.parse(url).path.toLowerCase().endsWith('.svg');
  return isSvg
      // flutter_svg does not execute script at all.
      ? SvgPicture.network(url, placeholderBuilder: (_) => const SizedBox(
          height: 160, child: Center(child: CircularProgressIndicator())))
      : Image.network(url,
          errorBuilder: (_, __, ___) => const SizedBox.shrink());
}
```

Never `SvgPicture.string(await http.get(url))`. That is the inlining this
warns about, with extra steps.

Switch on the **URL's extension**, not on the `format` field — the format is
only in the upload response, and the question row stores just the URL.

### Web panel

```html
<img src="{url}" alt="">
```

An `<img>` renders an SVG **without** executing its script, which is exactly
what you want. Do not use `<object>`, `<embed>`, or inject the file's contents
into `innerHTML`.

---

## What to build

**Image picker on the question form** — one for the stem, one per option.
Upload on select, show a thumbnail from the returned `url`, and keep
`publicId` alongside it.

**Remove button** — clears the field and calls `DELETE /question-image`.

**Cancel handling** — delete any uploaded-but-unsaved images when the admin
leaves the form. Otherwise every abandoned draft leaves a file nobody can find.

**Preview** — render the image in the question preview exactly as the student
app will, so a broken or wrongly-sized figure is caught here rather than in an
exam.

## Constraints

- Field name is `image`; one file per request.
- Store `publicId`, not just the URL.
- `questionText` and `optionText` are nullable — an image alone is a valid
  question or option.
- Render from the URL. Never inline SVG source.
- Detect SVG from the URL extension.
