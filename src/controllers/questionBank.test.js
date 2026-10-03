// Lock decision table for question options/tags. Run: node src/controllers/questionBank.test.js
const assert = require('assert');
const { readOptions, readTagNames, shapeQuestion } = require('./questionBank.controller');

const opt = (text, isCorrect) => ({ optionText: text, isCorrect });
/** n options, the first correct — the shape most of these assertions want. */
const set = (n) => Array.from({ length: n }, (_, i) => opt(`o${i}`, i === 0));

// Exactly one correct answer — 0 or 2+ is rejected.
assert(readOptions({ options: set(4).map((o) => ({ ...o, isCorrect: false })) }).error,
  'zero correct must fail');
assert(readOptions({ options: set(4).map((o) => ({ ...o, isCorrect: true })) }).error,
  'four correct must fail');
assert(!readOptions({ options: set(4) }).error);

// 4 to 6 options, matching test questions — a student sees both banks, and a
// two-option question is a true/false in a bank built for MCQs.
assert(readOptions({ options: set(1) }).error, 'one option must fail');
assert(readOptions({ options: set(2) }).error, 'two options must fail');
assert(readOptions({ options: set(3) }).error, 'three options must fail');
assert(!readOptions({ options: set(4) }).error);
assert(!readOptions({ options: set(5) }).error);
assert(!readOptions({ options: set(6) }).error);
assert(readOptions({ options: set(7) }).error, 'seven options must fail');

// Blank option text is not an option — and padding to four with blanks is the
// obvious way round the minimum, so it has to fail on the text, not the count.
assert(readOptions({ options: [opt('   ', true), ...set(3).slice(1)] }).error);
assert(readOptions({ options: [opt('a', true), opt('b', false), opt('c', false), opt('  ', false)] }).error);

// Omitting options entirely is "leave them alone", not an error.
assert.strictEqual(readOptions({}).provided, false);
assert.strictEqual(readOptions({}).error, undefined);

// displayOrder defaults to array position, text is trimmed.
const parsed = readOptions({ options: [opt(' a ', true), ...set(4).slice(1)] }).options;
assert.deepStrictEqual(parsed.map((o) => o.displayOrder), [0, 1, 2, 3]);
assert.strictEqual(parsed[0].optionText, 'a');

// Tags: dedup, trim, null clears, non-strings rejected.
assert.deepStrictEqual(readTagNames({ tags: [' neet ', 'neet', 'aiims'] }).names, ['neet', 'aiims']);
assert.deepStrictEqual(readTagNames({ tags: null }), { provided: true, names: [] });
assert.strictEqual(readTagNames({}).provided, false);
assert(readTagNames({ tags: [1] }).error);

// shapeQuestion flattens the join rows and surfaces the correct option id.
const shaped = shapeQuestion({
  id: 1,
  options: [{ id: 10, isCorrect: false }, { id: 11, isCorrect: true }],
  tags: [{ tag: { id: 3, name: 'neet' } }],
});
assert.deepStrictEqual(shaped.tags, [{ id: 3, name: 'neet' }]);
assert.deepStrictEqual(shaped.tagIds, [3]);
assert.deepStrictEqual(shaped.tagNames, ['neet']);
assert.strictEqual(shaped.correctOptionId, 11);
assert.strictEqual(shapeQuestion({ id: 2, options: [], tags: [] }).correctOptionId, null);

console.log('questionBank: all checks passed');

// ── quiz usage: the reverse of quiz.controller's questionPoolWhere ──
// A Quiz stores a filter, so "is this question used" means "does any quiz's
// filter match it". These two directions must agree or deleteQuestion reports
// the wrong blast radius.
const { quizzesMatchingQuestionWhere } = require('./questionBank.controller');
const { questionPoolWhere } = require('./quiz.controller');

const q = { subjectId: 1, topicId: 2, tagNames: ['dha', 'doh'] };

// An untagged quiz owns the whole topic, so it matches regardless of tags.
const w = quizzesMatchingQuestionWhere(q);
assert.strictEqual(w.subjectId, 1);
assert.strictEqual(w.topicId, 2);
assert.deepStrictEqual(w.OR, [{ examTag: null }, { examTag: { in: ['dha', 'doh'] } }]);

// A question with no tags is still claimed by untagged quizzes, never by tagged ones.
assert.deepStrictEqual(
  quizzesMatchingQuestionWhere({ subjectId: 1, topicId: 2 }).OR,
  [{ examTag: null }, { examTag: { in: [] } }],
);

// Both directions agree on subject+topic — the axis a mismatch would break first.
const forward = questionPoolWhere({ subjectId: 1, topicId: 2, examTag: 'dha' });
assert.strictEqual(forward.subjectId, w.subjectId);
assert.strictEqual(forward.topicId, w.topicId);

// The forward filter narrows by tag; the reverse must accept that same tag.
assert.deepStrictEqual(forward.tags, { some: { tag: { name: 'dha' } } });
assert(w.OR[1].examTag.in.includes('dha'), 'reverse must match a quiz tagged dha');

console.log('questionBank.test.js OK');
