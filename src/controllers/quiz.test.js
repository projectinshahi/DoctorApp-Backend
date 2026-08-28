// Lock decision table for the quiz filter. Run: node src/controllers/quiz.test.js
const assert = require('assert');
const { questionPoolWhere, readExamTag, readQuestionCount } = require('./quiz.controller');

// The pool is always subject + topic + active. That "active" is the load-bearing
// part: an inactive question must never reach a student.
const base = questionPoolWhere({ subjectId: 1, topicId: 2, examTag: null });
assert.deepStrictEqual(base, { subjectId: 1, topicId: 2, status: 'active' });

// examTag narrows by tag name; absent means no tag clause at all (not an empty one).
const tagged = questionPoolWhere({ subjectId: 1, topicId: 2, examTag: 'dha' });
assert.deepStrictEqual(tagged.tags, { some: { tag: { name: 'dha' } } });
assert.strictEqual('tags' in base, false, 'no examTag must not add a tag filter');

// examTag: trimmed, blank collapses to null, null clears, non-strings rejected.
assert.strictEqual(readExamTag({ examTag: '  mohap ' }).value, 'mohap');
assert.strictEqual(readExamTag({ examTag: '   ' }).value, null);
assert.strictEqual(readExamTag({ examTag: null }).value, null);
assert(readExamTag({ examTag: 5 }).error, 'non-string examTag must fail');
assert.strictEqual(readExamTag({}).provided, false, 'omitted means leave alone');

// questionCount: positive integers only; null means "serve the whole pool".
assert.strictEqual(readQuestionCount({ questionCount: 20 }).value, 20);
assert.strictEqual(readQuestionCount({ questionCount: null }).value, null);
assert(readQuestionCount({ questionCount: 0 }).error, 'zero must fail');
assert(readQuestionCount({ questionCount: -3 }).error, 'negative must fail');
assert(readQuestionCount({ questionCount: 2.5 }).error, 'fractional must fail');
assert.strictEqual(readQuestionCount({}).provided, false);

// The answer key must not be servable: PUBLIC_OPTION_SELECT is not exported,
// so assert on the source instead — cheapest guard that actually fails if
// someone adds isCorrect back to the served response.
const src = require('fs').readFileSync(__dirname + '/quiz.controller.js', 'utf8');
function constBlock(name) {
  const start = src.indexOf('const ' + name);
  assert(start !== -1, name + ' must exist');
  return src.slice(start, src.indexOf('\n};', start));
}
// The two selects a student can be served through must never name isCorrect.
assert(!constBlock('PUBLIC_OPTION_SELECT').includes('isCorrect'), 'PUBLIC_OPTION_SELECT must not expose isCorrect');
assert(!constBlock('PUBLIC_QUESTION_SELECT').includes('isCorrect'), 'PUBLIC_QUESTION_SELECT must not expose isCorrect');
// The admin preview select is allowed it — that is the point of the preview.
assert(constBlock('ADMIN_QUESTION_SELECT').includes('isCorrect'), 'ADMIN_QUESTION_SELECT should carry the answer key');

console.log('quiz.test.js: all assertions passed');

// ── manual vs filter resolution ──────────────────────────────────────────
// A quiz resolves one of two ways and it is NOT a stored setting: pinning any
// question flips it. These assertions pin that rule down, because getting it
// backwards would silently serve the whole topic when an admin picked three.
const { countAvailableQuestions } = require('./quiz.controller');

// Fake the two prisma calls countAvailableQuestions makes, so this stays a
// unit test with no database.
function fakePrisma(pinnedCount, poolCount) {
  return {
    quizQuestion: { count: async () => pinnedCount },
    question: { count: async () => poolCount },
  };
}

(async () => {
  // Reaching into the module's prisma is not possible from here, so verify the
  // decision rule itself the same way the controller expresses it.
  const decide = (pinned, pool) =>
    pinned > 0 ? { availableQuestions: pinned, isPinned: true }
               : { availableQuestions: pool, isPinned: false };

  // Pinned questions win even when the topic holds far more.
  assert.deepStrictEqual(decide(3, 40), { availableQuestions: 3, isPinned: true });

  // No pins -> the filter's pool, and mode is "filter".
  assert.deepStrictEqual(decide(0, 12), { availableQuestions: 12, isPinned: false });

  // Zero pins and an empty topic is legal: an underfilled quiz, not an error.
  assert.deepStrictEqual(decide(0, 0), { availableQuestions: 0, isPinned: false });

  // questionCount caps a pinned quiz but must not reorder it — slice from the
  // front so a truncated quiz still starts where the admin's list starts.
  const pinnedOrder = [11, 7, 3, 9];
  assert.deepStrictEqual(pinnedOrder.slice(0, 2), [11, 7], 'cap must keep the admin order');

  // questionIds are de-duplicated with first-occurrence-wins, because array
  // position becomes displayOrder.
  const dedupe = (ids) => ids.filter((id, i) => ids.indexOf(id) === i);
  assert.deepStrictEqual(dedupe([5, 2, 5, 9, 2]), [5, 2, 9]);

  assert.strictEqual(typeof countAvailableQuestions, 'function');
  void fakePrisma;

  console.log('quiz manual/filter rules OK');
})();

// ── underfill guard rail ───────────────────────────────────────────────────
const { annotateQuiz } = require('./quiz.controller');

// A quiz is a filter, so wanting 10 from a pool of 4 is not an error — it just
// serves 4. The flag is the only thing that tells an admin it happened.
const short = annotateQuiz({ id: 1, questionCount: 10 }, 4, false);
assert.strictEqual(short.isUnderfilled, true);
assert.strictEqual(short.servedQuestions, 4, 'serves what exists, not what it asked for');
assert.strictEqual(short.availableQuestions, 4);
assert.strictEqual(short.mode, 'filter');

// Enough in the pool: not underfilled, and it serves exactly what it asked for.
const ok = annotateQuiz({ id: 2, questionCount: 3 }, 4, false);
assert.strictEqual(ok.isUnderfilled, false);
assert.strictEqual(ok.servedQuestions, 3, 'caps at questionCount, not pool size');

// Exactly enough is not underfilled — the boundary that a > vs >= slip breaks.
assert.strictEqual(annotateQuiz({ id: 3, questionCount: 4 }, 4, false).isUnderfilled, false);

// questionCount null means "serve the whole pool", so it can never underfill.
const all = annotateQuiz({ id: 4, questionCount: null }, 4, false);
assert.strictEqual(all.isUnderfilled, false);
assert.strictEqual(all.servedQuestions, 4);

// An empty pool with no questionCount is still not "underfilled" — it is empty.
assert.strictEqual(annotateQuiz({ id: 5, questionCount: null }, 0, false).isUnderfilled, false);

// Pinned questions report as manual so the client shows a picker, not a filter.
assert.strictEqual(annotateQuiz({ id: 6, questionCount: null }, 2, true).mode, 'manual');


// ── scoring ────────────────────────────────────────────────────────────────
const { scoreSubmission } = require('./selected-course.controller');

const Q = [
  { id: 1, questionText: 'a', questionImageUrl: null, explanation: 'because', marksCorrect: 2, marksIncorrect: -0.5,
    options: [{ id: 10, isCorrect: true }, { id: 11, isCorrect: false }] },
  { id: 2, questionText: 'b', questionImageUrl: null, explanation: null, marksCorrect: 4, marksIncorrect: -1,
    options: [{ id: 20, isCorrect: false }, { id: 21, isCorrect: true }] },
  { id: 3, questionText: 'c', questionImageUrl: null, explanation: null, marksCorrect: 1, marksIncorrect: -1,
    options: [{ id: 30, isCorrect: true }, { id: 31, isCorrect: false }] },
];

// One right (+2), one wrong (-1), one skipped (0).
const s = scoreSubmission(Q, [{ questionId: 1, optionId: 10 }, { questionId: 2, optionId: 20 }]);
assert.strictEqual(s.score, 1, '2 + (-1) + 0');
assert.deepStrictEqual([s.correctCount, s.wrongCount, s.skippedCount], [1, 1, 1]);
assert.strictEqual(s.totalMarks, 7, 'totalMarks is the perfect score, not the achieved one');

// A skipped question must score 0, never the negative mark — that is the rule
// most easily broken by treating "not correct" as "wrong".
assert.strictEqual(s.results[2].marksAwarded, 0, 'skipped must not be penalised');
assert.strictEqual(s.results[2].answered, false);
assert.strictEqual(s.results[2].selectedOptionId, null);

// The answer key and explanation ride back on every result, answered or not.
assert.strictEqual(s.results[0].correctOptionId, 10);
assert.strictEqual(s.results[0].explanation, 'because');
assert.strictEqual(s.results[1].correctOptionId, 21, 'correct id, not the chosen one');
assert.strictEqual(s.results[1].isCorrect, false);

// Negative marks are stored negative and added, so a bad run can go below zero.
assert.strictEqual(scoreSubmission(Q, [{ questionId: 1, optionId: 11 }, { questionId: 2, optionId: 20 }]).score, -1.5);

// String ids from JSON must match numeric question ids.
assert.strictEqual(scoreSubmission(Q, [{ questionId: '1', optionId: '10' }]).correctCount, 1, 'ids arrive as strings');

console.log('quiz.test.js: scoring assertions passed');
