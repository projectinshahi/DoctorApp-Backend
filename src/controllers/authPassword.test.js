// Email/password register, verify and login (T-011, T-012) over real HTTP,
// against an in-memory stand-in for the database.
// Run: node src/controllers/authPassword.test.js
const assert = require('assert');
const path = require('path');

process.env.JWT_ACCESS_SECRET = 'test-access';
process.env.JWT_REFRESH_SECRET = 'test-refresh';
delete process.env.BREVO_API_KEY;

const users = [];
const sessions = [];
const pick = (row, select) =>
  row && select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
const fakeDb = {
  user: {
    findUnique: async ({ where, select }) =>
      pick(users.find((u) => (where.email ? u.email === where.email : u.id === where.id)), select),
    create: async ({ data, select }) => {
      if (users.some((u) => u.email === data.email)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      const row = { id: users.length + 1, role: 'student', ...data };
      users.push(row);
      return pick(row, select);
    },
    updateMany: async ({ where, data }) => {
      const hit = users.filter((u) => u.id === where.id && u.status === where.status);
      hit.forEach((u) => Object.assign(u, data));
      return { count: hit.length };
    },
  },
  session: {
    findFirst: async () => null,
    create: async ({ data }) => { const s = { id: sessions.length + 1, ...data }; sessions.push(s); return s; },
    update: async ({ where, data }) => Object.assign(sessions.find((s) => s.id === where.id), data),
    updateMany: async () => ({ count: 0 }),
  },
};
require.cache[path.resolve(__dirname, '../db.js')] = { exports: fakeDb };

// The verification link is logged when no email key is set; capture it.
let lastLink = null;
const log = console.log;
console.log = (...a) => {
  const m = String(a[0]).match(/https?:\/\/\S+verify-email\?token=[^"\s]+/);
  if (m) lastLink = m[0]; else log(...a);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth.routes'));

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/api/auth`;
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    // Validation.
    assert.strictEqual((await post('/register', { email: 'nope', password: 'longenough' })).status, 400);
    assert.strictEqual((await post('/register', { email: 'a@b.co', password: 'short' })).status, 400);

    // T-011.3 — created unverified. T-011.2 — no password in the reply, only a hash stored.
    const reg = await post('/register', { email: ' Asha@Example.com ', password: 'secret123', name: 'Asha' });
    assert.strictEqual(reg.status, 201);
    assert.strictEqual(reg.body.user.status, 'unverified');
    assert.strictEqual(reg.body.user.email, 'asha@example.com');
    assert.ok(!JSON.stringify(reg.body).includes('secret123'));
    assert.ok(!('password' in reg.body.user));
    assert.ok(users[0].password.startsWith('$2') && users[0].password !== 'secret123');
    assert.ok(lastLink, 'verification link was produced');

    // T-011.1 — duplicate rejected, in any letter case, and no second row.
    const dup = await post('/register', { email: 'ASHA@example.com', password: 'another123' });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.error.code, 'EMAIL_TAKEN');
    assert.strictEqual(users.length, 1);

    // T-012.2 — unverified login blocked with its own code.
    const early = await post('/login', { email: 'asha@example.com', password: 'secret123', deviceId: 'D1' });
    assert.strictEqual(early.status, 403);
    assert.strictEqual(early.body.error.code, 'EMAIL_NOT_VERIFIED');

    // Wrong password and unknown email look the same.
    const wrong = await post('/login', { email: 'asha@example.com', password: 'wrongpass', deviceId: 'D1' });
    const ghost = await post('/login', { email: 'ghost@example.com', password: 'wrongpass', deviceId: 'D1' });
    assert.strictEqual(wrong.status, 401);
    assert.deepStrictEqual(wrong.body, ghost.body);

    // A forged token is refused; the real link verifies.
    assert.strictEqual((await fetch(`${base}/verify-email?token=forged`)).status, 400);
    const verified = await fetch(lastLink.replace(/^https?:\/\/[^/]+\/api\/auth/, base));
    assert.strictEqual(verified.status, 200);
    assert.strictEqual(users[0].status, 'verified');

    // T-012.1 — correct credentials return both tokens.
    const ok = await post('/login', { email: 'asha@example.com', password: 'secret123', deviceId: 'D1' });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.accessToken && ok.body.refreshToken);
    assert.strictEqual(ok.body.user.email, 'asha@example.com');
    // 15-minute access token.
    const { exp, iat } = JSON.parse(Buffer.from(ok.body.accessToken.split('.')[1], 'base64url'));
    assert.strictEqual(exp - iat, 15 * 60);

    // T-012.3 — deactivated login blocked with its own code.
    users[0].status = 'blocked';
    const off = await post('/login', { email: 'asha@example.com', password: 'secret123', deviceId: 'D1' });
    assert.strictEqual(off.status, 403);
    assert.strictEqual(off.body.error.code, 'ACCOUNT_DEACTIVATED');

    // An old verification link does not unblock it.
    await fetch(lastLink.replace(/^https?:\/\/[^/]+\/api\/auth/, base));
    assert.strictEqual(users[0].status, 'blocked');

    log('authPassword.test.js: all assertions passed');
  } catch (err) {
    process.exitCode = 1;
    console.error(err);
  } finally {
    server.close();
  }
});
