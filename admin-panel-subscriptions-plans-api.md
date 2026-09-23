# Subscriptions and Plans — API reference

Base URL: `https://doctorapp-backend-cl2h.onrender.com`

Admin endpoints need `Authorization: Bearer <admin token>` from
`POST /api/auth/admin/login`. Two endpoints are public, marked below.

Backend files, if you need to read the source:
`src/controllers/adminSubscription.controller.js`,
`src/routes/adminSubscription.routes.js`, `src/controllers/plan.controller.js`,
`src/routes/plan.routes.js`.

---

## Subscriptions — who paid, for what, until when

### List

`GET /api/admin/subscriptions`

| Query | Meaning |
|---|---|
| `status` | `active` or `expired`. Omit for both. |
| `courseId` | only that course |
| `planId` | only that plan |
| `userId` | one student's subscriptions |
| `search` | student name or email, case-insensitive |
| `limit` | default 50, max 200 |
| `offset` | for paging |

```json
{
  "subscriptions": [
    { "id": 17,
      "startDate": "2026-09-23T05:55:59.484Z",
      "endDate": "2026-11-07T05:55:59.484Z",
      "isActive": true, "active": true, "daysLeft": 45,
      "user":   { "id": 46, "name": "Project.inshahi Shahi", "email": "project.inshahi@gmail.com", "status": "verified" },
      "course": { "id": 21, "title": "Final year Medicine practical exam", "accessType": "premium" },
      "plan":   { "id": 28, "title": "Final year practical", "price": 50, "currency": "INR", "durationDays": 45 } }
  ],
  "total": 12, "activeCount": 12, "expiredCount": 0, "limit": 50, "offset": 0
}
```

**Use `active`, never `isActive`.** `isActive` is a stored column that nothing
flips when a plan runs out, so a row can claim to be active with an `endDate`
months past. `active` means `isActive` **and** `endDate` in the future — the
same test the student app's access check uses. Showing `isActive` would tell an
admin a student has access while the app refuses it.

`daysLeft` is negative once expired: `-12` means it ran out 12 days ago.

`total`, `activeCount` and `expiredCount` respect `courseId`/`planId`/`userId`
but ignore `status`, so the counts stay steady while an admin switches between
the Active and Expired tabs.

### Summary — for dashboard cards

`GET /api/admin/subscriptions/summary`

```json
{ "total": 12, "activeCount": 12, "expiredCount": 0,
  "activeRevenue": { "USD": 2115, "INR": 473.3 },
  "byCourse": [ { "courseId": 22, "title": "GP GULF LICENSING EXAM", "total": 7, "active": 7 } ],
  "byPlan":   [ { "planId": 7, "title": "Onam offere price", "price": 600, "currency": "USD", "total": 3, "active": 3 } ] }
```

**`activeRevenue` is one amount per currency, and they must never be added
up.** Plans are priced in both USD and INR; a single total would be a made-up
number. Show them as separate figures ("$2,115 · ₹473.30").

It is what the live plans are worth at today's prices, not accounting history:
changing a plan's price changes this number for subscriptions already sold.

### One subscription, with that student's history

`GET /api/admin/subscriptions/:id`

```json
{ "subscription": { ...same shape as the list... },
  "history": [ { "id": 11, "startDate": "...", "endDate": "...", "active": true,
                 "course": { "id": 19, "title": "..." },
                 "plan": { "id": 23, "title": "Plan A", "price": 100 } } ] }
```

`history` is that student's other subscriptions, newest first — how you tell a
renewal from a first purchase.

404 `Subscription not found` if the id is wrong.

---

## Plans

### All courses with their plans — **public, no token**

`GET /api/courses/plans`

Published courses that have at least one active plan, each with its active
plans in display order. This is what the website's pricing page uses, and it is
the easiest way to fill a "filter by plan" dropdown.

```json
{ "courses": [
    { "id": 22, "title": "GP GULF LICENSING EXAM", "description": "...", "accessType": "premium",
      "plans": [
        { "id": 15, "courseId": 22, "title": "Plan B", "description": "...",
          "price": 85, "currency": "USD", "durationDays": 45,
          "durationLabel": "45 days", "accentColor": "#0EA5E9",
          "features": ["..."], "entitlements": ["..."],
          "isActive": true, "displayOrder": 1 } ] } ] }
```

`durationLabel` is always present — it falls back to a phrase derived from
`durationDays`, so a card never has to word it itself.

`features` is sales copy for the card. `entitlements` are access codes the app
checks. They are separate on purpose; don't show entitlements to anyone.

### One course's plans — **public, no token**

`GET /api/courses/:courseId/plans` → `{ "plans": [ ... ] }`

Includes inactive plans as well, which is what the plan editor needs.

### One plan

`GET /api/plans/:id` (admin) → `{ "plan": { ... } }`

### Create, update, delete

- `POST /api/courses/:courseId/plans` (admin)
- `PUT /api/plans/:id` (admin)
- `DELETE /api/plans/:id` (admin)

Body fields: `title` (required), `price` (required, number), `currency`,
`durationDays` (required, integer), `description`, `durationLabel`,
`accentColor`, `features[]`, `entitlements[]`, `isActive`, `displayOrder`.

Plans can also be created with the course itself, by sending a `plans` array to
the course create endpoint.

---

## Errors

| HTTP | When |
|---|---|
| 400 | `status must be active or expired`, `courseId must be an integer`, `limit must be a positive integer` |
| 401 | Missing or expired admin token |
| 404 | `Subscription not found`, plan or course not found |
| 500 | Server error; the message is generic on purpose |

Every error is `{ "error": { "message": "..." } }`. The messages are written to
be shown to a person as they are.

---

## Suggested screen

**Subscriptions**, with:

- Summary cards at the top: active count, expired count, revenue per currency.
- Tabs or a dropdown for `status`, plus course and plan filters, and a search
  box for name or email.
- A table: student, course, plan, price, start, end, and a status pill from
  `active` — with `daysLeft` beside it ("42 days left", "expired 12 days ago").
- Row tap opens the detail with the student's history.

There is **no endpoint to cancel, extend or refund a subscription.** The panel
should not offer buttons for them. Ask if you want them; each is a decision
about what happens to access that day, not just a database write.
