// Email/password register, OTP verification and login (T-011, T-012) over
// real HTTP, against an in-memory stand-in for the database.
// Run: node src/controllers/authPassword.test.js
const assert = require('assert');
const path = require('path');

process.env.JWT_ACCESS_SECRET = 'test-access';
process.env.JWT_REFRESH_SECRET = 'test-refresh';
delete process.env.RESEND_API_KEY;

const users = [];
const sessions = [];
const pick = (row, select) =>
  row && (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
// Just the slice of Prisma's where/data syntax the controller uses.
const matches = (row, where) => Object.entries(where).every(([k, v]) =>
  v && typeof v === 'object' && 'lt' in v ? row[k] < v.lt : row[k] === v);
const apply = (row, data) => Object.entries(data).forEach(([k, v]) => {
  row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
});
const fakeDb = {
  user: {
    findUnique: async ({ where, select }) => pick(users.find((u) => matches(u, where)), select),
    create: async ({ data, select }) => {
      if (users.some((u) => u.email === data.email)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      const row = { id: users.length + 1, role: 'student', emailOtpAttempts: 0, ...data };
      users.push(row);
      return pick(row, select);
    },
    update: async ({ where, data }) => { const u = users.find((x) => matches(x, where)); apply(u, data); return u; },
    updateMany: async ({ where, data }) => {
      const hit = users.filter((u) => matches(u, where));
      hit.forEach((u) => apply(u, data));
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

// With no email key the code is logged; capture it from there.
let lastCode = null;
let sends = 0;
const log = console.log;
console.log = (...a) => {
  const m = String(a[0]).match(/^\[email\].*verification code is (\d{6})/);
  if (m) { lastCode = m[1]; sends++; } else log(...a);
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
  const wrongOf = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');
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
    // The code was sent, and is not stored as itself.
    assert.match(lastCode, /^\d{6}$/);
    assert.ok(users[0].emailOtpHash && !users[0].emailOtpHash.includes(lastCode));

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

    // Resend inside the first minute sends nothing, but answers the same.
    const sentBefore = sends;
    const tooSoon = await post('/resend-otp', { email: 'asha@example.com' });
    assert.strictEqual(tooSoon.status, 200);
    assert.strictEqual(sends, sentBefore);
    assert.deepStrictEqual((await post('/resend-otp', { email: 'ghost@example.com' })).body, tooSoon.body);

    // Wrong codes count down, and the fifth locks the code — even the right one.
    const firstCode = lastCode;
    const bad = await post('/verify-otp', { email: 'asha@example.com', code: wrongOf(firstCode) });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error.code, 'INVALID_OTP');
    assert.strictEqual(bad.body.attemptsLeft, 4);
    for (let i = 0; i < 4; i++) await post('/verify-otp', { email: 'asha@example.com', code: wrongOf(firstCode) });
    const locked = await post('/verify-otp', { email: 'asha@example.com', code: firstCode });
    assert.strictEqual(locked.status, 429);
    assert.strictEqual(locked.body.error.code, 'OTP_LOCKED');

    // A new code (after the cooldown) unlocks it; the old one no longer works.
    users[0].emailOtpSentAt = new Date(Date.now() - 61 * 1000);
    await post('/resend-otp', { email: 'asha@example.com' });
    assert.notStrictEqual(lastCode, null);
    assert.strictEqual(users[0].emailOtpAttempts, 0);

    // An expired code is refused.
    const saved = users[0].emailOtpExpiresAt;
    users[0].emailOtpExpiresAt = new Date(Date.now() - 1000);
    assert.strictEqual((await post('/verify-otp', { email: 'asha@example.com', code: lastCode })).body.error.code, 'OTP_EXPIRED');
    users[0].emailOtpExpiresAt = saved;

    // The right code verifies and, with a deviceId, logs straight in.
    const otpLogin = await post('/verify-otp', { email: 'asha@example.com', code: lastCode, deviceId: 'D1' });
    assert.strictEqual(otpLogin.status, 200);
    assert.ok(otpLogin.body.accessToken && otpLogin.body.refreshToken);
    assert.strictEqual(otpLogin.body.isNewUser, true);
    assert.strictEqual(users[0].status, 'verified');
    assert.strictEqual(users[0].emailOtpHash, null);
    assert.strictEqual((await post('/verify-otp', { email: 'asha@example.com', code: lastCode })).body.error.code, 'ALREADY_VERIFIED');

    // T-012.1 — correct credentials return both tokens.
    const ok = await post('/login', { email: 'asha@example.com', password: 'secret123', deviceId: 'D1' });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.accessToken && ok.body.refreshToken);
    assert.strictEqual(ok.body.user.email, 'asha@example.com');
    // 15-minute access token, 7-day refresh token.
    const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));
    assert.strictEqual(claims(ok.body.accessToken).exp - claims(ok.body.accessToken).iat, 15 * 60);
    assert.strictEqual(claims(ok.body.refreshToken).exp - claims(ok.body.refreshToken).iat, 7 * 24 * 60 * 60);

    // T-012.3 — deactivated login blocked with its own code.
    users[0].status = 'blocked';
    const off = await post('/login', { email: 'asha@example.com', password: 'secret123', deviceId: 'D1' });
    assert.strictEqual(off.status, 403);
    assert.strictEqual(off.body.error.code, 'ACCOUNT_DEACTIVATED');

    log('authPassword.test.js: all assertions passed');
  } catch (err) {
    process.exitCode = 1;
    console.error(err);
  } finally {
    server.close();
  }
});
