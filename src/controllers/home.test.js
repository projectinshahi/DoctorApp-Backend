// Home-screen percentages. Run: node src/controllers/home.test.js
const assert = require('assert');
const { percent, watchedState, COMPLETION_THRESHOLD } = require('./home.controller');

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


// ── the watched threshold ──

assert.strictEqual(COMPLETION_THRESHOLD, 0.9);

// 90% is watched. Credits are not the lesson, and demanding 100% leaves ticks
// permanently unearned and teaches people to scrub to the end.
assert.strictEqual(watchedState(90, 100).completed, true);
assert.strictEqual(watchedState(89, 100).completed, false);
assert.strictEqual(watchedState(100, 100).completed, true);

// The same position means different things in a short clip and a long one —
// which is exactly what a bare lastPositionSeconds cannot express.
assert.strictEqual(watchedState(300, 310).completed, true);
assert.strictEqual(watchedState(300, 3600).completed, false);

assert.strictEqual(watchedState(45, 100).watchedPercent, 45);

// Players routinely report a position past the end. 103% must not reach the UI.
assert.strictEqual(watchedState(105, 100).watchedPercent, 100);
assert.strictEqual(watchedState(105, 100).completed, true);

// No duration is "cannot tell", not "not finished". Returning false here would
// clear a tick the student had already earned.
assert.deepStrictEqual(watchedState(50, null), { completed: null, watchedPercent: null });
assert.deepStrictEqual(watchedState(50, 0), { completed: null, watchedPercent: null });
assert.deepStrictEqual(watchedState(50, undefined), { completed: null, watchedPercent: null });
assert.deepStrictEqual(watchedState(null, 100), { completed: null, watchedPercent: null });

// A fresh video is 0%, not null — the bar renders empty rather than vanishing.
assert.strictEqual(watchedState(0, 100).watchedPercent, 0);
assert.strictEqual(watchedState(0, 100).completed, false);

console.log('home.test.js: all assertions passed');
