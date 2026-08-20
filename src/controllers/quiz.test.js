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
