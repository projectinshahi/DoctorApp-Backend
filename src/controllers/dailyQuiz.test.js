// Daily set selection and streaks. Run: node src/controllers/dailyQuiz.test.js
const assert = require('assert');
const { pickDaily, streakFrom, appToday, shiftDays } = require('./dailyQuiz.controller');

const pool = Array.from({ length: 30 }, (_, i) => i + 1);

// The property the whole feature rests on: the same day gives the same set.
// Without it, pull-to-refresh rerolls the quiz.
assert.deepStrictEqual(
  pickDaily(pool, 22, '2026-09-01'),
  pickDaily(pool, 22, '2026-09-01'),
  'same course and day must give the same questions');

// And a different day gives a different one, which is the "day wise" part.
assert.notDeepStrictEqual(
  pickDaily(pool, 22, '2026-09-01'),
  pickDaily(pool, 22, '2026-09-02'));

// Two courses on the same day must not march in lockstep.
assert.notDeepStrictEqual(
  pickDaily(pool, 22, '2026-09-01'),
  pickDaily(pool, 19, '2026-09-01'));

// The order the database happens to return rows in must not change the set —
// otherwise "deterministic" holds only until a row is updated.
assert.deepStrictEqual(
  pickDaily(pool, 22, '2026-09-01'),
  pickDaily([...pool].reverse(), 22, '2026-09-01'),
  'input order must not matter');
assert.deepStrictEqual(
  pickDaily(pool, 22, '2026-09-01'),
  pickDaily([...pool].sort(() => Math.random() - 0.5), 22, '2026-09-01'));

// Ten distinct questions, all from the pool.
const day = pickDaily(pool, 22, '2026-09-01');
assert.strictEqual(day.length, 10);
assert.strictEqual(new Set(day).size, 10, 'no question twice in one day');
assert(day.every((id) => pool.includes(id)));

// A pool smaller than the daily count serves what exists rather than padding
// or failing — a new course with six questions still has a quiz.
assert.strictEqual(pickDaily([1, 2, 3, 4, 5, 6], 22, '2026-09-01').length, 6);
assert.deepStrictEqual(pickDaily([], 22, '2026-09-01'), []);
assert.deepStrictEqual(pickDaily([7], 22, '2026-09-01'), [7]);

// It must actually shuffle, not just take the first ten in order.
assert.notDeepStrictEqual(pickDaily(pool, 22, '2026-09-01'), pool.slice(0, 10));

// Over a month, the sets should not collapse onto the same handful.
const seen = new Set();
for (let d = 1; d <= 28; d += 1) {
  pickDaily(pool, 22, `2026-09-${String(d).padStart(2, '0')}`).forEach((id) => seen.add(id));
}
assert(seen.size >= 25, `a month of sets should reach most of a 30-question pool, saw ${seen.size}`);


// ── streaks ──

const T = '2026-09-10';

// Today done, and the days before it.
assert.strictEqual(streakFrom([T, '2026-09-09', '2026-09-08'], T), 3);

// Today NOT done yet must not zero a run. At 9am the day is not lost, and
// telling a student their 40-day streak is gone is the bug that kills the
// habit the feature exists to build.
assert.strictEqual(streakFrom(['2026-09-09', '2026-09-08'], T), 2,
  'an unfinished today counts back from yesterday');

// A gap ends it.
assert.strictEqual(streakFrom(['2026-09-09', '2026-09-07'], T), 1);
assert.strictEqual(streakFrom(['2026-09-08', '2026-09-07'], T), 0,
  'missing yesterday with today unfinished is a broken streak');

// Only today.
assert.strictEqual(streakFrom([T], T), 1);
assert.strictEqual(streakFrom([], T), 0);

// Out-of-order input must not matter; the set is what counts.
assert.strictEqual(streakFrom(['2026-09-08', T, '2026-09-09'], T), 3);

// Across a month boundary.
assert.strictEqual(streakFrom(['2026-09-01', '2026-08-31', '2026-08-30'], '2026-09-01'), 3);


// ── date helpers ──

assert.strictEqual(shiftDays('2026-09-01', -1), '2026-08-31');
assert.strictEqual(shiftDays('2026-03-01', -1), '2026-02-28');
assert.strictEqual(shiftDays('2026-12-31', 1), '2027-01-01');

// The day rolls at midnight Gulf time, not UTC. 21:00 UTC is already tomorrow
// in the Gulf, and a student studying late must not be handed yesterday's set.
assert.strictEqual(appToday(new Date('2026-09-01T21:00:00Z')), '2026-09-02');
assert.strictEqual(appToday(new Date('2026-09-01T19:59:00Z')), '2026-09-01');
assert.strictEqual(appToday(new Date('2026-09-01T00:00:00Z')), '2026-09-01');

console.log('dailyQuiz.test.js: all assertions passed');
