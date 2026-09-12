# Task: creating a premium course

Paste this into Claude inside the **admin panel repo**.

Base URL: `https://doctorapp-backend-30gd.onrender.com`
Auth: `Authorization: Bearer <admin token>`, except the two public reads.

Run against the live database on 2026-09-12.

---

## What "premium" now means

Setting `accessType: "premium"` on a course **locks every lesson in it**. That
is new — until now it changed a banner and nothing else, and the only way to
sell a course was to mark each lesson premium by hand.

Verified: flipping one course to premium took it from 1 locked lesson to 6, and
`hasPaid` from true to false.

Two things still open a lesson inside a premium course:

- **An active subscription** to that course.
- **`isFreePreview: true`** on the lesson — the only way to let someone sample
  a paid course. Set it on one or two lessons per course; they stay open to
  everyone.

A lesson tied to specific plans keeps its own rule. The course widens what is
locked, not what unlocks it — a Plan B subscriber still cannot open a
Plan-C-only lesson.

---

## Creating one: three things in one call

```json
POST /api/courses
{
  "title": "GP License Exam",
  "description": "Gulf licensing preparation",
  "status": "published",
  "accessType": "premium",

  "courseTypes": [
    { "title": "DHA (Dubai) Exam", "status": "published" },
    { "title": "UAE MOHAP Exam",   "status": "published" }
  ],

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
      "entitlements": ["mcq", "mock", "rapid_recall", "video_lecture", "live_class"] }
  ]
}
```

Both arrays are optional and both can be added later. Errors name the index —
`plans[2]: price must be a positive number`.

### The wizard

**Details → Exams → Pricing → Review.**

Pricing appears only when `accessType` is `premium`; a free course has nothing
to sell. And **block Finish on a premium course with no plans** — that is a
course locked to everyone, with no way to buy it. The most damaging state
possible, and it takes one forgotten step to reach.

On the review step, say plainly what will happen:

> Every lesson in this course will be locked until a student subscribes.
> Mark a lesson as **free preview** to leave it open.

---

## Afterwards

```
PUT    /api/courses/:id                 { "accessType": "premium" }
POST   /api/courses/:courseId/plans     add a plan
PUT    /api/plans/:id                   edit — partial
DELETE /api/plans/:id                   remove
```

**Switching an existing course to premium locks its content immediately** for
every student who has not paid. Confirm it with the count:

> This will lock 42 lessons for 187 students who do not have a subscription.

The lesson count is on the course detail response; the student count is
`GET /admin/students?courseId=…`.

**Free preview** is a checkbox on the lesson editor — `isFreePreview` on
`PUT /api/lessons/:id`. Surface it on the course screen too, as
"3 lessons open to everyone", so an admin can see the shop window without
opening each lesson.

---

## The two public reads

```
GET /api/courses/plans          every published course with its live plans
GET /api/courses/:courseId/plans   one course
```

No token. These are what the website's pricing page reads. Only **published**
courses with at least one **active** plan appear, so a draft course cannot be
bought and a retired price cannot be reached from a stale tab.

Retire a price with `isActive: false` rather than deleting it — a deleted plan
orphans every subscription that referenced it.

---

## What to build

**Pricing step in the course wizard**, shown for premium courses: a repeatable
card editor — title, price, currency, duration in days, optional label
override, colour swatch, free-text tick list, entitlement checkboxes.
Reorderable.

**Access section on the course detail screen** — the free/premium toggle with
the confirmation above, the plan list, and a count of free-preview lessons.

**A guard on Finish** when premium and no plans exist.

## Constraints

- Premium locks every lesson. Say so before saving, not after.
- Never finish a premium course with zero plans.
- `features` is sales copy; `entitlements` is the six-code access list. Never
  generate one from the other.
- Retire with `isActive: false`; do not delete a plan with subscriptions.
- `durationLabel` comes back filled — render it, do not recompute.
