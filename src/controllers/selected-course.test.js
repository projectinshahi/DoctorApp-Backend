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
