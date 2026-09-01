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
assert.deepStrictEqual(Object.keys(mine.author).sort(), ['avatarUrl', 'id', 'name', 'role']);
assert.strictEqual(mine.author.role, 'student');
assert.strictEqual(mine.isInstructor, false);
assert.strictEqual(mine.canReport, false, 'you cannot report yourself');
assert.strictEqual(theirs.canReport, true);


// ── an instructor's reply is labelled, and is not a target ──

const fromAdmin = {
  id: 4, parentId: 1, body: 'Here is the explanation.',
  userId: null, adminId: 1, createdAt: new Date(), editedAt: null,
  user: null, admin: { id: 1, name: 'Dr SKM' },
};
const answer = shapeComment(fromAdmin, 30, new Set());
assert.strictEqual(answer.isInstructor, true);
assert.strictEqual(answer.author.role, 'admin');
assert.strictEqual(answer.author.name, 'Dr SKM');
// Not the student's own, and not reportable — the queue is for
// student-to-student trouble, and a Report button on the tutor is noise.
assert.strictEqual(answer.isMine, false);
assert.strictEqual(answer.canReport, false);

// A nameless admin still renders. Admin.name is nullable.
assert.strictEqual(
  shapeComment({ ...fromAdmin, admin: { id: 1, name: null } }, 30, new Set()).author.name,
  'Instructor');

// A student whose own id happens to match the admin id must not see it as
// theirs — the author tables are separate and the ids overlap.
assert.strictEqual(shapeComment(fromAdmin, 1, new Set()).isMine, false,
  'a matching id in a different table is not the same person');

console.log('comment.test.js: all assertions passed');
