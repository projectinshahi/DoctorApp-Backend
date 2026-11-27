// The full-access (owner) flag, end to end through the controllers.
// Run: node src/controllers/fullAccess.test.js
//
// No database: prisma is swapped for a recorder in require.cache before any
// controller loads, the same way authPassword.test.js does it. Every call is
// logged as { model, op, args }; `handlers['model.op']` decides the answer.
const assert = require('assert');
const path = require('path');

const log = [];
let handlers = {};
const DEFAULTS = { findMany: [], count: 0, groupBy: [] };
const model = (name) => new Proxy({}, {
  get: (_, op) => async (args) => {
    log.push({ model: name, op, args });
    const h = handlers[`${name}.${op}`];
    if (h) return typeof h === 'function' ? h(args) : h;
    return op in DEFAULTS ? DEFAULTS[op] : null;
  },
});
const fakeDb = new Proxy({}, { get: (_, name) => model(name) });
require.cache[path.resolve(__dirname, '../db.js')] = { exports: fakeDb };

const calls = (m, op) => log.filter((c) => c.model === m && (!op || c.op === op));
const reset = (next = {}) => { log.length = 0; handlers = next; };

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
async function call(fn, req) {
  const res = fakeRes();
  await fn({ params: {}, query: {}, body: {}, ...req }, res);
  return res;
}

// Quiet the controllers' own error logging unless a test fails on it.
const errors = [];
console.error = (...a) => errors.push(a.map(String).join(' '));

const profile = require('./profile.controller');
const subscription = require('./subscription.controller');
const plan = require('./plan.controller');
const adminStudent = require('./adminStudent.controller');
const adminSubscription = require('./adminSubscription.controller');
const expiry = require('./expiryReminder.controller');
const testAttempt = require('./testAttempt.controller');
const selected = require('./selected-course.controller');

const OWNER_ROW = { fullAccess: true, status: 'verified' };
const PREMIUM_USER = (extra = {}) => ({
  id: 7, email: 'o@example.com', name: 'O', phone: null, avatarUrl: null, role: 'student',
  status: 'verified', selectedCourseId: 3,
  selectedCourse: { id: 3, title: 'C', thumbnail: null, accessType: 'premium' },
  selectedCourseType: null, ...extra,
});

(async () => {
  // ── PUT /api/users/me cannot set fullAccess ──
  reset({ 'user.update': ({ data }) => PREMIUM_USER({ ...data, fullAccess: false }) });
  let res = await call(profile.updateProfile, {
    user: { userId: 7 },
    body: { name: '  New  ', fullAccess: true, role: 'admin', status: 'verified', email: 'x@y.z' },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls('user', 'update')[0].args.data, { name: 'New' }, 'only allow-listed fields reach prisma');
  assert.strictEqual(res.body.user.fullAccess, false);
  assert.strictEqual(res.body.user.subscriptionInfo.hasPaid, false);

  reset();
  res = await call(profile.updateProfile, { user: { userId: 7 }, body: { fullAccess: true } });
  assert.strictEqual(res.statusCode, 400, 'fullAccess alone is not an updatable field');
  assert.strictEqual(calls('user', 'update').length, 0, 'nothing written');

  // ── GET /api/users/me ──
  reset({ 'user.findUnique': PREMIUM_USER({ fullAccess: true }) });
  res = await call(profile.getProfile, { user: { userId: 7 } });
  assert.strictEqual(res.body.user.subscriptionInfo.hasPaid, true);
  assert.strictEqual(res.body.user.subscriptionInfo.fullAccess, true);
  assert.strictEqual(res.body.user.subscriptionInfo.isPremiumCourse, true);
  assert.strictEqual(calls('user', 'findUnique').length, 1, 'the profile row is reused, no second user query');
  assert.strictEqual(calls('user', 'findUnique')[0].args.select.fullAccess, true);

  // JWT payload claims are ignored: the DB row says no.
  reset({ 'user.findUnique': PREMIUM_USER({ fullAccess: false }) });
  res = await call(profile.getProfile, { user: { userId: 7, fullAccess: true } });
  assert.strictEqual(res.body.user.subscriptionInfo.hasPaid, false);

  // ── GET /api/users/me/subscription-status ──
  reset({ 'user.findUnique': { selectedCourseId: 3, selectedCourse: { accessType: 'premium' }, ...OWNER_ROW } });
  res = await call(subscription.getMySubscriptionStatus, { user: { userId: 7 } });
  assert.deepStrictEqual(res.body,
    { hasCourseSelected: true, isPremiumCourse: true, hasPaid: true, subscription: null, fullAccess: true });
  assert.strictEqual(calls('user', 'findUnique').length, 1);

  // ── GET /api/users/me/plans: synthetic subscription, no renewal banner ──
  const planRow = { id: 1, title: 'Plan A', durationDays: 30, price: 10, currency: 'USD', isActive: true };
  reset({
    'user.findUnique': { selectedCourseId: 3, selectedCourse: { id: 3, title: 'C', description: null, accessType: 'premium' }, ...OWNER_ROW },
    'plan.findMany': [planRow],
  });
  res = await call(plan.getMyCoursePlans, { user: { userId: 7 } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.fullAccess, true);
  assert.strictEqual(res.body.isPremiumCourse, true);
  assert.strictEqual(res.body.plans.length, 1);
  assert.strictEqual(res.body.plans[0].isCurrent, false);
  const cs = res.body.currentSubscription;
  assert.strictEqual(cs.id, 0);
  assert.strictEqual(cs.planId, 0);
  assert.strictEqual(cs.endDate, null);
  assert.strictEqual(typeof cs.plan.title, 'string');
  assert.deepStrictEqual(cs.plan.entitlements, plan.VALID_ENTITLEMENTS);
  // student app: expiringInDays shows a countdown only for 0..10 days left.
  assert.ok(cs.daysLeft > 10, 'no "plan ends in N days" banner');
  assert.strictEqual(calls('subscription').length, 0, 'real rows are not looked up');

  // Ordinary student: unchanged path, a real lookup.
  reset({
    'user.findUnique': { selectedCourseId: 3, selectedCourse: { id: 3, title: 'C', description: null, accessType: 'premium' }, fullAccess: false, status: 'verified' },
    'plan.findMany': [planRow],
  });
  res = await call(plan.getMyCoursePlans, { user: { userId: 7 } });
  assert.strictEqual(res.body.currentSubscription, null);
  assert.strictEqual(res.body.fullAccess, undefined);
  assert.strictEqual(calls('subscription', 'findFirst').length, 1);

  // ── quiz serving: full access counts as subscribed (premium questions) ──
  reset({
    'user.findUnique': { selectedCourseId: 3, selectedCourseTypeId: null, selectedCourse: { accessType: 'premium' }, ...OWNER_ROW },
    'lesson.findUnique': {
      id: 11, title: 'Q', type: 'quiz', status: 'published', accessType: 'premium', isFreePreview: false,
      lessonPlans: [{ planId: 99, plan: { id: 99 } }],
      chapter: { courseId: 3, courseTypeId: null },
      quiz: { id: 5, status: 'active' },
    },
  });
  const gate = await selected.loadStudentQuiz(7, 11);
  assert.strictEqual(gate.error, undefined, 'a pinned premium quiz opens');
  assert.strictEqual(gate.hasSubscription, true, 'so freeOnly is false');
  assert.strictEqual(calls('subscription').length, 0);
  assert.strictEqual(calls('user', 'findUnique').length, 1);

  // ── course tree and home: hasPaid true on a premium course ──
  reset({ 'user.findUnique': { selectedCourseId: 3, selectedCourseTypeId: null,
    selectedCourse: { id: 3, title: 'C', thumbnail: null, accessType: 'premium' }, ...OWNER_ROW } });
  res = await call(selected.getSelectedCourseContent, { user: { userId: 7 } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.hasPaid, true);
  assert.strictEqual(calls('subscription').length, 0);
  assert.strictEqual(calls('user', 'findUnique').length, 1);

  reset({ 'user.findUnique': { selectedCourseId: 3, selectedCourseTypeId: null,
    selectedCourse: { id: 3, title: 'C', thumbnail: null, accessType: 'premium' }, ...OWNER_ROW } });
  res = await call(require('./home.controller').getHome, { user: { userId: 7 } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.hasPaid, true);
  assert.strictEqual(calls('subscription').length, 0);

  // ── mock tests list: locked false with no subscription ──
  reset({
    'user.findUnique': { selectedCourseTypeId: null, ...OWNER_ROW },
    'test.findMany': [{ id: 1, name: 'T', attempts: [] }],
  });
  res = await call(testAttempt.listTests, { user: { userId: 7 }, params: { courseId: '3' } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.tests[0].locked, false);
  assert.strictEqual(calls('user', 'findUnique').length, 1);

  // ── admin student detail ──
  const lesson = (id, extra = {}) => ({
    id, title: `L${id}`, type: 'video', status: 'published', accessType: 'premium', isFreePreview: false,
    displayOrder: id, videoUrl: 'v', noteUrl: null, thumbnailUrl: null, noteFileType: null,
    quizId: null, content: null, videos: [{ id, accessType: 'premium' }], lessonPlans: [], ...extra,
  });
  const chapters = [{ id: 1, title: 'Ch', displayOrder: 1, lessons: [
    lesson(1), lesson(2, { lessonPlans: [{ plan: { id: 99, title: 'P', price: 1, durationDays: 1, isActive: true } }] }),
  ] }];
  const adminUser = (extra) => ({
    ...PREMIUM_USER(), createdAt: new Date(), selectedCourseTypeId: null, sessions: [], ...extra,
  });

  reset({ 'user.findUnique': adminUser({ fullAccess: true }), 'chapter.findMany': chapters });
  res = await call(adminStudent.getStudentById, { params: { id: '7' } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.hasActiveSubscription, true);
  assert.strictEqual(res.body.student.fullAccess, true);
  for (const l of res.body.chapters[0].lessons) {
    assert.strictEqual(l.visibleToStudent, true, `lesson ${l.id} open to full access`);
    assert.strictEqual(l.unlockedByPlan, true);
  }

  // The old bug: a real live subscription used to report false.
  const later = new Date(Date.now() + 864e5);
  reset({
    'user.findUnique': adminUser({ fullAccess: false }),
    'chapter.findMany': chapters,
    'subscription.findMany': [{ id: 1, courseId: 3, planId: 4, isActive: true, endDate: later, plan: { entitlements: [] } }],
  });
  res = await call(adminStudent.getStudentById, { params: { id: '7' } });
  assert.strictEqual(res.body.hasActiveSubscription, true, 'fixed: was always false');
  assert.strictEqual(res.body.student.fullAccess, false);
  assert.deepStrictEqual(res.body.chapters[0].lessons.map((l) => l.visibleToStudent), [true, false],
    'pinned lesson stays shut to another plan');

  reset({ 'user.findUnique': adminUser({ fullAccess: false }), 'chapter.findMany': chapters });
  res = await call(adminStudent.getStudentById, { params: { id: '7' } });
  assert.strictEqual(res.body.hasActiveSubscription, false);

  // Blocked owner: the flag opens nothing.
  reset({ 'user.findUnique': adminUser({ fullAccess: true, status: 'blocked' }), 'chapter.findMany': chapters });
  res = await call(adminStudent.getStudentById, { params: { id: '7' } });
  assert.strictEqual(res.body.hasActiveSubscription, false);
  assert.strictEqual(res.body.student.fullAccess, true, 'stored flag still shown');

  // Admin list carries the flag (additive).
  reset({ 'user.findMany': [{ id: 7, name: 'O', email: 'o@x', phone: null, status: 'verified', createdAt: new Date(),
    fullAccess: true, selectedCourse: null, selectedCourseType: null, sessions: [] }], 'user.count': 1 });
  res = await call(adminStudent.getStudentList, {});
  assert.strictEqual(res.body.data[0].fullAccess, true);

  // Admin status endpoint: status only, a fullAccess field is not written.
  reset({ 'user.findUnique': { id: 7, role: 'student', status: 'verified' },
    'user.update': { id: 7, name: 'O', email: 'o@x', status: 'verified' } });
  res = await call(adminStudent.updateStudentStatus, { params: { id: '7' }, body: { status: 'verified', fullAccess: true } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.deepStrictEqual(calls('user', 'update')[0].args.data, { status: 'verified' });

  // ── left out of reminders, revenue and rankings ──
  reset();
  res = await call(expiry.sendExpiryReminders, { body: { dryRun: true } });
  assert.deepStrictEqual(calls('subscription', 'findMany')[0].args.where.user, { fullAccess: false });

  reset();
  res = await call(adminSubscription.subscriptionSummary, {});
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.deepStrictEqual(calls('subscription', 'findMany')[0].args.where, { user: { fullAccess: false } });

  reset();
  await testAttempt.buildLeaderboard({ id: 1, totalQuestions: 10 });
  assert.deepStrictEqual(calls('testAttempt', 'findMany')[0].args.where.user, { fullAccess: false });

  console.log('fullAccess.test.js: all passed');
})().catch((err) => { process.stderr.write(`${err.stack}\n${errors.join('\n')}\n`); process.exit(1); });
