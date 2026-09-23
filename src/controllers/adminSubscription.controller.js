// Subscriptions, as an admin sees them: who paid, for what, and until when.
//
// "Active" is not the isActive column on its own. Nothing flips that column
// when a plan runs out, so a row can say isActive with an endDate months past.
// Active means isActive AND endDate still in the future, which is exactly the
// test the student's own access check uses — the two must agree, or the panel
// says a student has access while the app refuses it.
const prisma = require('../db');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SUBSCRIPTION_SELECT = {
  id: true, startDate: true, endDate: true, isActive: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, status: true } },
  course: { select: { id: true, title: true, accessType: true } },
  plan: { select: { id: true, title: true, price: true, currency: true, durationDays: true } },
};

function shape(sub, now) {
  const active = sub.isActive && sub.endDate >= now;
  return {
    ...sub,
    active,
    // Negative once it has run out, which is more useful than clamping to
    // zero: "expired 12 days ago" is what an admin is actually asking.
    daysLeft: Math.ceil((sub.endDate.getTime() - now.getTime()) / 86400000),
  };
}

// GET /api/admin/subscriptions
//   ?status=active|expired&courseId=&planId=&userId=&search=&limit=&offset=
async function listSubscriptions(req, res) {
  try {
    const now = new Date();
    const where = {};

    for (const key of ['courseId', 'planId', 'userId']) {
      if (req.query[key] === undefined || req.query[key] === '') continue;
      const id = Number(req.query[key]);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: { message: `${key} must be an integer` } });
      }
      where[key] = id;
    }

    const status = (req.query.status ?? '').trim();
    if (status === 'active') {
      Object.assign(where, { isActive: true, endDate: { gte: now } });
    } else if (status === 'expired') {
      where.OR = [{ isActive: false }, { endDate: { lt: now } }];
    } else if (status !== '') {
      return res.status(400).json({ error: { message: 'status must be active or expired' } });
    }

    const search = (req.query.search ?? '').trim();
    if (search !== '') {
      where.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        return res.status(400).json({ error: { message: 'limit must be a positive integer' } });
      }
      limit = Math.min(limit, MAX_LIMIT);
    }
    let offset = 0;
    if (req.query.offset !== undefined) {
      offset = Number(req.query.offset);
      if (!Number.isInteger(offset) || offset < 0) {
        return res.status(400).json({ error: { message: 'offset must be zero or more' } });
      }
    }

    // The totals ignore status so the panel can show "14 active, 3 expired"
    // beside a filtered list, but they respect the other filters — a course's
    // page should not count another course's subscriptions.
    const totalsWhere = { ...where };
    delete totalsWhere.OR;
    delete totalsWhere.isActive;
    delete totalsWhere.endDate;

    const [rows, total, active] = await Promise.all([
      prisma.subscription.findMany({
        where,
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: limit, skip: offset,
        select: SUBSCRIPTION_SELECT,
      }),
      prisma.subscription.count({ where: totalsWhere }),
      prisma.subscription.count({ where: { ...totalsWhere, isActive: true, endDate: { gte: now } } }),
    ]);

    return res.status(200).json({
      subscriptions: rows.map((s) => shape(s, now)),
      total,
      activeCount: active,
      expiredCount: total - active,
      limit, offset,
    });
  } catch (error) {
    console.error('listSubscriptions error:', error);
    return res.status(500).json({ error: { message: 'Failed to load subscriptions' } });
  }
}

// GET /api/admin/subscriptions/summary
//
// What the dashboard needs: money and counts, per course and per plan.
async function subscriptionSummary(req, res) {
  try {
    const now = new Date();
    const subs = await prisma.subscription.findMany({
      select: {
        isActive: true, endDate: true,
        course: { select: { id: true, title: true } },
        plan: { select: { id: true, title: true, price: true, currency: true } },
      },
    });

    const byCourse = new Map();
    const byPlan = new Map();
    let activeTotal = 0;
    // Per currency. Plans are priced in USD and INR, and one number adding
    // 600 USD to 100 INR is worse than no number at all.
    const revenue = new Map();

    for (const s of subs) {
      const isActive = s.isActive && s.endDate >= now;
      if (isActive) {
        activeTotal += 1;
        // What the plans currently running are worth. Not accounting: it
        // reads the plan's price today, so a price change rewrites history.
        // Good enough for "how much is live right now".
        revenue.set(s.plan.currency, (revenue.get(s.plan.currency) ?? 0) + s.plan.price);
      }

      const c = byCourse.get(s.course.id) ?? { courseId: s.course.id, title: s.course.title, total: 0, active: 0 };
      c.total += 1; if (isActive) c.active += 1;
      byCourse.set(s.course.id, c);

      const p = byPlan.get(s.plan.id) ?? { planId: s.plan.id, title: s.plan.title, price: s.plan.price, currency: s.plan.currency, total: 0, active: 0 };
      p.total += 1; if (isActive) p.active += 1;
      byPlan.set(s.plan.id, p);
    }

    return res.status(200).json({
      total: subs.length,
      activeCount: activeTotal,
      expiredCount: subs.length - activeTotal,
      activeRevenue: Object.fromEntries(
        [...revenue.entries()].map(([currency, amount]) => [currency, Math.round(amount * 100) / 100]),
      ),
      byCourse: [...byCourse.values()].sort((a, b) => b.active - a.active),
      byPlan: [...byPlan.values()].sort((a, b) => b.active - a.active),
    });
  } catch (error) {
    console.error('subscriptionSummary error:', error);
    return res.status(500).json({ error: { message: 'Failed to summarise subscriptions' } });
  }
}

// GET /api/admin/subscriptions/:id
async function getSubscription(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const sub = await prisma.subscription.findUnique({ where: { id }, select: SUBSCRIPTION_SELECT });
    if (!sub) return res.status(404).json({ error: { message: 'Subscription not found' } });

    // Their other subscriptions, so an admin can see a renewal rather than
    // guessing from one row whether this student has been paying for a year.
    const history = await prisma.subscription.findMany({
      where: { userId: sub.user.id, id: { not: id } },
      orderBy: { startDate: 'desc' },
      select: { id: true, startDate: true, endDate: true, isActive: true, course: { select: { id: true, title: true } }, plan: { select: { id: true, title: true, price: true } } },
    });

    const now = new Date();
    return res.status(200).json({
      subscription: shape(sub, now),
      history: history.map((h) => ({ ...h, active: h.isActive && h.endDate >= now })),
    });
  } catch (error) {
    console.error('getSubscription error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the subscription' } });
  }
}

module.exports = { listSubscriptions, subscriptionSummary, getSubscription };
