// Lock decision table for premium lessons. Run: node src/controllers/selected-course.test.js
const assert = require('assert');
const { isLessonUnlocked } = require('./selected-course.controller');

const free = { accessType: 'free', isFreePreview: false, planId: null };
const preview = { accessType: 'premium', isFreePreview: true, planId: 5 };
const anyPlan = { accessType: 'premium', isFreePreview: false, planId: null };
const plan5 = { accessType: 'premium', isFreePreview: false, planId: 5 };

const none = new Set();
const bought5 = new Set([5]);
const bought9 = new Set([9]);

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

// A premium lesson inside a free course still needs payment.
assert(!isLessonUnlocked({ accessType: 'premium', isFreePreview: false, planId: null }, none));

console.log('lesson lock rules OK');
