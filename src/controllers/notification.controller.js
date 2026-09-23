// Announcements an admin writes by hand.
//
// Everything else in push.service fires off an event — a course published, a
// lesson going live. This is the one place a human chooses the words, so it is
// the only one that needs validating: a message with an empty title or a
// wrong course id is a mistake, not a missing feature.
const push = require('../services/push.service');
const prisma = require('../db');

// Android collapses anything longer, and FCM caps the whole payload at 4KB.
const MAX_TITLE = 120;
const MAX_BODY = 500;

// POST /api/admin/notifications
// { title, body, courseId?, courseTypeId?, dryRun? }
//
// No courseId means every student, through the topic.
async function sendNotification(req, res) {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    if (title === '') return res.status(400).json({ error: { message: 'title is required' } });
    if (body === '') return res.status(400).json({ error: { message: 'body is required' } });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: { message: `title must be ${MAX_TITLE} characters or fewer` } });
    if (body.length > MAX_BODY) return res.status(400).json({ error: { message: `body must be ${MAX_BODY} characters or fewer` } });

    const hasCourse = req.body?.courseId !== undefined && req.body.courseId !== null;
    if (!hasCourse) {
      // Everyone. No recipient count exists: topic membership lives inside
      // Firebase, not here.
      if (req.body?.dryRun === true) {
        return res.status(200).json({ target: 'all students', devices: null, sent: 0, dryRun: true });
      }
      const result = await push.broadcast({ title, body });
      return res.status(result.sent ? 200 : 502).json({ target: 'all students', ...result });
    }

    const courseId = Number(req.body.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'courseId must be an integer' } });
    }
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true } });
    if (!course) return res.status(404).json({ error: { message: 'Course not found' } });

    let courseTypeId = null;
    if (req.body.courseTypeId !== undefined && req.body.courseTypeId !== null) {
      courseTypeId = Number(req.body.courseTypeId);
      if (!Number.isInteger(courseTypeId)) {
        return res.status(400).json({ error: { message: 'courseTypeId must be an integer' } });
      }
      // Scoping to an exam that belongs to another course would silently
      // reach nobody, which looks the same as a delivery failure.
      const type = await prisma.courseType.findFirst({
        where: { id: courseTypeId, courseId }, select: { id: true },
      });
      if (!type) return res.status(400).json({ error: { message: 'That exam type belongs to a different course' } });
    }

    const devices = await push.countCourseDevices({ courseId, courseTypeId });

    // The panel asks first, so an admin can see "3 devices" before sending to
    // what they assumed were three hundred students.
    if (req.body?.dryRun === true) {
      return res.status(200).json({ target: course.title, devices, sent: 0, dryRun: true });
    }

    const result = await push.notifyCourseStudents(
      { courseId, courseTypeId },
      push.adminMessagePayload({ title, body, courseId }),
    );

    return res.status(200).json({ target: course.title, devices, ...result });
  } catch (error) {
    console.error('sendNotification error:', error);
    return res.status(500).json({ error: { message: 'Failed to send the notification' } });
  }
}

module.exports = { sendNotification };
