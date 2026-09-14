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

    const admin = require('firebase-admin');
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(credentials) });
    messaging = admin.messaging(app);
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
 */
async function notifyCoursePublished(course) {
  const message = newCourseMessage(course);
  const client = getMessaging();

  if (!client) {
    console.log('[push] would notify:', JSON.stringify({ topic: message.topic, ...message.notification, ...message.data }));
    return { sent: false, reason: 'not configured' };
  }

  try {
    const messageId = await client.send(message);
    console.log(`[push] announced course ${course.id} to ${TOPIC}:`, messageId);
    return { sent: true, messageId };
  } catch (error) {
    console.error(`[push] failed to announce course ${course.id}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = {
  notifyCoursePublished,
  // Exported for push.test.js.
  becamePublished, newCourseMessage, TOPIC, NEW_COURSE_CHANNEL,
};
