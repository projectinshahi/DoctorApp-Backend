// Admin student actions: PATCH /admin/students/:id/full-access and
// DELETE /admin/students/:id, plus the shared erase the student's own
// DELETE /api/users/me uses.
// Run: node src/controllers/adminStudentActions.test.js
//
// No database: prisma is swapped for a recorder in require.cache before any
// controller loads, the same way fullAccess.test.js does it.
const assert = require('assert');
const path = require('path');

const log = [];
let handlers = {};
const DEFAULTS = { findMany: [], count: 0, groupBy: [] };
const model = (name) => new Proxy({}, {
  get: (_, op) => async (args) => {
    log.push({ model: name, op, args });
    const h = handlers[`${name}.${op}`];
    if (h) return typeof h === 'function' ? h(args) : h;
    return op in DEFAULTS ? DEFAULTS[op] : null;
  },
});
let transactions = 0;
const fakeDb = new Proxy({}, {
  get: (_, name) => (name === '$transaction'
    ? async (ops) => { transactions += 1; return Promise.all(ops); }
    : model(name)),
});
require.cache[path.resolve(__dirname, '../db.js')] = { exports: fakeDb };

const calls = (m, op) => log.filter((c) => c.model === m && (!op || c.op === op));
const reset = (next = {}) => { log.length = 0; handlers = next; transactions = 0; };

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
async function call(fn, req) {
  const res = fakeRes();
  await fn({ params: {}, query: {}, body: {}, admin: { adminId: 1, role: 'admin' }, ...req }, res);
  return res;
}

const errors = [];
console.error = (...a) => errors.push(a.map(String).join(' '));
console.log = () => {};

const adminStudent = require('./adminStudent.controller');
const profile = require('./profile.controller');

const STUDENT = { id: 7, role: 'student', email: 's@x' };
const UPDATED = (fullAccess) => ({
  id: 7, name: 'S', email: 's@x', phone: null, avatarUrl: null, role: 'student',
  status: 'verified', createdAt: new Date('2026-01-01'), fullAccess,
  sessions: [{ deviceId: 'd1', createdAt: new Date('2026-02-01'), lastSeenAt: new Date('2026-02-02') }],
});

(async () => {
  // ── PATCH /admin/students/:id/full-access ──
  for (const value of [true, false]) {
    reset({ 'user.findUnique': STUDENT, 'user.update': UPDATED(value) });
    const res = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body: { fullAccess: value } });
    assert.strictEqual(res.statusCode, 200, errors.join('\n'));
    const upd = calls('user', 'update')[0].args;
    assert.deepStrictEqual(upd.where, { id: 7 });
    assert.deepStrictEqual(upd.data, { fullAccess: value }, 'only fullAccess is written');
    assert.strictEqual(res.body.student.fullAccess, value);
    // Same keys as the detail endpoint's `student`.
    assert.deepStrictEqual(Object.keys(res.body.student).sort(), [
      'avatarUrl', 'createdAt', 'currentDeviceId', 'email', 'fullAccess', 'id', 'isBlocked',
      'isLoggedIn', 'lastLoginAt', 'lastSeenAt', 'name', 'phone', 'status',
    ]);
    assert.strictEqual(res.body.student.isLoggedIn, true);
    assert.strictEqual(calls('session').length, 0, 'no session is revoked');
  }

  // Detail endpoint's student object matches the toggle's.
  reset({ 'user.findUnique': { ...UPDATED(true), selectedCourseId: null, selectedCourseTypeId: null,
    selectedCourse: null, selectedCourseType: null } });
  let res = await call(adminStudent.getStudentById, { params: { id: '7' } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  reset({ 'user.findUnique': STUDENT, 'user.update': UPDATED(true) });
  const toggled = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body: { fullAccess: true } });
  assert.deepStrictEqual(toggled.body.student, res.body.student, 'toggle returns the detail shape');

  // Non-boolean bodies are rejected before any DB call.
  for (const body of [{}, { fullAccess: 'true' }, { fullAccess: 1 }, { fullAccess: null }, { fullAccess: 0 }]) {
    reset();
    res = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body });
    assert.strictEqual(res.statusCode, 400, `rejects ${JSON.stringify(body)}`);
    assert.ok(res.body.error.message);
    assert.strictEqual(log.length, 0);
  }
  reset();
  res = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body: undefined });
  assert.strictEqual(res.statusCode, 400, 'missing body');

  reset();
  res = await call(adminStudent.updateStudentFullAccess, { params: { id: 'abc' }, body: { fullAccess: true } });
  assert.strictEqual(res.statusCode, 400);

  reset({ 'user.findUnique': null });
  res = await call(adminStudent.updateStudentFullAccess, { params: { id: '99' }, body: { fullAccess: true } });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.error.message, 'Student not found');
  assert.strictEqual(calls('user', 'update').length, 0);

  reset({ 'user.findUnique': { id: 7, role: 'staff' } });
  res = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body: { fullAccess: true } });
  assert.strictEqual(res.statusCode, 404, 'non-student rows are not touched');

  reset({ 'user.findUnique': STUDENT, 'user.update': () => { throw new Error('db down'); } });
  res = await call(adminStudent.updateStudentFullAccess, { params: { id: '7' }, body: { fullAccess: true } });
  assert.strictEqual(res.statusCode, 500);

  // ── DELETE /admin/students/:id ──
  reset({ 'user.findUnique': STUDENT, 'user.delete': { id: 7 } });
  res = await call(adminStudent.deleteStudent, { params: { id: '7' } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.deleted, true);
  assert.strictEqual(res.body.studentId, 7);
  assert.ok(res.body.deletedAt instanceof Date);
  assert.strictEqual(transactions, 1, 'one transaction');
  const ops = log.filter((c) => c.op !== 'findUnique').map((c) => `${c.model}.${c.op}`);
  assert.deepStrictEqual(ops, ['session.deleteMany', 'subscription.deleteMany', 'user.delete'],
    'RESTRICT children first, then the user');
  assert.deepStrictEqual(calls('session', 'deleteMany')[0].args, { where: { userId: 7 } });
  assert.deepStrictEqual(calls('subscription', 'deleteMany')[0].args, { where: { userId: 7 } });
  assert.deepStrictEqual(calls('user', 'delete')[0].args, { where: { id: 7 } });

  reset({ 'user.findUnique': null });
  res = await call(adminStudent.deleteStudent, { params: { id: '99' } });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(transactions, 0);

  reset({ 'user.findUnique': { id: 7, role: 'admin' } });
  res = await call(adminStudent.deleteStudent, { params: { id: '7' } });
  assert.strictEqual(res.statusCode, 404, 'non-student rows are never deleted');
  assert.strictEqual(transactions, 0);

  reset();
  res = await call(adminStudent.deleteStudent, { params: { id: '1.5' } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(log.length, 0);

  reset({ 'user.findUnique': STUDENT, 'user.delete': () => { throw new Error('fk'); } });
  res = await call(adminStudent.deleteStudent, { params: { id: '7' } });
  assert.strictEqual(res.statusCode, 500);

  // ── the student's own delete uses the same erase ──
  reset({ 'user.delete': { id: 7 } });
  res = await call(profile.deleteAccount, { user: { userId: 7 } });
  assert.strictEqual(res.statusCode, 200, errors.join('\n'));
  assert.strictEqual(res.body.deleted, true);
  assert.strictEqual(transactions, 1);
  assert.deepStrictEqual(log.map((c) => `${c.model}.${c.op}`),
    ['session.deleteMany', 'subscription.deleteMany', 'user.delete']);

  process.stdout.write('adminStudentActions.test.js: all passed\n');
})().catch((err) => { process.stderr.write(`${err.stack}\n${errors.join('\n')}\n`); process.exit(1); });
