// Review-screen arithmetic. Run: node src/controllers/quizAttempt.test.js
const assert = require('assert');
const { summarise, reviewedQuestion } = require('./quizAttempt.controller');

const Q = [
  { id: 1, questionText: 'a', questionImageUrl: null, explanation: 'because', marksCorrect: 2, marksIncorrect: -0.5,
    options: [{ id: 10, isCorrect: true }, { id: 11, isCorrect: false }] },
  { id: 2, questionText: 'b', questionImageUrl: null, explanation: null, marksCorrect: 4, marksIncorrect: -1,
    options: [{ id: 20, isCorrect: false }, { id: 21, isCorrect: true }] },
  { id: 3, questionText: 'c', questionImageUrl: null, explanation: null, marksCorrect: 1, marksIncorrect: -1,
    options: [{ id: 30, isCorrect: true }, { id: 31, isCorrect: false }] },
];

// Stored rows, as saveAnswer writes them: one right, one wrong, question 3 has
// no row at all because it was never answered.
const answers = [
  { questionId: 1, selectedOptionId: 10, isCorrect: true, marksAwarded: 2 },
  { questionId: 2, selectedOptionId: 20, isCorrect: false, marksAwarded: -1 },
];

const s = summarise(Q, answers);
assert.strictEqual(s.score, 1, '2 + (-1) + 0');
assert.strictEqual(s.totalMarks, 7, 'the perfect score, not the achieved one');
assert.deepStrictEqual([s.correctCount, s.wrongCount, s.skippedCount], [1, 1, 1]);

// Absence of a row IS the record of a skip, so it must score 0 rather than
// picking up the negative mark.
assert.strictEqual(s.results[2].answered, false);
assert.strictEqual(s.results[2].marksAwarded, 0, 'skipped must not be penalised');
assert.strictEqual(s.results[2].selectedOptionId, null);
assert.strictEqual(s.results[2].correctOptionId, 30, 'the review still reveals the answer');

// The wrong answer carries both ids, so the UI can mark one red and one green.
assert.strictEqual(s.results[1].selectedOptionId, 20);
assert.strictEqual(s.results[1].correctOptionId, 21);
assert.strictEqual(s.results[1].isCorrect, false);

// Explanations survive to the review.
assert.strictEqual(s.results[0].explanation, 'because');

// Every question answered wrongly can push the total below zero.
assert.strictEqual(summarise(Q, [
  { questionId: 1, selectedOptionId: 11, isCorrect: false, marksAwarded: -0.5 },
  { questionId: 2, selectedOptionId: 20, isCorrect: false, marksAwarded: -1 },
  { questionId: 3, selectedOptionId: 31, isCorrect: false, marksAwarded: -1 },
]).score, -2.5);

// An untouched attempt reviews as all-skipped, not as an error.
const none = summarise(Q, []);
assert.deepStrictEqual([none.correctCount, none.wrongCount, none.skippedCount], [0, 0, 3]);
assert.strictEqual(none.score, 0);

// marksAwarded comes from the stored row, not recomputed from the question.
// An admin editing a question later must not rewrite what a student scored.
const stale = reviewedQuestion(Q[0], { questionId: 1, selectedOptionId: 10, isCorrect: true, marksAwarded: 99 });
assert.strictEqual(stale.marksAwarded, 99, 'the stored mark wins');

console.log('quizAttempt.test.js: all assertions passed');
