// The shared premium gate for mocks and Rapid Recall.
// Run: node src/controllers/featureGate.test.js
const assert = require('assert');
const { accessFrom } = require('./selected-course.controller');

// hasCourseFeature reads only the subscriptions now — a mock and a Rapid
// Recall deck are paid content wherever they live, so there is no free-course
// escape to test. Its verdict is accessFrom's, exercised here.
const subs = (...entitlementSets) =>
  entitlementSets.map((e, i) => ({ planId: i + 1, plan: { entitlements: e } }));

const can = (access, feature) =>
  access.entitlements === 'all' || access.entitlements.has(feature);

// A plan that sells mocks opens mocks, and nothing it does not sell.
const planA = accessFrom(subs(['mock', 'rapid_recall']));
assert.strictEqual(can(planA, 'mock'), true);
assert.strictEqual(can(planA, 'rapid_recall'), true);
assert.strictEqual(can(planA, 'video_lecture'), false, 'Plan A does not sell videos');
assert.strictEqual(can(planA, 'mcq'), false);

// Two live subscriptions add up rather than one winning.
const both = accessFrom(subs(['mock'], ['video_lecture']));
assert.strictEqual(can(both, 'mock'), true);
assert.strictEqual(can(both, 'video_lecture'), true);

// A plan with nothing declared is a legacy row. It buys everything, not
// nothing — reading an unfilled field as "sells no features" would lock out
// every student on an older plan.
const legacy = accessFrom(subs([]));
assert.strictEqual(legacy.entitlements, 'all');
assert.strictEqual(can(legacy, 'mock'), true);
assert.strictEqual(can(legacy, 'anything_at_all'), true);

// One legacy plan alongside a declared one still opens everything — the
// undeclared plan is the permissive one and it wins.
const mixed = accessFrom(subs(['mcq'], []));
assert.strictEqual(mixed.entitlements, 'all');

// No subscriptions at all.
const none = accessFrom([]);
assert.strictEqual(can(none, 'mock'), false);
assert.strictEqual(none.planIds.size, 0);

// No subscription on a course means no feature, whatever the course's own
// tier says. hasCourseFeature does not read accessType at all — a free course
// with a mock under it is simply unsittable, which is the stated rule.
assert.strictEqual(can(accessFrom([]), 'rapid_recall'), false);

console.log('featureGate.test.js: all assertions passed');
