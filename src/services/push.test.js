// Course announcement rules. Run: node src/services/push.test.js
const assert = require('assert');

// Must run unconfigured: this test may not reach Firebase.
delete process.env.FIREBASE_SERVICE_ACCOUNT;

const { becamePublished, newCourseMessage, notifyCoursePublished, TOPIC } = require('./push.service');

// ── only the moment a course goes live ──

assert.strictEqual(becamePublished('draft', 'published'), true);
assert.strictEqual(becamePublished(null, 'published'), true, 'created already published');
assert.strictEqual(becamePublished(undefined, 'published'), true);

// Editing a live course must not announce it again — every typo fix would
// otherwise send a notification to every student.
assert.strictEqual(becamePublished('published', 'published'), false);

assert.strictEqual(becamePublished('published', 'draft'), false, 'unpublishing is not news');
assert.strictEqual(becamePublished('draft', 'draft'), false);
assert.strictEqual(becamePublished(null, 'draft'), false, 'a new draft is not announced');


// ── the message ──

const msg = newCourseMessage({ id: 22, title: 'GP License Exam' });
assert.strictEqual(msg.topic, TOPIC);
assert.strictEqual(msg.notification.body, 'GP License Exam');

// FCM rejects the whole send if any data value is not a string, and a numeric
// id is the easiest way to get that wrong.
for (const [key, value] of Object.entries(msg.data)) {
  assert.strictEqual(typeof value, 'string', `data.${key} must be a string`);
}
assert.strictEqual(msg.data.courseId, '22');
assert.strictEqual(msg.data.type, 'new_course');


// ── never throws, even unconfigured ──

(async () => {
  const result = await notifyCoursePublished({ id: 1, title: 'x' });
  assert.deepStrictEqual(result, { sent: false, reason: 'not configured' });
  console.log('push.test.js: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
