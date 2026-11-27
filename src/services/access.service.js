// Student access: the one place that answers "may this student open this?".
//
// Two layers live here:
//
//   1. Pure rules (no DB): LESSON_ENTITLEMENT, isLessonUnlocked, lessonAccess,
//      lessonVideoUrl, stripLockedContent, accessFrom, courseAccessOf, hasFullAccess,
//      hasAnyPlan. They decide from an `access` object
//      ({ planIds, entitlements, fullAccess? }) that a caller already has.
//
//   2. DB lookups keyed on userId: getCourseAccess, hasCourseFeature,
//      getSubscriptionStatus, loadFullAccess, find*ActiveSubscription*. Every
//      student-facing "does this student have a live subscription for this
//      course" question goes through these.
//
// Full access (User.fullAccess, the owner's account) is checked FIRST, before
// any subscription: such a user opens everything (premium courses, premium
// lessons, lessons pinned to plans, premium videos, mock tests, Rapid Recall,
// premium questions) with no subscription row at all. The flag is always
// read from the database, never from the JWT, so turning it off takes effect
// on the next request. A blocked user never has full access. Nothing in the
// API can set it; only scripts/grantFullAccess.js does.
//
// "Active" is isActive = true AND endDate >= now. Nothing ever clears
// isActive when a plan runs out, so the endDate test is what expires a row.
//
// Admin and cron queries (admin subscription list, expiry reminders) are NOT
// student access checks and deliberately do not go through here.
//
// selected-course.controller.js re-exports the pure rules and hasCourseFeature
// so older imports keep working.

const prisma = require('../db');

// ── active-subscription predicate ──

/** The where-clause for a student's live subscriptions on one course. */
function activeSubscriptionWhere(userId, courseId, now = new Date()) {
  return { userId, courseId, isActive: true, endDate: { gte: now } };
}

/** The same rule applied to a row already in memory. */
function isSubscriptionActive(sub, now = new Date()) {
  return sub.isActive && sub.endDate >= now;
}

// What accessFrom needs from each row.
const ENTITLEMENT_SELECT = { planId: true, plan: { select: { entitlements: true } } };

/**
 * findMany over a student's live subscriptions on one course. `query` is
 * passed to Prisma as-is (select / include / orderBy); `now` pins the clock
 * when the caller reuses it for something else.
 */
function findActiveSubscriptions(userId, courseId, { now, ...query } = {}) {
  return prisma.subscription.findMany({ where: activeSubscriptionWhere(userId, courseId, now), ...query });
}

/** findFirst over the same rows. No ordering unless the caller asks. */
function findActiveSubscription(userId, courseId, { now, ...query } = {}) {
  return prisma.subscription.findFirst({ where: activeSubscriptionWhere(userId, courseId, now), ...query });
}

/** The live subscription that runs longest — the one /users/me/plans reports. */
function getLatestActiveSubscription(userId, courseId, { now, ...query } = {}) {
  return findActiveSubscription(userId, courseId, { now, ...query, orderBy: { endDate: 'desc' } });
}


// ── full access (owner override) ──

/** The columns hasFullAccess reads. Add these to a user select to reuse it. */
const FULL_ACCESS_SELECT = { fullAccess: true, status: true };

/**
 * Whether this user row opens everything. Strictly `true`: a missing column
 * (an older select, a mocked row) means no. Blocked users never do, though
 * authenticateStudent stops them before any of this runs anyway.
 */
function hasFullAccess(user) {
  return user?.fullAccess === true && user?.status !== 'blocked';
}

/** The access object a full-access user gets: no plans, every entitlement. */
function fullAccessGrant() {
  return { planIds: new Set(), entitlements: 'all', fullAccess: true };
}

/**
 * "Has paid" for an access object: full access, or any live subscription.
 * Use this instead of `access.planIds.size > 0`, because a full-access user
 * has no plan ids.
 */
function hasAnyPlan(access) {
  if (access?.fullAccess === true) return true;
  const planIds = access instanceof Set ? access : access?.planIds;
  return (planIds?.size ?? 0) > 0;
}

/**
 * Reads the flag from the database for this request.
 *
 * `user` is optional: a row the caller has ALREADY read from the database in
 * this request with FULL_ACCESS_SELECT's columns. When both columns are on it
 * the query is skipped. Never pass req.user: that is the JWT payload.
 */
async function loadFullAccess(userId, user = null) {
  if (user && 'fullAccess' in user && 'status' in user) return hasFullAccess(user);
  if (userId === null || userId === undefined) return false;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: FULL_ACCESS_SELECT });
  return hasFullAccess(row);
}


// ── pure rules ──

// Free lessons and free previews are always open. A premium lesson tied to
// plans needs *one of* them; one with no plans accepts any active subscription
// for the course. Exported so the decision table is testable.
/**
 * What a lesson type needs the student to have bought.
 *
 * Straight off the pricing table: Plan B sells the question bank but not the
 * video lectures, so a video needs video_lecture and a quiz needs mcq. Notes
 * are not sold separately and are not listed on any plan, so they need only a
 * subscription.
 */
const LESSON_ENTITLEMENT = { video: 'video_lecture', quiz: 'mcq' };

/**
 * Whether this student may open this lesson.
 *
 * `access` is what they have bought: `{ planIds, entitlements }`.
 *
 * A premium lesson needs a live subscription, and — where the type maps to one
 * — the matching entitlement. That is the whole rule: access follows the
 * feature the plan sells, not a list of lessons attached to a plan.
 *
 * A plan with no entitlements recorded unlocks everything. Most plans are in
 * that state, and treating an empty list as "buys nothing" would lock out
 * every student who has already paid.
 *
 * `courseAccessType` makes a premium COURSE lock its lessons, whatever the
 * lesson says. A free preview still opens either way — it is the only way to
 * sample a paid course.
 */
function isLessonUnlocked(lesson, access, courseAccessType = null) {
  // Full access opens everything: premium course, premium lesson, lessons
  // pinned to plans, premium videos (lessonAccess comes through here too).
  if (access?.fullAccess === true) return true;
  if (lesson.isFreePreview) return true;

  const premium = lesson.accessType === 'premium' || courseAccessType === 'premium';
  if (!premium) return true;

  // Accepts the old Set of plan ids as well as the richer object, so a caller
  // that has not been updated still behaves exactly as it did.
  const planIds = access instanceof Set ? access : (access?.planIds ?? new Set());
  const entitlements = access instanceof Set ? null : (access?.entitlements ?? null);

  if (planIds.size === 0) return false;

  // A lesson pinned to specific plans keeps that rule. No rows exist today,
  // but an admin who sets one means it.
  const pinned = lessonPlanIds(lesson);
  if (pinned.length > 0) return pinned.some((id) => planIds.has(id));

  const needed = LESSON_ENTITLEMENT[lesson.type];
  if (!needed || entitlements === null) return true;
  // null means no plan declared anything — legacy plans unlock everything.
  if (entitlements === 'all') return true;

  return entitlements.has(needed);
}


/**
 * What a student can open inside one lesson.
 *
 * Videos are free or premium one by one, so a lesson can mix free samples
 * with paid classes. A premium video opens to exactly the plans a premium
 * video lesson does: pinned plans if there are any, otherwise any plan that
 * sells video_lecture. The lesson's own accessType / isFreePreview now cover
 * the rest of it — the quiz, the notes, the text.
 *
 * `locked` is true only when nothing inside opens. That is what a padlock on
 * the row has to mean once a lesson can be part free.
 *
 * `lesson.videos` needs `accessType` on each row. A lesson saved through the
 * old single-video fields has no rows; its video follows the lesson, as it
 * always did.
 */
function lessonAccess(lesson, access, courseAccessType = null) {
  const contentOpen = isLessonUnlocked(lesson, access, courseAccessType);
  const paidVideosOpen = isLessonUnlocked(
    { ...lesson, type: 'video', accessType: 'premium', isFreePreview: false }, access, null);
  const videoOpen = (video) => video.accessType === 'free' || paidVideosOpen;

  const videos = lesson.videos ?? [];
  const hasVideo = videos.length > 0 || Boolean(lesson.videoUrl);
  const firstVideoOpen = videos.length > 0 ? videoOpen(videos[0]) : contentOpen;
  const anyVideoOpen = videos.length > 0 ? videos.some(videoOpen) : hasVideo && contentOpen;
  const hasOther = Boolean(lesson.quizId || lesson.noteUrl || lesson.content);

  const locked = hasVideo || hasOther
    ? !(anyVideoOpen || (contentOpen && hasOther))
    : !contentOpen;

  return { contentOpen, firstVideoOpen, videoOpen, locked };
}

/**
 * The lesson-level `videoUrl` a student may receive.
 *
 * A lesson with published video rows plays video 1: the first row's URL when
 * that row opens for this student, otherwise null. The Lesson.videoUrl column
 * is NOT used then. It is meant to mirror video 1, but the admin's lesson
 * update writes it on its own, so it can point at a premium video while
 * video 1 is free; trusting it would hand that premium URL to unpaid
 * students.
 *
 * A lesson with no rows (the old single-video lessons) keeps the column,
 * gated on the lesson exactly as before.
 *
 * `lesson.videos` must be the published rows in displayOrder (the same array
 * `gate` came from) and carry `videoUrl`. A row without it gives null: fail
 * closed rather than fall back to the column.
 */
function lessonVideoUrl(lesson, gate) {
  if (!gate.firstVideoOpen) return null;
  if (Array.isArray(lesson.videos) && lesson.videos.length > 0) {
    return lesson.videos[0].videoUrl ?? null;
  }
  return lesson.videoUrl ?? null;
}

// Applies lessonAccess to a lesson row: locked videos lose their URL, a
// locked quiz / notes / text lose theirs, and the flags the app draws from
// are added. Only keys the row already has are blanked (or, for videoUrl,
// replaced by video 1's: see lessonVideoUrl).
function stripLockedContent(lesson, gate) {
  const out = { ...lesson, locked: gate.locked, contentLocked: !gate.contentOpen };
  if ('videoUrl' in lesson) out.videoUrl = lessonVideoUrl(lesson, gate);
  if (Array.isArray(lesson.videos)) {
    out.videos = lesson.videos.map((v) => (gate.videoOpen(v)
      ? { ...v, locked: false }
      : { ...v, videoUrl: null, locked: true }));
  }
  if (!gate.contentOpen) {
    for (const key of ['noteUrl', 'content', 'quiz']) if (key in lesson) out[key] = null;
  }
  return out;
}


// Reads the selected course's tier for the gate below. Throws on a missing
// relation rather than returning undefined: undefined reads as "not premium",
// which silently unlocks every paid lesson in a premium course.
function courseAccessOf(user) {
  if (!user.selectedCourse) {
    throw new Error('selectedCourse was not selected — the lesson gate would silently unlock premium lessons');
  }
  return user.selectedCourse.accessType;
}


/**
 * Collapses a student's live subscriptions into what they can open.
 *
 * `entitlements` is 'all' when any of their plans records none, because an
 * empty list means "nobody has filled this in yet", not "this plan buys
 * nothing".
 */
function accessFrom(activeSubs) {
  const planIds = new Set(activeSubs.map((s) => s.planId));
  const anyUndeclared = activeSubs.some((s) => (s.plan?.entitlements ?? []).length === 0);
  if (anyUndeclared) return { planIds, entitlements: 'all' };
  return {
    planIds,
    entitlements: new Set(activeSubs.flatMap((s) => s.plan.entitlements)),
  };
}

// Accepts either a shaped lesson (`planIds`) or a raw Prisma row
// (`lessonPlans`), so callers don't all have to flatten first.
function lessonPlanIds(lesson) {
  if (Array.isArray(lesson.planIds)) return lesson.planIds;
  if (Array.isArray(lesson.lessonPlans)) return lesson.lessonPlans.map((lp) => lp.plan?.id ?? lp.planId);
  return [];
}


// ── DB-backed student checks ──

/**
 * What this student has bought on this course: `accessFrom` of their live
 * subscriptions. Use hasAnyPlan(access) for "has paid".
 *
 * A full-access user gets fullAccessGrant() and no subscription query. That
 * holds for a null course too: full access does not depend on a course being
 * selected (there is just nothing course-bound to open without one).
 *
 * Otherwise a null / undefined course (no course selected, or a lesson whose
 * chapter resolves to no course) has nothing to buy: no subscription query.
 *
 * `opts.user`: see loadFullAccess. A DB row that already carries
 * fullAccess + status saves the user query.
 */
async function getCourseAccess(userId, courseId, { user } = {}) {
  if (await loadFullAccess(userId, user)) return fullAccessGrant();
  if (courseId === null || courseId === undefined) return accessFrom([]);
  const activeSubs = await findActiveSubscriptions(userId, courseId, { select: ENTITLEMENT_SELECT });
  return accessFrom(activeSubs);
}

/**
 * Whether this student's live subscriptions open `feature` on this course.
 *
 * Mock tests and Rapid Recall are sold, always. There is deliberately no
 * free-course escape here and no per-item free flag: a paper or a deck is
 * subscription content wherever it lives, which is the rule asked for and the
 * one an admin cannot accidentally undo by leaving a tier unset.
 *
 * The consequence worth knowing: a mock or a deck created under a FREE course
 * can never be opened, because a free course has no plans to buy. Put them
 * under a premium course.
 *
 * Lessons do not come through here — they keep their own free/premium rule in
 * isLessonUnlocked, where a free course is genuinely free.
 *
 * `feature` is a plan entitlement code: mock · rapid_recall · mcq ·
 * video_lecture · live_class · ai_patient.
 */
async function hasCourseFeature(userId, courseId, feature, { user } = {}) {
  // No course, nothing course-bound to open, full access or not.
  if (!Number.isInteger(courseId)) return false;

  const access = await getCourseAccess(userId, courseId, { user });
  // Full access opens every feature, on a free course too.
  if (access.fullAccess === true) return true;
  const { planIds, entitlements } = access;
  if (planIds.size === 0) return false;

  // 'all' is a plan that declared nothing — a legacy row, which buys
  // everything rather than nothing.
  return entitlements === 'all' || entitlements.has(feature);
}

/**
 * The course-level "has paid" flag the profile and /users/me/subscription-status
 * report. Simpler than the lesson gate: a free course counts as paid, a premium
 * one needs any live subscription. Entitlements are not looked at.
 *
 * `subscription` is the full row (no select), whichever one Postgres returns
 * first — there is no ordering, as there never was.
 *
 * Full access on a premium course: hasPaid true, `fullAccess: true` added,
 * `subscription` is their real live row if they happen to have one, else
 * null. A free course is already hasPaid and costs no query, as before. No
 * course selected stays hasPaid false: there is nothing to open yet.
 *
 * `opts.user`: see loadFullAccess.
 */
async function getSubscriptionStatus(userId, selectedCourseId, selectedCourseAccessType, { user } = {}) {
  if (!selectedCourseId) {
    return {
      isPremiumCourse: false,
      hasPaid: false,
    };
  }

  const isPremiumCourse = selectedCourseAccessType === 'premium';

  if (!isPremiumCourse) {
    return {
      isPremiumCourse: false,
      hasPaid: true, // free courses don't need payment
    };
  }

  const [fullAccess, activeSubscription] = await Promise.all([
    loadFullAccess(userId, user),
    findActiveSubscription(userId, selectedCourseId),
  ]);

  if (fullAccess) {
    return {
      isPremiumCourse: true,
      hasPaid: true,
      subscription: activeSubscription ?? null,
      fullAccess: true,
    };
  }

  return {
    isPremiumCourse: true,
    hasPaid: !!activeSubscription,
    subscription: activeSubscription ?? null,
  };
}

module.exports = {
  // predicate + raw lookups
  activeSubscriptionWhere,
  isSubscriptionActive,
  findActiveSubscriptions,
  findActiveSubscription,
  getLatestActiveSubscription,
  // full access
  FULL_ACCESS_SELECT,
  hasFullAccess,
  fullAccessGrant,
  hasAnyPlan,
  loadFullAccess,
  // pure rules
  LESSON_ENTITLEMENT,
  isLessonUnlocked,
  lessonAccess,
  lessonVideoUrl,
  stripLockedContent,
  courseAccessOf,
  accessFrom,
  // student checks
  getCourseAccess,
  hasCourseFeature,
  getSubscriptionStatus,
};
