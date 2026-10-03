# Task: 4 to 6 options on every question form

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>`.

Both question banks now take **4 options minimum, 6 maximum**. E and F are new
on test questions; the question bank's old minimum of 2 is gone.

---

## Test questions — fixed columns A to F

```
POST  /api/admin/tests/:testId/questions
PATCH /api/admin/tests/:testId/questions/:questionId
```

```json
{ "questionText": "Which artery is occluded?",
  "optionA": "Right coronary",       "optionAImageUrl": null,
  "optionB": "Left anterior descending",
  "optionC": "Left circumflex",
  "optionD": "Posterior descending",
  "optionE": "Ramus intermedius",     // optional
  "optionF": null,                    // optional
  "correctOption": "B" }
```

**A, B, C, D are required. E and F are not.** Render A–D always; show E and F
behind an **Add option** button that appears once D is filled, and a remove on
each.

`correctOption` is a letter — `"A"` to `"F"`. Its picker must only offer the
letters actually filled in, or an admin can key an answer to an empty option:

```json
400 { "field": "correct_option",
      "message": "\"E\" must be one of A, B, C, D, E, F" }
```

### F without E is refused

```json
400 { "field": "option_e",
      "message": "Option F is filled but Option E is empty — fill E, or move F into E" }
```

Removing option E must therefore **shift F up into E**, not leave a hole. A
column typed one place over would otherwise renumber the answers under a key
written against the original letters.

### CSV

Four new columns, all optional: `option_e`, `option_e_image_url`, `option_f`,
`option_f_image_url`. The downloadable template already has them — if the panel
ships its own copy, replace it with
`GET /api/admin/tests/questions/template`.

A file with no E or F columns imports exactly as before.

---

## Question bank — a list of options

```
POST /api/questions
PUT  /api/questions/:id
```

```json
{ "questionText": "…",
  "options": [
    { "optionText": "Right coronary", "optionImageUrl": null, "isCorrect": true,  "displayOrder": 0 },
    { "optionText": "LAD",            "isCorrect": false, "displayOrder": 1 },
    { "optionText": "Left circumflex","isCorrect": false, "displayOrder": 2 },
    { "optionText": "PDA",            "isCorrect": false, "displayOrder": 3 } ] }
```

**The minimum was 2 and is now 4.** If the form currently starts with two rows,
start it with four.

```json
400 { "message": "A question must have between 4 and 6 options" }
```

Add/remove buttons: **Add** disabled at 6, **Remove** disabled at 4.

`displayOrder` is the array position — send the list in display order and let
the index set it; do not ask the admin for a number.

---

## Rules both forms share

**Exactly one correct.** Zero or two is rejected on both. Use a radio group,
not checkboxes — the shape of the control should make a second correct answer
impossible to express.

**Blank text does not pad the count.** Four rows with one left empty fails on
the empty row, not on the count, so disable Save while any visible option is
empty rather than letting the server explain it.

**An image can carry an option** — `optionImageUrl` with no text is valid on
both. So "empty" means no text *and* no image, not no text.

## What to change

- Test question form: E and F behind **Add option**, F shifting up when E is
  removed, `correctOption` offering only filled letters.
- Question bank form: four starting rows, Add capped at 6, Remove floored at 4.
- Both: radio for correct, Save disabled while an option has neither text nor
  image.
- Replace any bundled CSV template with the one the API serves.

## Constraints

- A–D required on tests; the bank just needs four of anything.
- Never offer a `correctOption` letter whose option is empty.
- Never leave E empty with F filled.
- `displayOrder` comes from array position.
