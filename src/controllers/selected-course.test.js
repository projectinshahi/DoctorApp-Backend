// Lock decision table for premium lessons. Run: node src/controllers/selected-course.test.js
const assert = require('assert');
const { isLessonUnlocked } = require('./selected-course.controller');

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
