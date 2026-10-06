// Lock decision table for premium lessons. Run: node src/controllers/selected-course.test.js
const assert = require('assert');
const { accessFrom, isLessonUnlocked } = require('./selected-course.controller');

const free = { accessType: 'free', isFreePreview: false, planIds: [] };
const preview = { accessType: 'premium', isFreePreview: true, planIds: [5] };
const anyPlan = { accessType: 'premium', isFreePreview: false, planIds: [] };
const plan5 = { accessType: 'premium', isFreePreview: false, planIds: [5] };
const plan5or9 = { accessType: 'premium', isFreePreview: false, planIds: [5, 9] };
// Raw Prisma shape, before the controller flattens it.
const rawPlan5 = { accessType: 'premium', isFreePreview: false, lessonPlans: [{ plan: { id: 5 } }] };

const none = new Set();
const bought5 = new Set([5]);
const bought9 = new Set([9]);
const bought7 = new Set([7]);

// Free content is never gated.
assert(isLessonUnlocked(free, none));
assert(isLessonUnlocked(preview, none), 'free preview must open without payment');

// Premium, no specific plan: any active subscription is enough.
assert(!isLessonUnlocked(anyPlan, none));
assert(isLessonUnlocked(anyPlan, bought9));

// Premium tied to plan 5: only plan 5 unlocks it.
assert(!isLessonUnlocked(plan5, none));
assert(!isLessonUnlocked(plan5, bought9), 'wrong plan must not unlock a plan-gated lesson');
assert(isLessonUnlocked(plan5, bought5));

// Tied to several plans: any one of them is enough, none of the others are.
assert(isLessonUnlocked(plan5or9, bought5));
assert(isLessonUnlocked(plan5or9, bought9), 'the second plan must unlock it too');
assert(!isLessonUnlocked(plan5or9, bought7), 'an unrelated plan must not unlock it');
assert(!isLessonUnlocked(plan5or9, none));

// The raw join rows work without flattening first.
assert(isLessonUnlocked(rawPlan5, bought5));
assert(!isLessonUnlocked(rawPlan5, bought9));

// A premium lesson inside a free course still needs payment.
assert(!isLessonUnlocked({ accessType: 'premium', isFreePreview: false, planIds: [] }, none));


// ── a premium COURSE locks its lessons ──
//
// Before this, marking a course premium changed a banner and nothing else:
// every lesson had to be marked premium by hand, and one missed lesson gave
// the whole course away.
const plainLesson = { accessType: 'free', isFreePreview: false, planIds: [] };

assert(isLessonUnlocked(plainLesson, none, 'free'),
  'a free lesson in a free course opens');
assert(!isLessonUnlocked(plainLesson, none, 'premium'),
  'the same lesson in a premium course is locked');
assert(isLessonUnlocked(plainLesson, bought9, 'premium'),
  'and opens once anything is bought for that course');

// A free preview is the only way to sample a paid course, so it opens
// whatever the course says.
assert(isLessonUnlocked({ accessType: 'free', isFreePreview: true, planIds: [] }, none, 'premium'),
  'a free preview must open inside a premium course');
assert(isLessonUnlocked({ accessType: 'premium', isFreePreview: true, planIds: [] }, none, 'premium'),
  'a premium lesson flagged as preview still opens');

// A plan-gated lesson keeps its own rule inside a premium course — the course
// widens what is locked, it does not widen what unlocks it.
assert(!isLessonUnlocked(plan5, bought9, 'premium'),
  'the wrong plan still fails inside a premium course');
assert(isLessonUnlocked(plan5, bought5, 'premium'));

// Omitting the course argument behaves exactly as before, so every caller
// that has not been updated is unaffected rather than silently locking.
assert(isLessonUnlocked(plainLesson, none));
assert(isLessonUnlocked(plainLesson, none, null));
assert(isLessonUnlocked(plainLesson, none, undefined));


// ── a premium lesson follows the FEATURE the plan sells ──
//
// Straight off the pricing table: Plan B buys the question bank but not the
// video lectures, so the same subscription opens a quiz and not a video.
const planB = accessFrom([{ planId: 15, plan: { entitlements: ['mcq', 'mock', 'rapid_recall'] } }]);
const planC = accessFrom([{ planId: 16, plan: { entitlements: ['mcq', 'mock', 'rapid_recall', 'video_lecture'] } }]);

const premiumVideo = { type: 'video', accessType: 'premium', isFreePreview: false, planIds: [] };
const premiumQuiz  = { type: 'quiz',  accessType: 'premium', isFreePreview: false, planIds: [] };
const premiumNote  = { type: 'text',  accessType: 'premium', isFreePreview: false, planIds: [] };

assert(!isLessonUnlocked(premiumVideo, planB), 'Plan B does not buy video lectures');
assert(isLessonUnlocked(premiumQuiz, planB), 'Plan B does buy the question bank');
assert(isLessonUnlocked(premiumVideo, planC), 'Plan C adds video lectures');

// Notes are on no plan, so any live subscription opens them.
assert(isLessonUnlocked(premiumNote, planB));

// No subscription at all opens nothing premium, whatever the plan would buy.
const nothing = accessFrom([]);
assert(!isLessonUnlocked(premiumQuiz, nothing));
assert(!isLessonUnlocked(premiumVideo, nothing));
assert(isLessonUnlocked({ ...premiumVideo, isFreePreview: true }, nothing), 'a preview still opens');

// A plan with no entitlements recorded unlocks everything. Most plans are in
// that state, and reading an empty list as "buys nothing" would lock out every
// student who has already paid.
const legacy = accessFrom([{ planId: 6, plan: { entitlements: [] } }]);
assert(isLessonUnlocked(premiumVideo, legacy), 'a legacy plan must not lock a paying student out');
assert(isLessonUnlocked(premiumQuiz, legacy));

// One legacy plan alongside a declared one still unlocks everything — the
// student paid for something nobody has described yet.
const mixed = accessFrom([
  { planId: 15, plan: { entitlements: ['mcq'] } },
  { planId: 6, plan: { entitlements: [] } },
]);
assert(isLessonUnlocked(premiumVideo, mixed));

// A lesson pinned to specific plans keeps its own rule.
const pinnedToC = { type: 'video', accessType: 'premium', isFreePreview: false, planIds: [16] };
assert(!isLessonUnlocked(pinnedToC, planB), 'the wrong plan still fails');
assert(isLessonUnlocked(pinnedToC, planC));

console.log('lesson lock rules OK');

// --- Progress rollup -------------------------------------------------------
const { lessonDone } = require('./selected-course.controller');

const video = { type: 'video' };
const quiz = { type: 'quiz' };

// A normal lesson is done only when the student marked it so. A resume point
// on its own is "started", never "finished".
assert(!lessonDone(video, undefined, null), 'no row is not done');
assert(!lessonDone(video, { completed: false, lastPositionSeconds: 900 }, null), 'watched != done');
assert(lessonDone(video, { completed: true }, null));

// A quiz lesson has no lesson_progress row at all — a submitted attempt is the
// only thing that finishes it, so an open attempt must not count.
assert(!lessonDone(quiz, undefined, null), 'unattempted quiz is not done');
assert(!lessonDone(quiz, undefined, { completed: false }), 'open attempt is not done');
assert(lessonDone(quiz, undefined, { completed: true }));
// A stray progress row on a quiz must not fake a pass without an attempt.
assert(!lessonDone(quiz, { completed: true }, null), 'quiz needs an attempt, not a flag');

console.log('progress rollup OK');

// --- a missing selectedCourse select must crash, not silently unlock -------
// This is the bug that shipped: getStudentLesson passed the course tier to the
// gate but never selected it, so `undefined` read as "not premium" and the
// detail endpoint handed a premium course's free lessons over with their
// videoUrl to students who had paid nothing.
const { courseAccessOf } = require('./selected-course.controller');

assert.throws(
  () => courseAccessOf({ selectedCourseId: 22, selectedCourseTypeId: 36 }),
  /selectedCourse was not selected/,
  'forgetting the selectedCourse select must throw, not return undefined',
);
assert.strictEqual(courseAccessOf({ selectedCourse: { accessType: 'premium' } }), 'premium');
assert.strictEqual(courseAccessOf({ selectedCourse: { accessType: 'free' } }), 'free');
