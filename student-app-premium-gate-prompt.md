# Task: handle the paywall on Rapid Recall

Paste this into Claude inside the **student app repo** (`dr_app`).

Mock tests and Rapid Recall are now premium content, gated on the plan's
`mock` and `rapid_recall` entitlements. **Mock tests need no app change** —
`TestSummary` already parses `locked`, and `tests_tab.dart` already shows
`showPlanRequiredDialog` instead of starting a locked paper. Rapid Recall does
not, and will throw.

---

## What the server now sends

`GET /api/users/me/rapid-recalls`

```json
{
  "locked": true,
  "rapidRecalls": [
    { "id": 4, "title": "ECG rapid recall", "cardCount": 12,
      "noteUrl": null, "locked": true, ... }
  ]
}
```

`GET /api/users/me/rapid-recalls/:id` when locked:

```json
403
{ "error": {
    "code": "SUBSCRIPTION_REQUIRED",
    "message": "Rapid Recall is part of a subscription. Subscribe to open this deck.",
    "feature": "rapid_recall" } }
```

Decks stay **listed** rather than disappearing — a student cannot decide to
subscribe for something they cannot see. `locked` is what stops them opening
one, and `noteUrl` comes back **null** while locked, so the handout cannot be
fetched around the paywall.

## The change

**1. `RapidRecallDeck` — add `locked`.**

```dart
final bool locked;
// ...
locked: json['locked'] == true,
```

Default it to `false`, the same way `TestSummary.locked` does, so a response
from an older build does not padlock everything.

**2. `recall_decks_screen.dart` — refuse before the request.**

Follow what `tests_tab.dart` already does, so the two screens behave alike:

```dart
if (deck.locked) {
  await showPlanRequiredDialog(context, lessonTitle: deck.title);
  return;
}
```

A padlock on the row as well, beside the card count. The dialog is the same one
a locked lesson and a locked paper already use — do not write a second.

**3. `recall_cards_screen.dart` — handle the 403 anyway.**

The row check stops the common case, but a deck can lock between the list
loading and the tap — a subscription expiring mid-session does exactly that. On
a 403 whose `error.code` is `SUBSCRIPTION_REQUIRED`, show the same dialog and
pop back rather than surfacing a raw error.

**4. The handout button.** `hasHandout` is `noteUrl` being non-empty, and the
server nulls it while locked, so the button disappears on its own. Nothing to
change — just do not cache a `noteUrl` from an earlier unlocked response.

## What not to do

**Do not hide locked decks.** They are listed on purpose.

**Do not derive `locked` from anything local.** It is the server's answer: it
already accounts for the course being free, for a plan that declares no
entitlements buying everything, and for two subscriptions adding up. Anything
the app recomputes will disagree the first time one of those applies.

## How to check it

There are **no Rapid Recall decks on the live data yet**, so create one in the
admin panel first — course 22, published, a couple of cards.

| student | expect |
|---|---|
| user 51, no subscription | deck listed, padlocked, dialog on tap, no handout |
| user 43, Plan B (`rapid_recall`) | deck opens, cards and handout present |

Mock tests are worth a glance in the same pass, though nothing changed there:
user 51 should get padlocked papers and the plan dialog, user 43 should start
one normally.

## Constraints

- `locked` defaults to `false` on parse.
- Reuse `showPlanRequiredDialog`; do not add a second paywall sheet.
- Handle the 403 as well as the flag — the list can go stale.
- Do not hide locked decks, and do not recompute `locked`.
