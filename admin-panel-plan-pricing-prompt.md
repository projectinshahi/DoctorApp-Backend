# Task: build the plan pricing cards into course setup

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>` — except the two public reads below.

Everything here was run against the live database on 2026-09-12.

---

## The card, field by field

The pricing page shows four cards per course. Each one maps to a `Plan`:

| on the card | field | notes |
|---|---|---|
| **Plans A** | `title` | required |
| **$55** | `price` + `currency` | required; currency defaults `USD` |
| **30 days access** | `durationLabel` | optional — derived from `durationDays` when absent |
| card tint | `accentColor` | `#RRGGBB` or null |
| ✓ Mock Test<br>✓ Rapid Recalls | `features[]` | the tick list, free text |
| *(what it unlocks)* | `entitlements[]` | codes the server checks |
| card position | `displayOrder` | |
| shown at all | `isActive` | inactive disappears from the public page |

### features and entitlements are two different things

**`features`** is the sales copy. Free text, reworded whenever marketing
changes — `"Everything in Plan C"`, `"Live Classes with Faculty"`.

**`entitlements`** is what actually unlocks content. A closed list:

```
mcq · mock · rapid_recall · video_lecture · live_class · ai_patient
```

An unknown code is refused, by name:

```json
400 { "error": { "message": "unknown entitlement(s): vidoe_lecture. Valid: mcq, mock, rapid_recall, video_lecture, live_class, ai_patient" } }
```

**Do not derive one from the other in the form.** If access were read from the
tick list, renaming a bullet would revoke a feature a student paid for. In the
editor: a free-text list for the ticks, and a set of checkboxes for the
entitlements.

Note the difference in practice — Plan D's tick list says *"Everything in Plan
C"*, one line, but its entitlements have to spell out all five codes. The card
is shorthand; the server is not.

### `durationLabel`

Leave it empty and the API derives it: 30 → `"30 days access"`, 90 →
`"3 months access"`, 365 → `"1 year access"`. Fill it in only to override —
`"One term"`, say. **It is always present in the response**, so the card never
has to work out the wording.

---

## Creating a course and its plans together

```json
POST /api/courses
{ "title": "GP License Exam", "status": "published", "accessType": "premium",
  "plans": [
    { "title": "Plan A", "price": 55,  "durationDays": 30, "accentColor": "#EFEFEF",
      "features": ["Mock Test", "Rapid Recalls"],
      "entitlements": ["mock", "rapid_recall"] },
    { "title": "Plan B", "price": 85,  "durationDays": 45, "accentColor": "#DDE5F5",
      "features": ["MCQ Bank", "Mock Test", "Rapid Recalls"],
      "entitlements": ["mcq", "mock", "rapid_recall"] },
    { "title": "Plan C", "price": 150, "durationDays": 45, "accentColor": "#F5DDDD",
      "features": ["MCQ Bank", "Mock Test", "Rapid Recalls", "Video Lectures"],
      "entitlements": ["mcq", "mock", "rapid_recall", "video_lecture"] },
    { "title": "Plan D", "price": 280, "durationDays": 90, "accentColor": "#EFEFEF",
      "features": ["Everything in Plan C", "Live Classes with Faculty"],
      "entitlements": ["mcq", "mock", "rapid_recall", "video_lecture", "live_class"] } ] }
```

Card order follows the array unless a `displayOrder` is given. `plans` sits
alongside the existing `courseTypes` array — one call sets up the whole course.

Errors name the index: `plans[2]: price must be a positive number`.

**Add the pricing step to the course wizard**, after details and course types.
A premium course created with no plans is a course nobody can buy, so warn
before finishing when `accessType` is `premium` and the plan list is empty.

### Editing afterwards

```
POST   /api/courses/:courseId/plans     add one
PUT    /api/plans/:id                   edit — partial, send only what changed
DELETE /api/plans/:id                   remove
GET    /api/plans/:id                   one plan, admin
```

`PUT` is partial: changing a price does not mean resending the feature list.

---

## The two public reads

**The whole pricing page, one call** — no token:

```
GET /api/courses/plans
```

```json
{ "courses": [
  { "id": 22, "title": "GP License Exam", "description": "...", "accessType": "premium",
    "plans": [
      { "id": 31, "title": "Plan A", "price": 55, "currency": "USD",
        "durationDays": 30, "durationLabel": "30 days access",
        "accentColor": "#EFEFEF",
        "features": ["Mock Test", "Rapid Recalls"],
        "entitlements": ["mock", "rapid_recall"],
        "displayOrder": 0 } ] } ] }
```

One course per tab, one card per plan — the page renders from this alone. Only
**published** courses with at least one **active** plan appear.

**One tab on its own** — also no token:

```
GET /api/courses/:courseId/plans
```

`isActive: false` hides a plan from both. That is how you retire a price
without deleting the subscriptions attached to it — a deleted plan would orphan
every receipt referencing it.

---

## What to build

**Pricing step in the course wizard** — a repeatable card editor: title, price,
currency, duration in days, an optional label override, a colour swatch, a
free-text tick list, and entitlement checkboxes. Reorder by dragging.

**Plans tab on the course detail screen** — the same editor for an existing
course, plus an Active toggle per card.

**A live preview** beside the editor showing the card as the website will draw
it, using `durationLabel` from the response rather than recomputing it.

## Constraints

- `features` is free text; `entitlements` is a fixed list of six codes. Never
  generate one from the other.
- Send only changed fields to `PUT /api/plans/:id`.
- Retire with `isActive: false`; do not delete a plan that has subscriptions.
- `durationLabel` always comes back filled — render it, do not recompute.
- Warn when a premium course is being finished with no plans.
