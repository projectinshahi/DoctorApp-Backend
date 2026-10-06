# Task: show option E and F on a test question

Paste this into Claude inside the **student app repo** (`dr_app`).

The backend stores and serves six options on test questions. The app parses
four. **Until this lands, do not publish a six-option paper to students.**

---

## What goes wrong today

`lib/models/test_model.dart`, `TestQuestion`:

```dart
final String? optionA;  final String? optionAImageUrl;
final String? optionB;  final String? optionBImageUrl;
final String? optionC;  final String? optionCImageUrl;
final String? optionD;  final String? optionDImageUrl;
```

`optionE` and `optionF` appear nowhere in `lib/`, so they are dropped on parse.
A six-option question renders as four.

Worse, in the same class:

```dart
String? textFor(String letter) => switch (letter) {
      'A' => optionA,
      'B' => optionB,
      'C' => optionC,
      _  => optionD,        // ← E and F both resolve to D
    };
```

If the correct answer is E or F the student cannot answer the question. Nothing
errors; they score zero on a question with no right option on screen.

## The change — one file, three edits

**1. Fields and `fromJson`.** Add `optionE`, `optionEImageUrl`, `optionF`,
`optionFImageUrl` beside the others, read with the same `_text()` helper, which
already turns `""` into null — that matters, because the server sends an empty
string for an option that is not there.

**2. `letters`.** Two more lines, same shape:

```dart
List<String> get letters => [
      if (optionA != null || optionAImageUrl != null) 'A',
      if (optionB != null || optionBImageUrl != null) 'B',
      if (optionC != null || optionCImageUrl != null) 'C',
      if (optionD != null || optionDImageUrl != null) 'D',
      if (optionE != null || optionEImageUrl != null) 'E',
      if (optionF != null || optionFImageUrl != null) 'F',
    ];
```

**3. `textFor` and `imageFor` — the real bug.** Make every letter explicit and
let the fallback be `null`, never `optionD`:

```dart
String? textFor(String letter) => switch (letter) {
      'A' => optionA, 'B' => optionB, 'C' => optionC,
      'D' => optionD, 'E' => optionE, 'F' => optionF,
      _ => null,
    };
```

Same for `imageFor`. A letter the app does not know must render as nothing, not
as the last option in the list — that is how E silently became D.

## Nothing else needs touching

`test_attempt_screen.dart` already drives everything off `question.letters`
(lines 175 and 407), so E and F appear as soon as the list includes them.

`TestQuestionResult` carries `correctOption` as a letter and no option text, so
the review screen prints "F" correctly with no change.

## How to check it

The backend already serves this. Import `six-option-sample.csv` from the
backend repo — three rows: six options, four options, and five with F blank —
publish the test, and sit it:

| row | expect |
|---|---|
| 1 | six choices, correct **A** |
| 2 | four choices, unchanged behaviour |
| 3 | five choices, no sixth, correct **B** |

Submitting E or F returns 200; `G` is rejected by the server with
`selectedOption must be one of: A, B, C, D, E, F`.

## Constraints

- `_text()` on every new field — an empty string is not an option.
- `_ => null` in both switches, not `optionD`.
- Do not touch `TestQuestionResult` or the attempt screen.
