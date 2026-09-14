# Task: Rapid Recall screens — by subject, by lesson, and the deck detail

Paste this into Claude inside the **student app repo** (`dr_app`).

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <student access token>` on every request.

Responses below were captured from the live backend on 2026-09-14.

---

## What a Rapid Recall is

A **deck** of revision cards. Each card is an **image, a note, or both**. A deck
can also carry one **handout** — a PDF or DOC file.

Decks are filed under a **subject** (OBGYN, Internal Med…), a **lesson**, both,
or neither. Neither means the deck applies to the whole course.

---

## The two endpoints

### 1. Every deck the student can see

```
GET /api/users/me/rapid-recalls
```

```json
{
  "rapidRecalls": [
    {
      "id": 4,
      "title": "ECG rapid recall",
      "description": "Read these the night before.",
      "noteUrl": null,
      "noteFileType": null,
      "courseTypeId": 20,
      "subjectId": 8,
      "lessonId": 49,
      "displayOrder": 0,
      "subject": { "id": 8, "name": "OBGYN" },
      "lesson": {
        "id": 49, "title": "testing",
        "chapter": { "id": 16, "title": "Internal Medicine" }
      },
      "cardCount": 1
    }
  ]
}
```

Only **published** decks, for the student's **selected course**, that are
either for their exam or for the whole course. Already sorted.

No cards in this response — just enough to draw lists.

**Optional filters, exact match:**

```
GET /api/users/me/rapid-recalls?subjectId=8
GET /api/users/me/rapid-recalls?lessonId=49
```

A non-number is a **400**. A student with no course selected gets
`{ "rapidRecalls": [], "reason": "No course selected yet." }` — show `reason`.

### 2. One deck, with its cards

```
GET /api/users/me/rapid-recalls/4
```

```json
{
  "rapidRecall": {
    "id": 4,
    "title": "ECG rapid recall",
    "description": "Read these the night before.",
    "noteUrl": "https://res.cloudinary.com/.../handout.pdf",
    "noteFileType": "pdf",
    "subject": { "id": 8, "name": "OBGYN" },
    "lesson": { "id": 49, "title": "testing",
                "chapter": { "id": 16, "title": "Internal Medicine" } },
    "cardCount": 3,
    "cards": [
      { "id": 11, "imageUrl": "https://res.cloudinary.com/.../ecg1.png",
        "note": "Inferior MI — II, III, aVF", "displayOrder": 0 },
      { "id": 12, "imageUrl": null,
        "note": "Anterior MI — V1 to V4", "displayOrder": 1 },
      { "id": 13, "imageUrl": "https://res.cloudinary.com/.../ecg2.svg",
        "note": null, "displayOrder": 2 }
    ]
  }
}
```

Cards come in order. **404** means the deck is a draft, belongs to another
course, or was deleted — show "This deck is no longer available" and go back.

---

## Screen 1 — Rapid Recall home, two tabs

**One call** to `GET /rapid-recalls`, then group on the device. Both tabs come
from the same list, so switching tabs never waits on the network.

### Tab "By subject"

Group decks by `subject.id`. One row per subject:

```
OBGYN                          3 decks · 42 cards   ›
Internal Med                   1 deck  · 12 cards   ›
General                        2 decks · 18 cards   ›
```

- Deck count = decks in the group; card count = sum of `cardCount`.
- **`subject` is null for course-wide decks** — put them under **"General"**,
  last.
- Sort subjects by name.

### Tab "By lesson"

Group decks by `lesson.id`. **Show the chapter under the lesson title:**

```
Obstetrics                                          ›
Obstetrics And Gynecology · 2 decks

Obstetrics                                          ›
Internal Medicine · 1 deck
```

**Lesson titles are not unique** — two real lessons are both called
"Obstetrics". Without `lesson.chapter.title` the student sees two identical
rows. Group the list under chapter headers, or use the chapter as the subtitle.

`lesson` is null for decks not tied to a lesson — put them under **"General"**.

---

## Screen 2 — decks for one subject or lesson

Tapping a row opens the decks in that group. **Filter the list you already
loaded**; do not refetch.

Each deck row: `title`, `description` (one line, nullable), `cardCount`
("12 cards"), and a document icon when `noteUrl` is not null.

Only call `?subjectId=` or `?lessonId=` when arriving **without** the full list —
for example from a lesson screen (below).

---

## Screen 3 — the deck

`GET /rapid-recalls/:id`, then a swipeable card view (`PageView`) with a
"3 / 12" counter.

**Each card:**
- `imageUrl` and `note` are **both nullable**, and never both null.
- Image only → the image fills the card.
- Note only → the note fills the card.
- Both → image on top, note below.
- **Notes can be long** — the live data has one several paragraphs long. Make
  the card body scrollable; never clip it.
- **Zoom on images** — pinch or tap to open full screen. An ECG is unreadable
  at card size on a phone.
- **SVG:** if `imageUrl` ends in `.svg`, use `SvgPicture.network`; otherwise
  `Image.network`. Never download an SVG's text and render it as a string.

**The handout:** when `noteUrl` is not null, show a button — "Open handout
(PDF)" using `noteFileType`. Open it with `url_launcher` in an external app.
Do not try to render a DOC in-app.

---

## On a lesson screen

On the existing lesson detail screen, call
`GET /rapid-recalls?lessonId=<id>`. If the list is not empty, show a
**"Rapid Recall · 2 decks"** entry that opens Screen 2 with those decks. Show
nothing when it's empty — no empty placeholder.

---

## Dart models

```dart
class RapidRecallDeck {
  final int id;
  final String title;
  final String? description;
  final String? noteUrl;
  final String? noteFileType;   // "pdf" | "doc" | "docx" | null
  final int? subjectId;
  final int? lessonId;
  final RecallSubject? subject; // null → "General"
  final RecallLesson? lesson;   // null → "General"
  final int cardCount;
  final List<RecallCard> cards; // empty in the list response
}

class RecallSubject { final int id; final String name; }

class RecallLesson {
  final int id;
  final String title;
  final RecallChapter? chapter;
}

class RecallChapter { final int id; final String title; }

class RecallCard {
  final int id;
  final String? imageUrl;
  final String? note;
  final int displayOrder;
}
```

Parse `cards` as `(json['cards'] as List?) ?? []` — the list response has no
`cards` key at all.

## Constraints

- One list call for both tabs; group on the device.
- `subject`, `lesson`, `imageUrl`, `note`, `noteUrl`, `description` are nullable.
- Always show the chapter next to a lesson title.
- Card body scrollable; images zoomable.
- SVG from the URL via `flutter_svg`.
- Handout opens externally.
