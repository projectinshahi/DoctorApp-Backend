// Pure guard and argument logic of seedTestAccounts.js. No database.
// Run: node scripts/seedTestAccounts.test.js
const assert = require('assert');
const {
  parseArgs, dbHostOf, isLocalHost, checkEnvironment, decideRealDataGuard, redact,
  SEED_EMAILS, DEFAULT_PASSWORD, MAX_FOREIGN_USERS,
} = require('./seedTestAccounts');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const NEON = 'postgresql://user:s3cret@ep-test-123-pooler.c-5.aws.neon.tech/neondb?sslmode=require';

// ── (a) NODE_ENV ──
test('refuses NODE_ENV=production even on localhost', () => {
  const r = checkEnvironment({ nodeEnv: 'production', databaseUrl: 'postgresql://u:p@localhost:5432/x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /production/);
});
test('development / unset NODE_ENV is not refused by (a)', () => {
  assert.strictEqual(checkEnvironment({ nodeEnv: 'development', databaseUrl: 'postgresql://u:p@localhost/x' }).ok, true);
  assert.strictEqual(checkEnvironment({ nodeEnv: undefined, databaseUrl: 'postgresql://u:p@localhost/x' }).ok, true);
});

// ── (b) host ──
test('local and docker-style hosts are allowed', () => {
  for (const url of [
    'postgresql://u:p@localhost:5432/x',
    'postgres://u:p@127.0.0.1/x',
    'postgresql://u:p@[::1]:5432/x',
    'postgresql://u:p@db:5432/x',
    'postgresql://u:p@postgres/x',
    'postgresql://u:p@LOCALHOST/x',
  ]) {
    const r = checkEnvironment({ databaseUrl: url });
    assert.strictEqual(r.ok, true, url);
  }
});
test('remote host refused without SEED_ALLOWED_DB_HOST', () => {
  const r = checkEnvironment({ databaseUrl: NEON });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.host, 'ep-test-123-pooler.c-5.aws.neon.tech');
  assert.match(r.reason, /not set/);
});
test('remote host allowed only on an exact SEED_ALLOWED_DB_HOST match', () => {
  assert.strictEqual(checkEnvironment({ databaseUrl: NEON, allowedHost: 'ep-test-123-pooler.c-5.aws.neon.tech' }).ok, true);
  assert.strictEqual(checkEnvironment({ databaseUrl: NEON, allowedHost: ' EP-TEST-123-pooler.c-5.aws.neon.tech ' }).ok, true);
  // Partial / suffix / different-branch matches do not count.
  for (const allowed of ['neon.tech', 'aws.neon.tech', 'ep-test-123.c-5.aws.neon.tech', 'ep-test-12', '*', '']) {
    assert.strictEqual(checkEnvironment({ databaseUrl: NEON, allowedHost: allowed }).ok, false, allowed);
  }
});
test('SEED_ALLOWED_DB_HOST does not override NODE_ENV=production', () => {
  const r = checkEnvironment({ nodeEnv: 'production', databaseUrl: NEON, allowedHost: 'ep-test-123-pooler.c-5.aws.neon.tech' });
  assert.strictEqual(r.ok, false);
});
test('missing or unparseable DATABASE_URL is refused', () => {
  assert.strictEqual(checkEnvironment({ databaseUrl: undefined }).ok, false);
  assert.strictEqual(checkEnvironment({ databaseUrl: 'not a url' }).ok, false);
  assert.strictEqual(checkEnvironment({ databaseUrl: 'postgresql:///x?host=/var/run/postgresql' }).ok, false);
});
test('tricky hosts are not mistaken for localhost', () => {
  assert.strictEqual(checkEnvironment({ databaseUrl: 'postgresql://localhost:p@evil.example.com/x' }).ok, false);
  assert.strictEqual(checkEnvironment({ databaseUrl: 'postgresql://u:p@localhost.evil.com/x' }).ok, false);
  assert.strictEqual(isLocalHost('db.prod.internal'), false);
  assert.strictEqual(dbHostOf('postgresql://u:p@[::1]:5432/x'), '::1');
});

// ── (d) never print the URL ──
test('reasons contain the host but never the password or full URL', () => {
  const r = checkEnvironment({ databaseUrl: NEON });
  assert.ok(!r.reason.includes('s3cret'));
  assert.ok(!r.reason.includes('postgresql://'));
  const red = redact(`connect failed: ${NEON} and postgres://a:b@c/d`, NEON, 'h');
  assert.ok(!red.includes('s3cret'));
  assert.ok(!red.includes('a:b@c'));
});

// ── (c) real-data check ──
test('real-data guard allows up to the limit and refuses above it', () => {
  assert.strictEqual(decideRealDataGuard(0).ok, true);
  assert.strictEqual(decideRealDataGuard(MAX_FOREIGN_USERS).ok, true);
  assert.strictEqual(decideRealDataGuard(MAX_FOREIGN_USERS + 1).ok, false);
  assert.strictEqual(decideRealDataGuard(500).ok, false);
  assert.strictEqual(decideRealDataGuard(3, 2).ok, false);
  assert.strictEqual(decideRealDataGuard(-1).ok, false);
  assert.strictEqual(decideRealDataGuard(NaN).ok, false);
});

// ── args / password ──
test('password: default, env, --password and --password=', () => {
  assert.deepStrictEqual(parseArgs([], {}), { password: DEFAULT_PASSWORD, passwordSource: 'default' });
  assert.deepStrictEqual(parseArgs([], { SEED_TEST_PASSWORD: 'fromEnv123' }), { password: 'fromEnv123', passwordSource: 'SEED_TEST_PASSWORD' });
  assert.deepStrictEqual(parseArgs(['--password', 'fromArg123'], { SEED_TEST_PASSWORD: 'fromEnv123' }), { password: 'fromArg123', passwordSource: 'argument' });
  assert.deepStrictEqual(parseArgs(['--password=fromArg456'], {}), { password: 'fromArg456', passwordSource: 'argument' });
});
test('bad arguments are errors', () => {
  assert.ok(parseArgs(['--password'], {}).error);
  assert.ok(parseArgs(['--password', 'short'], {}).error);
  assert.ok(parseArgs(['owner@test.local'], {}).error);
  assert.strictEqual(parseArgs(['--help'], {}).help, true);
});
test('seed emails pass the signup email check and are lower-case', () => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // auth.controller.js
  assert.strictEqual(SEED_EMAILS.length, 3);
  for (const e of SEED_EMAILS) {
    assert.ok(EMAIL_RE.test(e), e);
    assert.strictEqual(e, e.trim().toLowerCase());
  }
  assert.ok(DEFAULT_PASSWORD.length >= 8);
});

console.log(`\n${passed} tests passed`);
