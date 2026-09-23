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

  const tokens = rows.map((r) => r.token);
  try {
    const result = await client.sendEachForMulticast({ ...message, tokens });

    const dead = [];
    result.responses.forEach((r, i) => {
      if (!r.success && isDeadToken(r.error && r.error.code)) dead.push(tokens[i]);
    });
    if (dead.length > 0) {
      // Left in place, a dead token makes every future send to this student
      // report a failure that nobody can act on.
      await prisma.fcmToken.deleteMany({ where: { token: { in: dead } } });
    }

    console.log(`[push] student ${userId}: ${result.successCount}/${tokens.length} delivered, ${dead.length} stale token(s) removed`);
    return { sent: result.successCount, failed: result.failureCount, pruned: dead.length };
  } catch (error) {
    console.error(`[push] failed to notify student ${userId}:`, error.message);
    return { sent: 0, reason: error.message };
  }
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

module.exports = {
  notifyCoursePublished, notifyStudent, notifyCourseJoined,
  // Exported for push.test.js.
  becamePublished, newCourseMessage, TOPIC, NEW_COURSE_CHANNEL, COURSE_UPDATES_CHANNEL,
  studentMessage, isDeadToken,
  _messagingClient: getMessaging,
  _resetForTests() { messaging = null; initialised = false; },
};
