// Comment shaping and the one-level nesting rule.
// Run: node src/controllers/comment.test.js
const assert = require('assert');
const { shapeComment, threadRootId } = require('./comment.controller');

// ── nesting is one level, always ──

// A reply to a top-level comment attaches to it.
assert.strictEqual(threadRootId({ id: 5, parentId: null }), 5);

// A reply to a REPLY joins the same thread rather than starting a third tier.
// The app sends the id of whatever was tapped, so this is the case that
// actually happens, not an edge case.
assert.strictEqual(threadRootId({ id: 9, parentId: 5 }), 5);

// Depth cannot grow no matter how many times it is applied.
let node = { id: 20, parentId: 5 };
for (let i = 0; i < 5; i++) node = { id: 30 + i, parentId: threadRootId(node) };
assert.strictEqual(threadRootId(node), 5, 'a thread must never nest past one level');


// ── shaping drives the buttons, so it has to be exact ──

const row = {
  id: 1, parentId: null, body: 'Hello', userId: 30,
  createdAt: new Date('2026-09-01'), editedAt: null,
  user: { id: 30, name: 'Keerthana', avatarUrl: null },
};

const mine = shapeComment(row, 30, new Set());
assert.strictEqual(mine.isMine, true, 'the author sees Edit and Delete');
assert.strictEqual(mine.reportedByMe, false);
assert.strictEqual(mine.edited, false, 'never edited must not read as edited');
assert.deepStrictEqual(mine.replies, []);
assert.strictEqual(mine.author.name, 'Keerthana');

// Someone else's comment: Report, never Edit. Getting this backwards would let
// a student edit another student's words.
const theirs = shapeComment(row, 31, new Set());
assert.strictEqual(theirs.isMine, false);

// Already reported by this viewer — the button reads "Reported", not "Report".
assert.strictEqual(shapeComment(row, 31, new Set([1])).reportedByMe, true);
assert.strictEqual(shapeComment(row, 31, new Set([2])).reportedByMe, false,
  'another comment being reported must not mark this one');

// `edited` is derived from editedAt alone, not from updatedAt — a moderator
// hiding and restoring a comment moves updatedAt and must not label it edited.
assert.strictEqual(
  shapeComment({ ...row, editedAt: new Date('2026-09-02') }, 30, new Set()).edited, true);

// The author's email is never shaped in. A student list must not leak it.
assert.strictEqual(mine.author.email, undefined);
assert.deepStrictEqual(Object.keys(mine.author).sort(), ['avatarUrl', 'id', 'name']);

console.log('comment.test.js: all assertions passed');
