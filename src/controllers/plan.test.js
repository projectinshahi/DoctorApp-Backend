// Plan card fields and duration wording. Run: node src/controllers/plan.test.js
const assert = require('assert');
const { readPlanFields, shapePlan, derivedDurationLabel, VALID_ENTITLEMENTS } =
  require('./plan.controller');

const base = { title: 'Plan B', price: 85, durationDays: 45 };

// ── the card as the pricing page sends it ──
const { data } = readPlanFields({
  ...base,
  currency: 'usd',
  features: ['MCQ Bank', 'Mock Test', 'Rapid Recalls'],
  entitlements: ['mcq', 'mock', 'rapid_recall'],
  accentColor: '#E8EDF7',
});
assert.strictEqual(data.title, 'Plan B');
assert.strictEqual(data.price, 85);
assert.strictEqual(data.currency, 'USD', 'currency is normalised to upper case');
assert.deepStrictEqual(data.features, ['MCQ Bank', 'Mock Test', 'Rapid Recalls']);
assert.deepStrictEqual(data.entitlements, ['mcq', 'mock', 'rapid_recall']);
assert.strictEqual(data.accentColor, '#E8EDF7');

// ── the two lists are not interchangeable ──
// Sales copy may say anything; an entitlement is a code the server checks.
// A typo here would sell access to nothing, so it is refused by name.
assert(readPlanFields({ ...base, entitlements: ['mcq', 'vidoe_lecture'] }).error
  .includes('vidoe_lecture'));
assert(readPlanFields({ ...base, entitlements: ['mcq', 'vidoe_lecture'] }).error
  .includes(VALID_ENTITLEMENTS[0]), 'the message lists what is valid');

// Free text in features is fine — "Everything in Plan C" is not a code.
assert.deepStrictEqual(
  readPlanFields({ ...base, features: ['Everything in Plan C', 'Live Classes with Faculty'] }).data.features,
  ['Everything in Plan C', 'Live Classes with Faculty']);

// Case and duplicates in entitlements are normalised, not rejected.
assert.deepStrictEqual(
  readPlanFields({ ...base, entitlements: ['MCQ', 'mcq', ' Mock '] }).data.entitlements,
  ['mcq', 'mock']);

// Blank feature lines are dropped rather than rendering as empty ticks.
assert.deepStrictEqual(readPlanFields({ ...base, features: ['MCQ Bank', '  ', ''] }).data.features,
  ['MCQ Bank']);

// ── required fields ──
assert(readPlanFields({ price: 85, durationDays: 45 }).error.includes('title'));
assert(readPlanFields({ ...base, price: 0 }).error.includes('positive'));
assert(readPlanFields({ ...base, price: -5 }).error.includes('positive'));
assert(readPlanFields({ ...base, durationDays: 0 }).error.includes('positive integer'));
assert(readPlanFields({ ...base, currency: 'dollars' }).error.includes('3-letter'));
assert(readPlanFields({ ...base, accentColor: 'blue' }).error.includes('hex'));
assert.strictEqual(readPlanFields({ ...base, accentColor: null }).data.accentColor, null);

// ── partial, for the editor ──
// Editing a price must not require resending the whole feature list.
const patch = readPlanFields({ price: 95 }, { partial: true });
assert.strictEqual(patch.error, undefined);
assert.deepStrictEqual(Object.keys(patch.data), ['price']);
// But a title sent as empty is still wrong.
assert(readPlanFields({ title: '   ' }, { partial: true }).error.includes('title'));

// ── the duration wording on the card ──
assert.strictEqual(derivedDurationLabel(30), '30 days access');
assert.strictEqual(derivedDurationLabel(45), '45 days access');
assert.strictEqual(derivedDurationLabel(90), '3 months access');
assert.strictEqual(derivedDurationLabel(180), '6 months access');
assert.strictEqual(derivedDurationLabel(365), '1 year access');
assert.strictEqual(derivedDurationLabel(730), '2 years access');
// 60 is two months; 59 has no clean wording and stays in days.
assert.strictEqual(derivedDurationLabel(60), '2 months access');
assert.strictEqual(derivedDurationLabel(59), '59 days access');

// shapePlan always hands the card a label, derived or explicit.
assert.strictEqual(shapePlan({ durationDays: 90, durationLabel: null }).durationLabel,
  '3 months access');
assert.strictEqual(shapePlan({ durationDays: 90, durationLabel: 'One term' }).durationLabel,
  'One term', 'an explicit label wins over the derived one');

console.log('plan.test.js: all assertions passed');
