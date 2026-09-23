// Push notifications, sent through Firebase Cloud Messaging.
//
// Every app subscribes to one topic, so announcing a course is a single send
// to Firebase rather than a loop over stored device tokens. There is no token
// table for that reason: a broadcast does not need to know who is listening.
//
// Two rules hold for everything here:
//
//   1. It never throws. A notification is a courtesy. If Firebase is down,
//      misconfigured or rate-limiting, the course must still publish — so every
//      failure is logged and swallowed rather than propagated to the admin.
//
//   2. It works before it is configured. Without FIREBASE_SERVICE_ACCOUNT it
//      logs what it would have sent. That lets this ship ahead of the Firebase
//      project existing, and turn on by adding one environment variable.

const TOPIC = 'all-students';

// Android shows it under this name in the app's notification settings, so a
// student can mute new-course alerts without muting everything. The app has to
// create the channel; if it has not, Android falls back to the default one.
const NEW_COURSE_CHANNEL = 'new_courses';

// Messages about a student's own courses. dr_app files course_join here
// (notification_service.dart), so sending it on new_courses instead would put
// the same notification on two different channels depending on whether the app
// happened to be open.
const COURSE_UPDATES_CHANNEL = 'course_updates';

let messaging = null;
let initialised = false;

function getMessaging() {
  if (initialised) return messaging;
  initialised = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT is not set — notifications will be logged, not sent');
    return null;
  }

  try {
    const credentials = JSON.parse(raw);
    // Pasted into a hosting dashboard, the key's newlines often arrive as the
    // two characters "\n". Firebase then rejects it with an unhelpful PEM
    // error on the first send, which is the worst moment to find out.
    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    // The modular API. firebase-admin 14 removed the old namespace —
    // admin.apps, admin.credential, admin.messaging() — entirely. Those calls
    // threw inside this try, the catch below swallowed it, and push stayed
    // silently disabled even with a valid key configured.
    const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
    const { getMessaging: firebaseMessaging } = require('firebase-admin/messaging');
    const app = getApps().length ? getApp() : initializeApp({ credential: cert(credentials) });
    messaging = firebaseMessaging(app);
  } catch (error) {
    console.error('[push] could not initialise Firebase:', error.message);
    messaging = null;
  }

  return messaging;
}


/**
 * Whether this save is the moment a course went live.
 *
 * Only the transition counts. Notifying on every save of a published course
 * would announce it again each time a typo in its description is fixed.
 */
function becamePublished(previousStatus, newStatus) {
  return newStatus === 'published' && previousStatus !== 'published';
}

function newCourseMessage(course) {
  return {
    topic: TOPIC,
    notification: {
      title: 'New course available',
      body: course.title,
    },
    // FCM rejects the whole message if any data value is not a string.
    data: {
      type: 'new_course',
      courseId: String(course.id),
    },
    android: {
      priority: 'high',
      notification: { channelId: NEW_COURSE_CHANNEL },
    },
  };
}

/**
 * Announces a newly published course to every student.
 *
 * ponytail: unpublishing a course and publishing it again announces it again,
 * because nothing records that it was already announced. Rare, and harmless
 * compared with a migration on the live database days before launch. Add a
 * notifiedAt column to Course if it starts happening.
 *
 * `dryRun` asks Firebase to validate the message and the credentials without
 * delivering it — the only way to check the real production path end to end
 * without notifying every student.
 */
async function notifyCoursePublished(course, { dryRun = false } = {}) {
  const message = newCourseMessage(course);
  const client = getMessaging();

  if (!client) {
    console.log('[push] would notify:', JSON.stringify({ topic: message.topic, ...message.notification, ...message.data }));
    return { sent: false, reason: 'not configured' };
  }

  try {
    const messageId = await client.send(message, dryRun);
    console.log(`[push] ${dryRun ? 'validated (dry run, not delivered)' : 'announced'} course ${course.id} to ${TOPIC}:`, messageId);
    return { sent: !dryRun, dryRun, messageId };
  } catch (error) {
    console.error(`[push] failed to announce course ${course.id}:`, error.message);
    return { sent: false, reason: error.message };
  }
}



// ── messages to one student ────────────────────────────────────────────────
//
// The topic above shouts to everyone. This sends to the devices of a single
// student, which needs their registration tokens — hence the fcm_tokens table.

/**
 * FCM saying a token is dead: the app was uninstalled, or its data cleared.
 *
 * messaging/invalid-argument is deliberately NOT here. It usually means the
 * message was malformed, not the token, so treating it as a dead token would
 * delete every working device the moment a bad payload went out.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function isDeadToken(code) {
  return DEAD_TOKEN_CODES.has(code);
}

/**
 * A message for a student's device.
 *
 * `data` values are forced to strings because FCM rejects the entire message
 * if any of them is a number — and an id is the easiest way to get that wrong.
 */
function studentMessage({ title, body, data = {}, channelId = NEW_COURSE_CHANNEL }) {
  return {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: { priority: 'high', notification: { channelId } },
  };
}

/**
 * Sends to every device a student has registered, and forgets the dead ones.
 *
 * Lazy require for the database so this file still loads, and its tests still
 * run, with no database at all.
 */
async function notifyStudent(userId, payload) {
  const prisma = require('../db');
  const rows = await prisma.fcmToken.findMany({ where: { userId }, select: { token: true } });
  const message = studentMessage(payload);

  if (rows.length === 0) {
    return { sent: 0, reason: 'no devices registered' };
  }

  const client = getMessaging();
  if (!client) {
    console.log(`[push] would notify student ${userId}:`, JSON.stringify({ ...message.notification, ...message.data }));
    return { sent: 0, reason: 'not configured' };
  }

  return sendToTokens(rows.map((r) => r.token), message, `student ${userId}`);
}

// FCM refuses a multicast with more than this many tokens, so a popular
// course has to go out in several calls.
const FCM_BATCH = 500;

/**
 * Delivers one message to many devices, and forgets the dead ones.
 *
 * Shared by the per-student and per-course senders: the batching and the
 * pruning are the same work either way.
 */
async function sendToTokens(tokens, message, label) {
  const prisma = require('../db');
  const client = getMessaging();
  const dead = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < tokens.length; i += FCM_BATCH) {
    const batch = tokens.slice(i, i + FCM_BATCH);
    try {
      const result = await client.sendEachForMulticast({ ...message, tokens: batch });
      sent += result.successCount;
      failed += result.failureCount;
      result.responses.forEach((r, j) => {
        if (!r.success && isDeadToken(r.error && r.error.code)) dead.push(batch[j]);
      });
    } catch (error) {
      console.error(`[push] failed to notify ${label}:`, error.message);
      return { sent, failed: tokens.length - sent, reason: error.message };
    }
  }

  if (dead.length > 0) {
    // Left in place, a dead token makes every future send report a failure
    // that nobody can act on.
    await prisma.fcmToken.deleteMany({ where: { token: { in: dead } } });
  }

  console.log(`[push] ${label}: ${sent}/${tokens.length} delivered, ${dead.length} stale token(s) removed`);
  return { sent, failed, pruned: dead.length };
}

// ── messages to everyone studying one course ───────────────────────────────
//
// "Studying" means the course the student has selected. A test or a deck
// scoped to one exam (courseTypeId) goes only to the students on that exam;
// DHA and MOHAP share a course, and the other exam's students would find the
// content missing when they opened it.

async function notifyCourseStudents({ courseId, courseTypeId }, payload) {
  const prisma = require('../db');
  const user = { selectedCourseId: courseId };
  if (courseTypeId !== null && courseTypeId !== undefined) {
    user.selectedCourseTypeId = courseTypeId;
  }

  const rows = await prisma.fcmToken.findMany({ where: { user }, select: { token: true } });
  const message = studentMessage(payload);
  const label = `course ${courseId}${user.selectedCourseTypeId ? `/type ${user.selectedCourseTypeId}` : ''}`;

  if (rows.length === 0) return { sent: 0, reason: 'no devices registered' };

  if (!getMessaging()) {
    console.log(`[push] would notify ${label} (${rows.length} device(s)):`, JSON.stringify({ ...message.notification, ...message.data }));
    return { sent: 0, reason: 'not configured' };
  }

  return sendToTokens(rows.map((r) => r.token), message, label);
}

// The payloads, kept pure so the tests can check them without a database.

function testPublishedPayload(test) {
  return {
    title: test.type === 'grand' ? 'New grand test' : 'New mock test',
    body: test.name,
    data: { type: 'new_test', testId: test.id, courseId: test.courseId },
    channelId: COURSE_UPDATES_CHANNEL,
  };
}

function rapidRecallPayload(recall) {
  return {
    title: 'New rapid recall',
    body: recall.title,
    data: { type: 'new_rapid_recall', rapidRecallId: recall.id, courseId: recall.courseId },
    channelId: COURSE_UPDATES_CHANNEL,
  };
}

// What a lesson is called in the notification. The type is the useful part:
// "New video" tells a student whether they have twenty minutes for this.
const LESSON_TITLES = { quiz: 'New quiz', video: 'New video lesson' };

function lessonPayload(lesson) {
  return {
    title: LESSON_TITLES[lesson.type] ?? 'New lesson',
    body: lesson.title,
    data: {
      // Quiz lessons keep their own type: the app already routes it, and a
      // quiz opens somewhere different from a video.
      type: lesson.type === 'quiz' ? 'new_quiz' : 'new_lesson',
      lessonId: lesson.id,
      courseId: lesson.courseId,
    },
    channelId: COURSE_UPDATES_CHANNEL,
  };
}

/** A published test, announced to the students sitting that exam. */
async function notifyTestPublished(test) {
  return notifyCourseStudents(test, testPublishedPayload(test));
}

/** A published rapid recall deck. */
async function notifyRapidRecallPublished(recall) {
  return notifyCourseStudents(recall, rapidRecallPayload(recall));
}

/**
 * A lesson that just went live.
 *
 * A lesson only knows its chapter, so the course is looked up here rather
 * than in every controller that publishes one.
 */
async function notifyLessonPublished(lesson) {
  const prisma = require('../db');
  const chapter = await prisma.chapter.findUnique({
    where: { id: lesson.chapterId },
    select: { courseId: true, courseTypeId: true, courseType: { select: { courseId: true } } },
  });
  if (!chapter) return { sent: 0, reason: 'lesson is not under a chapter' };

  // Live chapters carry a courseTypeId and leave courseId null — every one of
  // them, in fact. Reading only courseId found nothing and told nobody.
  const courseId = chapter.courseId ?? chapter.courseType?.courseId ?? null;
  if (courseId === null) return { sent: 0, reason: 'lesson is not under a course' };

  return notifyCourseStudents(
    { courseId, courseTypeId: chapter.courseTypeId },
    lessonPayload({ ...lesson, courseId }),
  );
}

/**
 * "You joined a new course!" — sent when a student picks a course.
 *
 * The channel id must match one the app created, or Android silently falls
 * back to its default channel and the student cannot mute this separately.
 */
async function notifyCourseJoined(userId, course) {
  return notifyStudent(userId, {
    title: 'You joined a new course!',
    body: `Welcome to ${course.title}`,
    data: { type: 'course_join', courseId: course.id },
    channelId: COURSE_UPDATES_CHANNEL,
  });
}


// ── new questions in a subject ─────────────────────────────────────────────
//
// A question belongs to a subject, not to a course, so the students to tell
// are the ones whose course uses that subject. A course can use one in two
// ways: it lists the subject itself, or one of its lessons carries a quiz
// drawn from that subject.

async function coursesUsingSubject(subjectId) {
  const prisma = require('../db');
  const [listed, viaQuizzes] = await Promise.all([
    prisma.course.findMany({ where: { subjects: { some: { id: subjectId } } }, select: { id: true } }),
    prisma.chapter.findMany({
      where: { courseId: { not: null }, lessons: { some: { quiz: { subjectId } } } },
      select: { courseId: true },
    }),
  ]);
  return [...new Set([...listed.map((c) => c.id), ...viaQuizzes.map((c) => c.courseId)])];
}

function subjectQuestionsPayload(subject, count) {
  return {
    title: `New questions in ${subject.name}`,
    body: count === 1 ? '1 new practice question added' : `${count} new practice questions added`,
    data: { type: 'new_questions', subjectId: subject.id, count },
    channelId: COURSE_UPDATES_CHANNEL,
  };
}

/**
 * Announces a batch of new questions to everyone whose course uses the subject.
 *
 * Silent when nothing links the subject to a course: sending it to everyone
 * instead would tell DHA students about questions they will never see.
 */
async function notifySubjectQuestions(subjectId, count) {
  const prisma = require('../db');
  const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true } });
  if (!subject) return { sent: 0, reason: 'subject not found' };

  const courseIds = await coursesUsingSubject(subjectId);
  if (courseIds.length === 0) {
    console.log(`[push] ${subject.name}: no course uses this subject yet, nothing sent`);
    return { sent: 0, reason: 'subject is not linked to any course' };
  }

  const rows = await prisma.fcmToken.findMany({
    where: { user: { selectedCourseId: { in: courseIds } } },
    select: { token: true },
  });
  if (rows.length === 0) return { sent: 0, reason: 'no devices registered' };

  const message = studentMessage(subjectQuestionsPayload(subject, count));
  const label = `subject ${subject.name} (course ${courseIds.join(', ')})`;
  if (!getMessaging()) {
    console.log(`[push] would notify ${label} (${rows.length} device(s)):`, JSON.stringify({ ...message.notification, ...message.data }));
    return { sent: 0, reason: 'not configured' };
  }

  return sendToTokens(rows.map((r) => r.token), message, label);
}


/**
 * An announcement written by an admin, to everyone on one course.
 *
 * data.type is deliberately generic: the app has nothing to open, so tapping
 * it should just bring the app up.
 */
function adminMessagePayload({ title, body, courseId }) {
  return {
    title,
    body,
    data: { type: 'admin_message', ...(courseId ? { courseId } : {}) },
    channelId: courseId ? COURSE_UPDATES_CHANNEL : NEW_COURSE_CHANNEL,
  };
}

/** How many devices an announcement would reach, before sending it. */
async function countCourseDevices({ courseId, courseTypeId }) {
  const prisma = require('../db');
  const user = { selectedCourseId: courseId };
  if (courseTypeId !== null && courseTypeId !== undefined) user.selectedCourseTypeId = courseTypeId;
  return prisma.fcmToken.count({ where: { user } });
}

/** The same announcement to every student, through the topic. */
async function broadcast({ title, body }) {
  const message = { topic: TOPIC, ...studentMessage(adminMessagePayload({ title, body })) };
  const client = getMessaging();
  if (!client) {
    console.log('[push] would broadcast:', JSON.stringify({ title, body }));
    return { sent: false, reason: 'not configured' };
  }
  try {
    const messageId = await client.send(message);
    console.log(`[push] broadcast to ${TOPIC}:`, messageId);
    return { sent: true, messageId };
  } catch (error) {
    console.error('[push] broadcast failed:', error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = {
  notifyCoursePublished, notifyStudent, notifyCourseJoined,
  notifyCourseStudents, notifyTestPublished, notifyRapidRecallPublished, notifyLessonPublished,
  notifySubjectQuestions, coursesUsingSubject,
  broadcast, countCourseDevices, adminMessagePayload,
  // Exported for push.test.js.
  becamePublished, newCourseMessage, TOPIC, NEW_COURSE_CHANNEL, COURSE_UPDATES_CHANNEL,
  studentMessage, isDeadToken,
  testPublishedPayload, rapidRecallPayload, lessonPayload, subjectQuestionsPayload,
  _messagingClient: getMessaging,
  _resetForTests() { messaging = null; initialised = false; },
};
