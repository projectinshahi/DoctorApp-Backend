# Task: render 5- and 6-option test questions

Paste this into Claude inside the **student app repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>`.

Grand Test questions can now carry **up to six options**. The payload already
includes them — the app is the only part that still assumes four.

This is the **Grand Test** screens only. The QBank serves a list of options and
needs no change.

---

## What changed in the payload

`POST /api/users/me/tests/:testId/attempts` — each question now has:

```json
{ "id": 642, "questionOrder": 1, "section": "Part A",
  "questionText": "Which organism most commonly causes community-acquired pneumonia?",
  "questionImageUrl": null,
  "optionA": "Streptococcus pneumoniae", "optionAImageUrl": null,
  "optionB": "Mycobacterium tuberculosis", "optionBImageUrl": null,
  "optionC": "Pseudomonas aeruginosa",     "optionCImageUrl": null,
  "optionD": "Aspergillus fumigatus",      "optionDImageUrl": null,
  "optionE": "Klebsiella pneumoniae",      "optionEImageUrl": null,
  "optionF": "Legionella pneumophila",     "optionFImageUrl": null }
```

**E and F are nullable.** A four-option question returns them as `null`, and
most questions will. A five-option question has E and a null F.

`GET /test-attempts/:attemptId/result` carries the same two fields per
question, so the review screen needs the same change.

---

## Build the list, do not hardcode four

Replace whatever renders A, B, C, D one by one:

```dart
/// The options this question actually has, in order, skipping the empty ones.
List<TestOption> optionsOf(TestQuestion q) => const ['A', 'B', 'C', 'D', 'E', 'F']
    .map((l) => TestOption(
          letter: l,
          text: q.optionText(l),          // optionA … optionF
          imageUrl: q.optionImageUrl(l),  // optionAImageUrl … optionFImageUrl
        ))
    .where((o) => (o.text?.trim().isNotEmpty ?? false) || o.imageUrl != null)
    .toList();
```

**An option counts as present if it has text *or* an image.** An image-only
option is valid — a question can ask which radiograph is which — so testing
`text != null` alone would drop it.

The list is never ragged: the API refuses F filled with E empty, so a present
option is never followed by a gap. You can rely on the order.

### Model

Add `optionE`, `optionEImageUrl`, `optionF`, `optionFImageUrl` to the test
question model and to the result-screen model, **all nullable**. If any of the
four parse as non-nullable, a four-option question crashes the screen.

---

## Submitting

```
PATCH /api/users/me/test-attempts/:attemptId/answers/:testQuestionId
{ "selectedOption": "E" }
```

`selectedOption` now accepts `A` through `F`. Rejected values say so:

```json
400 { "error": { "message": "selectedOption must be one of: A, B, C, D, E, F" } }
```

Nothing else about answering, clearing, the timer or submit changes.

---

## Layout

Six options is roughly half again the height of four, with medical option text
that already wraps to two or three lines.

- Let the option list **scroll independently** of the question stem, or a
  six-option question with a stem image pushes the last option off-screen with
  no hint it is there.
- If options sit in a fixed-height card, that height has to come from the
  content, not a constant sized for four.
- Check the **jump-to-question grid** still fits, and the review screen, where
  each row shows the student's pick against the correct one.

Worth testing at phone width with six options of two lines each — that is the
case the current layout has never seen.

---

## What to change

- Question model and result model: four new nullable fields.
- Option rendering: build from the present letters, not a hardcoded four.
- Presence test: text **or** image.
- Submit: allow `E` and `F`.
- Review screen: the same list builder.
- Layout: option list scrolls; no fixed height assuming four.

## Constraints

- All four new fields are nullable — most questions have them null.
- An image-only option is a real option.
- Do not reorder or relabel; the letter is the answer key.
- QBank screens are unaffected.
