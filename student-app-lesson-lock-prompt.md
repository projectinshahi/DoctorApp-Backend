# Task: trust the server's `locked` flag again

Paste this into Claude inside the **student app repo** (`dr_app`).

**Do this only after the admin panel change ships** — it is the second half of
the same fix, and on its own it would put padlocks back on the free samples.

---

## What happens today

A student with no subscription opens Internal Medicine and sees:

- **Cardiology premium** — Premium chip, padlock. Correct.
- **Pulmonology Free** — Free chip, **no padlock**. Tapping it shows the PRO
  paywall sheet.

No padlock, then a paywall on tap. That is worse than a padlock: the student
gets all the way to tapping before being refused.

## Why

`lib/models/selection_content_model.dart` overrides the server:

```dart
bool get isOpen {
  if (isPremium && !isFreePreview) return !locked;
  if (isQuiz) return true;      // ← a "free" quiz opens whatever `locked` says
  return hasMedia;
}
```

The comment on it is honest about the trade:

> A lesson the admin marked **Free** is open, whatever the tree's `locked` flag
> says. In a premium course the server sets locked on every lesson, so obeying
> that flag alone puts a padlock on exactly the lessons that were meant as the
> free sample. The server stays the authority: a quiz it still refuses ends at
> its own paywall.

That was the right call at the time — the panel could not express "free inside
a premium course", so obeying `locked` padlocked the samples. The panel can
express it now: it writes `isFreePreview: true`, and the server returns
`locked: false` for those lessons. Verified on the live backend — lesson 55
went from `locked: true` to `locked: false` the moment the flag was set, for a
student with no subscription.

So the override now causes the mismatch it was written to avoid.

## The change

```dart
/// The server decides. A lesson it will not serve is shut here too, so a
/// student is refused at the row rather than after tapping into it.
///
/// Media is still the exception: an unlocked video whose `videoUrl` was
/// stripped has nothing to play, and an empty player is a worse answer than
/// a padlock.
bool get isOpen {
  if (locked) return false;
  return isQuiz || hasMedia;
}
```

Keep `isPremium` and the chip exactly as they are — the chip says what a lesson
**is**, the padlock says whether **this student** can open it, and that
separation is right. The only change is that the padlock now believes the
server.

## What to check after

With a student who has **no** subscription on a premium course:

| lesson | expected |
|---|---|
| `isFreePreview: true` | **no padlock**, opens normally |
| `accessType: premium` | padlock, PRO sheet from the row |
| `accessType: free`, `isFreePreview: false` | padlock — and that is correct, it is genuinely locked |

The third row is the one to look at. If an admin meant it to be a free sample,
the fix is in the panel, not here. The app's job is to stop pretending.

## One more thing in this repo, unrelated

`lib/models/test_model.dart` parses only options A–D, and:

```dart
String? textFor(String letter) => switch (letter) {
      'A' => optionA, 'B' => optionB, 'C' => optionC,
      _  => optionD,        // ← E and F both render as D
    };
```

The backend now stores and serves six options on test questions. Until this is
updated, a six-option paper shows four, and if the answer is E or F the student
cannot answer it at all. Separate change, separate prompt — but do not publish
a six-option test before it lands.

## Constraints

- Ship after the panel change, not before.
- Do not touch `AccessChip` or `isPremium`.
- Keep the media exception — an unlocked video with no URL stays shut.
