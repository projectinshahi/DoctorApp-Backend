// Leaderboard ranking. Run: node src/controllers/testAttempt.test.js
const assert = require('assert');
const { rankAttempts } = require('./testAttempt.controller');

const at = (n) => new Date(2026, 0, 1, 0, 0, n);
const row = (userId, score, timeTakenSeconds, submittedAt = at(0)) =>
  ({ userId, score, timeTakenSeconds, submittedAt });

// Score wins outright. Someone who finished in a minute with a worse score
// must not outrank someone who took an hour and scored higher — speed is a
// tiebreak, not a prize for rushing.
const byScore = rankAttempts([row(1, 40, 3600), row(2, 90, 60)]);
assert.deepStrictEqual(byScore.map((r) => r.userId), [2, 1]);
assert.deepStrictEqual(byScore.map((r) => r.rank), [1, 2]);

// Equal scores: the faster one wins.
const byTime = rankAttempts([row(1, 90, 1800), row(2, 90, 900)]);
assert.deepStrictEqual(byTime.map((r) => r.userId), [2, 1]);
assert.deepStrictEqual(byTime.map((r) => r.rank), [1, 2]);

// Equal score AND time: both take the same rank, and the next one skips.
// Competition ranking — printing 3 and 4 would tell one of them they lost to
// somebody they actually tied with.
const tied = rankAttempts([
  row(1, 100, 600), row(2, 90, 600), row(3, 90, 600), row(4, 80, 600),
]);
assert.deepStrictEqual(tied.map((r) => r.rank), [1, 2, 2, 4], 'ties share a rank, next skips');

// Three-way tie skips two places.
assert.deepStrictEqual(
  rankAttempts([row(1, 50, 60), row(2, 50, 60), row(3, 50, 60), row(4, 10, 60)]).map((r) => r.rank),
  [1, 1, 1, 4]);

// Fully tied on score and time: whoever submitted first is listed first, so
// the order is stable rather than whatever the database returned.
const sameEverything = rankAttempts([
  { userId: 1, score: 50, timeTakenSeconds: 60, submittedAt: at(30) },
  { userId: 2, score: 50, timeTakenSeconds: 60, submittedAt: at(10) },
]);
assert.deepStrictEqual(sameEverything.map((r) => r.userId), [2, 1]);
assert.deepStrictEqual(sameEverything.map((r) => r.rank), [1, 1], 'same rank despite an order');

// Negative marking means a leaderboard can go below zero, and must still sort.
assert.deepStrictEqual(
  rankAttempts([row(1, -5, 60), row(2, 0, 60), row(3, -20, 60)]).map((r) => r.userId),
  [2, 1, 3]);

// A single entry and an empty board must not throw.
assert.deepStrictEqual(rankAttempts([row(1, 10, 60)]).map((r) => r.rank), [1]);
assert.deepStrictEqual(rankAttempts([]), []);

// The input array must not be reordered under the caller.
const input = [row(1, 10, 60), row(2, 90, 60)];
rankAttempts(input);
assert.strictEqual(input[0].userId, 1, 'rankAttempts must not mutate its argument');

console.log('testAttempt.test.js: all assertions passed');
