// Student access lookups. Run: node src/services/access.test.js
//
// No database: prisma is swapped for a recorder in require.cache before the
// service loads, the same way authPassword.test.js does it.
const assert = require('assert');
const path = require('path');

// `calls` records subscription queries only; the full-access flag lookup
// (user.findUnique) goes to `userCalls`, so "no subscription query"
// assertions stay exact.
const calls = [];
const userCalls = [];
let rows = [];
let userRow = { fullAccess: false, status: 'verified' };
const fakeDb = {
  user: {
    findUnique: async (args) => { userCalls.push(args); return userRow; },
  },
  subscription: {
    findMany: async (args) => { calls.push({ op: 'findMany', args }); return rows; },
    findFirst: async (args) => { calls.push({ op: 'findFirst', args }); return rows[0] ?? null; },
  },
};
require.cache[path.resolve(__dirname, '../db.js')] = { exports: fakeDb };

const access = require('./access.service');
const selected = require('../controllers/selected-course.controller');

const reset = (next = [], user = { fullAccess: false, status: 'verified' }) => {
  calls.length = 0; userCalls.length = 0; rows = next; userRow = user;
};
const sub = (planId, entitlements) => ({ planId, plan: { entitlements } });

(async () => {
  // ── the where-clause: one definition of "active" ──
  const now = new Date('2026-01-01T00:00:00Z');
  assert.deepStrictEqual(access.activeSubscriptionWhere(7, 3, now),
    { userId: 7, courseId: 3, isActive: true, endDate: { gte: now } });
  const live = access.activeSubscriptionWhere(7, 3);
  assert.ok(live.endDate.gte instanceof Date, 'defaults to now');

  // The in-memory twin agrees at the boundary: ending exactly now is active.
  assert.strictEqual(access.isSubscriptionActive({ isActive: true, endDate: now }, now), true);
  assert.strictEqual(access.isSubscriptionActive({ isActive: true, endDate: new Date(now - 1) }, now), false);
  assert.strictEqual(access.isSubscriptionActive({ isActive: false, endDate: new Date(now.getTime() + 1e9) }, now), false);

  // ── getCourseAccess ──
  reset([sub(1, ['mcq']), sub(2, ['mock'])]);
  const a = await access.getCourseAccess(7, 3);
  assert.deepStrictEqual([...a.planIds], [1, 2]);
  assert.deepStrictEqual([...a.entitlements].sort(), ['mcq', 'mock'], 'two plans add up');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].op, 'findMany');
  assert.deepStrictEqual(Object.keys(calls[0].args).sort(), ['select', 'where']);
  assert.deepStrictEqual(calls[0].args.select, { planId: true, plan: { select: { entitlements: true } } });
  assert.strictEqual(calls[0].args.where.userId, 7);
  assert.strictEqual(calls[0].args.where.courseId, 3);
  assert.strictEqual(calls[0].args.where.isActive, true);

  // A plan with no entitlements recorded is legacy: it opens everything.
  reset([sub(1, ['mcq']), sub(2, [])]);
  assert.strictEqual((await access.getCourseAccess(7, 3)).entitlements, 'all');

  // No course means nothing bought and no subscription query (the flag is
  // still read: full access does not depend on a course).
  for (const none of [null, undefined]) {
    reset([sub(1, [])]);
    const n = await access.getCourseAccess(7, none);
    assert.strictEqual(n.planIds.size, 0);
    assert.strictEqual(n.fullAccess, undefined);
    assert.strictEqual(calls.length, 0, 'no subscription query without a course');
  }

  // ── hasCourseFeature: no free-course exception ──
  reset([]);
  assert.strictEqual(await access.hasCourseFeature(7, 3, 'mock'), false, 'no subscription, no feature');
  reset([sub(1, ['mcq'])]);
  assert.strictEqual(await access.hasCourseFeature(7, 3, 'mock'), false);
  assert.strictEqual(await access.hasCourseFeature(7, 3, 'mcq'), true);
  reset([sub(1, [])]);
  assert.strictEqual(await access.hasCourseFeature(7, 3, 'rapid_recall'), true, "'all' opens every feature");
  reset([sub(1, [])]);
  assert.strictEqual(await access.hasCourseFeature(7, null, 'mock'), false);
  assert.strictEqual(calls.length, 0, 'a non-integer course is refused before any query');

  // Old import path still works and is the same function.
  assert.strictEqual(selected.hasCourseFeature, access.hasCourseFeature);
  assert.strictEqual(selected.accessFrom, access.accessFrom);
  assert.strictEqual(selected.isLessonUnlocked, access.isLessonUnlocked);
  assert.strictEqual(selected.lessonAccess, access.lessonAccess);
  assert.strictEqual(selected.stripLockedContent, access.stripLockedContent);
  assert.strictEqual(selected.courseAccessOf, access.courseAccessOf);
  assert.strictEqual(selected.LESSON_ENTITLEMENT, access.LESSON_ENTITLEMENT);

  // ── getSubscriptionStatus (profile + /users/me/subscription-status) ──
  reset([{ id: 9 }]);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, null, 'premium'),
    { isPremiumCourse: false, hasPaid: false });
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'free'),
    { isPremiumCourse: false, hasPaid: true }, 'a free course counts as paid');
  assert.strictEqual(calls.length, 0, 'free course needs no lookup');

  reset([{ id: 9 }]);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'premium'),
    { isPremiumCourse: true, hasPaid: true, subscription: { id: 9 } });
  assert.deepStrictEqual(Object.keys(calls[0].args), ['where'], 'full row, no select, no ordering');

  reset([]);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'premium'),
    { isPremiumCourse: true, hasPaid: false, subscription: null });

  // ── getLatestActiveSubscription (/users/me/plans) ──
  reset([{ id: 1 }]);
  const select = { id: true };
  await access.getLatestActiveSubscription(7, 3, { now, select });
  assert.deepStrictEqual(calls[0], {
    op: 'findFirst',
    args: { where: access.activeSubscriptionWhere(7, 3, now), select, orderBy: { endDate: 'desc' } },
  });

  // ════════ full access (owner override) ════════

  // ── hasFullAccess truth table ──
  assert.strictEqual(access.hasFullAccess({ fullAccess: true, status: 'verified' }), true);
  assert.strictEqual(access.hasFullAccess({ fullAccess: true, status: 'unverified' }), true);
  assert.strictEqual(access.hasFullAccess({ fullAccess: true }), true, 'status missing is not blocked');
  assert.strictEqual(access.hasFullAccess({ fullAccess: true, status: 'blocked' }), false, 'blocked never has it');
  assert.strictEqual(access.hasFullAccess({ fullAccess: false, status: 'verified' }), false);
  assert.strictEqual(access.hasFullAccess({ status: 'verified' }), false, 'missing column means no');
  assert.strictEqual(access.hasFullAccess({ fullAccess: 'true', status: 'verified' }), false, 'strictly boolean true');
  assert.strictEqual(access.hasFullAccess({ fullAccess: 1 }), false);
  assert.strictEqual(access.hasFullAccess(null), false);
  assert.strictEqual(access.hasFullAccess(undefined), false);

  // ── hasAnyPlan ──
  assert.strictEqual(access.hasAnyPlan(access.fullAccessGrant()), true);
  assert.strictEqual(access.hasAnyPlan(access.accessFrom([])), false);
  assert.strictEqual(access.hasAnyPlan(access.accessFrom([sub(4, ['mcq'])])), true);
  assert.strictEqual(access.hasAnyPlan(new Set([4])), true, 'old Set shape');
  assert.strictEqual(access.hasAnyPlan(null), false);

  const OWNER = { fullAccess: true, status: 'verified' };

  // ── getCourseAccess: flag from the DB, no subscription query ──
  reset([sub(1, ['mcq'])], OWNER);
  const full = await access.getCourseAccess(7, 3);
  assert.strictEqual(full.fullAccess, true);
  assert.strictEqual(full.entitlements, 'all');
  assert.strictEqual(full.planIds.size, 0);
  assert.strictEqual(calls.length, 0, 'full access never queries subscriptions');
  assert.strictEqual(userCalls.length, 1);
  assert.deepStrictEqual(userCalls[0], { where: { id: 7 }, select: { fullAccess: true, status: true } });

  // Null course: still full access.
  reset([], OWNER);
  assert.strictEqual((await access.getCourseAccess(7, null)).fullAccess, true);
  assert.strictEqual(calls.length, 0);

  // Blocked owner: falls through to the normal subscription rule.
  reset([], { fullAccess: true, status: 'blocked' });
  const blocked = await access.getCourseAccess(7, 3);
  assert.strictEqual(blocked.fullAccess, undefined);
  assert.strictEqual(blocked.planIds.size, 0);
  assert.strictEqual(calls.length, 1, 'blocked: subscriptions are looked up as usual');

  // A row the caller already read (with both columns) saves the user query.
  reset([sub(1, ['mcq'])], { fullAccess: false, status: 'verified' });
  assert.strictEqual((await access.getCourseAccess(7, 3, { user: OWNER })).fullAccess, true);
  assert.strictEqual(userCalls.length, 0, 'preloaded row: no user query');
  assert.strictEqual(calls.length, 0);
  // ...but a row missing the columns is not trusted: the DB is asked.
  reset([], OWNER);
  assert.strictEqual((await access.getCourseAccess(7, 3, { user: { selectedCourseId: 3 } })).fullAccess, true);
  assert.strictEqual(userCalls.length, 1);

  // Read from the DB, not the JWT: a token-shaped payload claiming
  // fullAccess opens nothing. Only a row carrying BOTH columns is reused, and
  // here the DB says no.
  reset([], { fullAccess: false, status: 'verified' });
  const jwtPayload = { userId: 7, role: 'student', sessionId: 1, fullAccess: true };
  const viaJwt = await access.getCourseAccess(jwtPayload.userId, 3, { user: jwtPayload });
  assert.strictEqual(viaJwt.fullAccess, undefined, 'a JWT payload (no status) is ignored; the DB decides');
  assert.strictEqual(userCalls.length, 1);
  // The flag turned off in the DB is off on the very next call.
  reset([], OWNER);
  assert.strictEqual((await access.getCourseAccess(7, 3)).fullAccess, true);
  reset([], { fullAccess: false, status: 'verified' });
  assert.strictEqual((await access.getCourseAccess(7, 3)).fullAccess, undefined);

  // ── pure rules with full access ──
  const grant = access.fullAccessGrant();
  const premiumVideo = { type: 'video', accessType: 'premium', isFreePreview: false };
  const pinned = { ...premiumVideo, lessonPlans: [{ planId: 99 }] };
  const premiumQuiz = { type: 'quiz', accessType: 'premium', isFreePreview: false, quizId: 5 };
  for (const lesson of [premiumVideo, pinned, premiumQuiz, { type: 'text', accessType: 'free' }]) {
    assert.strictEqual(access.isLessonUnlocked(lesson, grant, 'premium'), true, 'premium course, any lesson');
    assert.strictEqual(access.isLessonUnlocked(lesson, grant, null), true);
  }
  // Without the grant, the same pinned lesson stays shut to another plan.
  assert.strictEqual(access.isLessonUnlocked(pinned, access.accessFrom([sub(1, [])]), 'premium'), false);

  const mixed = {
    ...premiumVideo, videoUrl: 'v1', noteUrl: 'n', content: 'c', quizId: 5, quiz: { id: 5 },
    lessonPlans: [{ planId: 99 }],
    videos: [
      { id: 1, accessType: 'premium', videoUrl: 'v1' },
      { id: 2, accessType: 'free', videoUrl: 'v2' },
      { id: 3, accessType: 'premium', videoUrl: 'v3' },
    ],
  };
  const gate = access.lessonAccess(mixed, grant, 'premium');
  assert.strictEqual(gate.contentOpen, true);
  assert.strictEqual(gate.firstVideoOpen, true);
  assert.strictEqual(gate.locked, false);
  assert.ok(mixed.videos.every(gate.videoOpen), 'every premium video opens');
  const stripped = access.stripLockedContent(mixed, gate);
  assert.strictEqual(stripped.locked, false);
  assert.strictEqual(stripped.contentLocked, false);
  assert.strictEqual(stripped.videoUrl, 'v1');
  assert.strictEqual(stripped.noteUrl, 'n');
  assert.strictEqual(stripped.content, 'c');
  assert.deepStrictEqual(stripped.quiz, { id: 5 });
  assert.deepStrictEqual(stripped.videos.map((v) => [v.videoUrl, v.locked]),
    [['v1', false], ['v2', false], ['v3', false]], 'nothing stripped');
  // Contrast: no access strips the premium ones.
  const shut = access.stripLockedContent(mixed, access.lessonAccess(mixed, access.accessFrom([]), 'premium'));
  assert.deepStrictEqual(shut.videos.map((v) => v.videoUrl), [null, 'v2', null]);
  assert.strictEqual(shut.noteUrl, null);

  // ── hasCourseFeature with full access, on any course ──
  for (const feature of ['mock', 'rapid_recall', 'mcq', 'video_lecture', 'live_class', 'ai_patient']) {
    reset([], OWNER);
    assert.strictEqual(await access.hasCourseFeature(7, 3, feature), true, feature);
    assert.strictEqual(calls.length, 0, 'no subscription query');
  }
  reset([], OWNER);
  assert.strictEqual(await access.hasCourseFeature(7, null, 'mock'), false, 'still needs a course id');
  assert.strictEqual(userCalls.length, 0);
  reset([], { fullAccess: false, status: 'verified' });
  assert.strictEqual(await access.hasCourseFeature(7, 3, 'mock', { user: OWNER }), true, 'preloaded row');
  assert.strictEqual(userCalls.length, 0);

  // ── getSubscriptionStatus with full access ──
  reset([], OWNER);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'premium'),
    { isPremiumCourse: true, hasPaid: true, subscription: null, fullAccess: true });
  reset([{ id: 9 }], OWNER);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'premium'),
    { isPremiumCourse: true, hasPaid: true, subscription: { id: 9 }, fullAccess: true },
    'a real live row is still reported');
  reset([], OWNER);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'free'),
    { isPremiumCourse: false, hasPaid: true }, 'free course unchanged, no lookup');
  assert.strictEqual(userCalls.length + calls.length, 0);
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, null, 'premium'),
    { isPremiumCourse: false, hasPaid: false }, 'no course selected: unchanged');
  reset([], { fullAccess: true, status: 'blocked' });
  assert.deepStrictEqual(await access.getSubscriptionStatus(7, 3, 'premium'),
    { isPremiumCourse: true, hasPaid: false, subscription: null }, 'blocked: no override');
  reset([], { fullAccess: false, status: 'verified' });
  assert.strictEqual((await access.getSubscriptionStatus(7, 3, 'premium', { user: OWNER })).hasPaid, true);
  assert.strictEqual(userCalls.length, 0);

  console.log('access.test.js: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
