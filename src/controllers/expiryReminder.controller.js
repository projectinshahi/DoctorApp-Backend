// "Your plan ends in 3 days" — the reminders that go out on their own.
//
// The server has no scheduler of its own: the free Render instance sleeps when
// idle, so a setInterval here would stop running exactly when nobody is using
// the app. Something outside calls this endpoint on a schedule (see
// .github/workflows/expiry-reminders.yml) and this decides who is due.
const prisma = require('../db');
const push = require('../services/push.service');

// How close to the end a subscription has to be before anyone is told.
const WINDOW_DAYS = 10;

// Two a day is the schedule, so a second call within this many hours is a
// retry or a double trigger, not the evening reminder. Without this, a
// scheduler that retries on timeout would send a student four notifications.
const MIN_HOURS_BETWEEN = 5;

const DAY_MS = 86400000;

function reminderPayload({ courseTitle, daysLeft, subscriptionId, courseId }) {
  // Counting days, not hours: a student reading "ends in 0 days" would think
  // it already has.
  const when = daysLeft <= 0 ? 'today'
    : daysLeft === 1 ? 'tomorrow'
    : `in ${daysLeft} days`;

  return {
    title: `Your ${courseTitle} plan ends ${when}`,
    body: daysLeft <= 1
      ? 'Renew now to keep your lessons, tests and rapid recall.'
      : 'Renew to keep your lessons, tests and rapid recall without a break.',
    data: { type: 'subscription_expiring', subscriptionId, courseId, daysLeft },
  };
}

/**
 * POST /api/admin/notifications/expiry-reminders   { dryRun?: true }
 *
 * Tells every student whose plan ends within ten days. Safe to call more often
 * than intended: a student already told in the last few hours is skipped.
 */
async function sendExpiryReminders(req, res) {
  try {
    const now = new Date();
    const until = new Date(now.getTime() + WINDOW_DAYS * DAY_MS);
    const dryRun = req.body?.dryRun === true;

    const due = await prisma.subscription.findMany({
      where: { isActive: true, endDate: { gte: now, lte: until } },
      orderBy: { endDate: 'asc' },
      select: {
        id: true, userId: true, courseId: true, endDate: true,
        course: { select: { title: true } },
      },
    });

    // One student can hold two plans; remind them about the one ending first,
    // or they get two messages that contradict each other.
    const firstPerStudent = new Map();
    for (const sub of due) if (!firstPerStudent.has(sub.userId)) firstPerStudent.set(sub.userId, sub);

    const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN * 3600000);
    const results = { due: firstPerStudent.size, sent: 0, skipped: 0, noDevice: 0, dryRun };
    const detail = [];

    for (const sub of firstPerStudent.values()) {
      const daysLeft = Math.ceil((sub.endDate.getTime() - now.getTime()) / DAY_MS);
      const payload = reminderPayload({
        courseTitle: sub.course.title,
        daysLeft,
        subscriptionId: sub.id,
        courseId: sub.courseId,
      });

      const recent = await prisma.notification.findFirst({
        where: { userId: sub.userId, type: 'subscription_expiring', createdAt: { gt: cutoff } },
        select: { id: true },
      });
      if (recent) {
        results.skipped += 1;
        detail.push({ userId: sub.userId, daysLeft, outcome: 'already told recently' });
        continue;
      }

      if (dryRun) {
        detail.push({ userId: sub.userId, daysLeft, title: payload.title, outcome: 'would send' });
        continue;
      }

      // notifyStudent records the notification first, so it reaches the app's
      // notifications screen even for a student with no device registered.
      const result = await push.notifyStudent(sub.userId, payload);
      if (result.sent > 0) results.sent += 1; else results.noDevice += 1;
      detail.push({ userId: sub.userId, daysLeft, outcome: result.sent > 0 ? 'sent' : (result.reason ?? 'not delivered') });
    }

    console.log(`[expiry] ${results.due} due, ${results.sent} sent, ${results.skipped} skipped, ${results.noDevice} with no device`);
    return res.status(200).json({ ...results, windowDays: WINDOW_DAYS, detail });
  } catch (error) {
    console.error('sendExpiryReminders error:', error);
    return res.status(500).json({ error: { message: 'Failed to send expiry reminders' } });
  }
}

module.exports = { sendExpiryReminders, reminderPayload, WINDOW_DAYS, MIN_HOURS_BETWEEN };
