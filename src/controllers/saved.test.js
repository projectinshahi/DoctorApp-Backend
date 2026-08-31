// The bookmark answer-key gate. Run: node src/controllers/saved.test.js
const assert = require('assert');
const { shapeSavedQuestion } = require('./saved.controller');

const row = {
  savedAt: new Date('2026-08-28T10:00:00Z'),
  question: {
    id: 17,
    questionText: 'Most common cause of secondary amenorrhea?',
    questionImageUrl: null,
    difficulty: 'medium',
    marksCorrect: 2,
    marksIncorrect: -0.5,
    explanation: 'Pregnancy must always be excluded first.',
    status: 'active',
    subject: { id: 8, name: 'OBGYN' },
    topic: { id: 12, name: 'Gynaecology' },
    options: [
      { id: 276, optionText: 'Pregnancy', optionImageUrl: null, displayOrder: 0, isCorrect: true },
      { id: 277, optionText: 'Menopause', optionImageUrl: null, displayOrder: 1, isCorrect: false },
    ],
  },
};

// NOT earned: saved from a quiz the student never finished. Every route to the
// answer must be closed, not just the obvious one — a client reading
// options[].isCorrect would otherwise leak it just as effectively.
const hidden = shapeSavedQuestion(row, new Set());
assert.strictEqual(hidden.revealed, false);
assert.strictEqual(hidden.correctOptionId, null, 'correctOptionId must be null when unearned');
assert.strictEqual(hidden.explanation, null, 'explanation must be null when unearned');
assert.deepStrictEqual(hidden.options.map((o) => o.isCorrect), [null, null],
  'per-option isCorrect is the second way out and must be closed too');

// The question itself still renders — a bookmark is useless without it.
assert.strictEqual(hidden.questionText, 'Most common cause of secondary amenorrhea?');
assert.deepStrictEqual(hidden.options.map((o) => o.optionText), ['Pregnancy', 'Menopause']);
assert.strictEqual(hidden.marksIncorrect, -0.5);

// Earned: answered in a completed attempt, so the answer is theirs to see.
const shown = shapeSavedQuestion(row, new Set([17]));
assert.strictEqual(shown.revealed, true);
assert.strictEqual(shown.correctOptionId, 276);
assert.strictEqual(shown.explanation, 'Pregnancy must always be excluded first.');
assert.deepStrictEqual(shown.options.map((o) => o.isCorrect), [true, false]);

// A different question being earned must not unlock this one.
assert.strictEqual(shapeSavedQuestion(row, new Set([99])).revealed, false);

// ── the type filter ─────────────────────────────────────────────────────────
const { readLessonType } = require('./saved.controller');

// Absent, empty and "all" all mean no filter — the three ways a client says
// "everything", and rejecting any of them would break the default tab.
assert.strictEqual(readLessonType(undefined).value, null);
assert.strictEqual(readLessonType('').value, null);
assert.strictEqual(readLessonType('all').value, null);

assert.strictEqual(readLessonType('video').value, 'video');
assert.strictEqual(readLessonType('quiz').value, 'quiz');

// 'text' is the note type. 'note' is the plausible-looking value that matches
// nothing, and it has already zeroed one card in this codebase — so it must be
// a 400, never a silently empty list.
assert.strictEqual(readLessonType('text').value, 'text');
assert(readLessonType('note').error, "'note' is not a lesson type and must be rejected");

assert(readLessonType('video ').error, 'untrimmed input must not pass');
assert(readLessonType('VIDEO').error, 'the enum is lowercase');
assert(readLessonType('anything').error);

console.log('saved.test.js: all assertions passed');
