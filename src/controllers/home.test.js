// Home-screen percentages. Run: node src/controllers/home.test.js
const assert = require('assert');
const { percent } = require('./home.controller');

// A course with no lessons of a type is 0%, not a crash and not NaN. This is
// the real state of every module card on a fresh course.
assert.strictEqual(percent(0, 0), 0, 'empty module must not divide by zero');
assert.strictEqual(percent(0, 40), 0);
assert.strictEqual(percent(40, 40), 100);

// Rounds to a whole number — a card showing "32.5%" looks broken.
assert.strictEqual(percent(13, 40), 33);
assert.strictEqual(percent(1, 3), 33);
assert.strictEqual(percent(2, 3), 67);

// 100 means finished. Plain rounding would call 199 of 200 "100%", showing a
// completed module with a lesson still left in it.
assert.strictEqual(percent(199, 200), 99, 'must not claim complete while one remains');
assert.strictEqual(percent(999, 1000), 99);
assert.strictEqual(percent(1000, 1000), 100, 'actually finished is still 100');
assert.strictEqual(percent(1, 200), 1, 'one of many is 1%, not 0');

console.log('home.test.js: all assertions passed');
