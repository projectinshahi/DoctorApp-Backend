// The student's notifications screen.
//
// A student sees three kinds of row: one addressed to them, one addressed to
// the course they have selected, and one addressed to everybody. Which course
// they have selected is read now, not when the notification was sent, so
// switching course switches the list — the same rule the push targeting uses.
const prisma = require('../db');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** What this student is allowed to see. */
function visibleTo(user) {
  return {
    OR: [
      { userId: user.id },
      {
        userId: null,
        AND: [
          { OR: [{ courseId: null }, { courseId: user.selectedCourseId ?? -1 }] },
          // A notification scoped to one exam type is for the students on it.
          // Null means the whole course.
          { OR: [{ courseTypeId: null }, { courseTypeId: user.selectedCourseTypeId ?? -1 }] },
        ],
      },
    ],
  };
}

// GET /api/users/me/notifications?limit=&before=
async function listNotifications(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, selectedCourseId: true, selectedCourseTypeId: true, notificationsReadAt: true },
    });
    if (!user) return res.status(404).json({ error: { message: 'User not found' } });

    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        return res.status(400).json({ error: { message: 'limit must be a positive integer' } });
      }
      limit = Math.min(limit, MAX_LIMIT);
    }

    const where = visibleTo(user);

    // Paging by timestamp, not by page number: new notifications arrive while
    // a student scrolls, and a page number would show them the same row twice.
    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) {
        return res.status(400).json({ error: { message: 'before must be an ISO date' } });
      }
      where.createdAt = { lt: before };
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, type: true, title: true, body: true, data: true, createdAt: true },
      }),
      prisma.notification.count({
        where: user.notificationsReadAt
          ? { ...visibleTo(user), createdAt: { gt: user.notificationsReadAt } }
          : visibleTo(user),
      }),
    ]);

    return res.status(200).json({
      notifications: rows.map((n) => ({
        ...n,
        read: user.notificationsReadAt ? n.createdAt <= user.notificationsReadAt : false,
      })),
      unreadCount,
      // Absent when this is the last page, so the app knows to stop asking.
      nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt : null,
    });
  } catch (error) {
    console.error('listNotifications error:', error);
    return res.status(500).json({ error: { message: 'Failed to load notifications' } });
  }
}

// POST /api/users/me/notifications/read
//
// Marks everything up to now as read. One timestamp rather than a row per
// student per notification, which is all a badge needs.
async function markNotificationsRead(req, res) {
  try {
    const readAt = new Date();
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { notificationsReadAt: readAt },
    });
    return res.status(200).json({ readAt, unreadCount: 0 });
  } catch (error) {
    console.error('markNotificationsRead error:', error);
    return res.status(500).json({ error: { message: 'Failed to mark notifications as read' } });
  }
}

module.exports = { listNotifications, markNotificationsRead, visibleTo };
