// Pure argument and guard logic of createTestAdmin.js. No database.
// Run: node scripts/createTestAdmin.test.js
const assert = require('assert');
const bcrypt = require('bcrypt');
const { parseArgs, decideAdminGuard, BCRYPT_COST, MAX_OTHER_ADMINS } = require('./createTestAdmin');
const { checkEnvironment, decideRealDataGuard } = require('./seedTestAccounts');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const NEON = 'postgresql://user:s3cret@ep-test-123-pooler.c-5.aws.neon.tech/neondb?sslmode=require';
const NEON_HOST = 'ep-test-123-pooler.c-5.aws.neon.tech';

// ── arguments ──
test('--help / -h', () => {
  assert.deepStrictEqual(parseArgs(['--help']), { help: true });
  assert.deepStrictEqual(parseArgs(['-h']), { help: true });
});
test('missing or extra arguments -> usage error', () => {
  assert.match(parseArgs([]).error, /Usage/);
  assert.match(parseArgs(['a@b.co']).error, /Usage/);
  assert.match(parseArgs(['a@b.co', 'password1', 'Name', 'extra']).error, /Usage/);
});
test('email is trimmed and lower-cased', () => {
  assert.strictEqual(parseArgs(['  Me@Example.COM ', 'password1']).email, 'me@example.com');
});
test('bad email formats are rejected', () => {
  for (const bad of ['', 'nope', 'a@b', '@b.co', 'a b@c.co', 'a@b.']) {
    assert.ok(parseArgs([bad, 'password1']).error, `should reject ${JSON.stringify(bad)}`);
  }
});
test('password needs 8+ characters', () => {
  assert.match(parseArgs(['a@b.co', '1234567']).error, /at least 8/);
  assert.strictEqual(parseArgs(['a@b.co', '12345678']).password, '12345678');
});
test('password is not trimmed or altered', () => {
  assert.strictEqual(parseArgs(['a@b.co', '  pass word  ']).password, '  pass word  ');
});
test('error text never echoes the password', () => {
  assert.ok(!parseArgs(['bad', 'SuperSecret99']).error.includes('SuperSecret99'));
  assert.ok(!parseArgs(['a@b.co', 'short']).error.includes('short'));
});
test('optional name is trimmed; blank -> undefined', () => {
  assert.strictEqual(parseArgs(['a@b.co', 'password1', ' Test Admin ']).name, 'Test Admin');
  assert.strictEqual(parseArgs(['a@b.co', 'password1', '   ']).name, undefined);
  assert.strictEqual(parseArgs(['a@b.co', 'password1']).name, undefined);
});

// ── hash compatibility with adminLogin (bcrypt.compare) ──
test('hash is bcrypt cost 10 and verifies with bcrypt.compare', () => {
  assert.strictEqual(BCRYPT_COST, 10);
  const hash = bcrypt.hashSync('password1', BCRYPT_COST);
  assert.strictEqual(bcrypt.getRounds(hash), 10);
  assert.ok(bcrypt.compareSync('password1', hash));
});

// ── environment guard (reused from seedTestAccounts) ──
test('refuses NODE_ENV=production', () => {
  assert.strictEqual(checkEnvironment({ nodeEnv: 'production', databaseUrl: 'postgresql://u:p@localhost/x' }).ok, false);
});
test('refuses a remote host without SEED_ALLOWED_DB_HOST, and never shows the URL', () => {
  const r = checkEnvironment({ nodeEnv: 'development', databaseUrl: NEON });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.reason.includes('s3cret'));
});
test('allows a remote host equal to SEED_ALLOWED_DB_HOST', () => {
  assert.strictEqual(checkEnvironment({ nodeEnv: 'development', databaseUrl: NEON, allowedHost: NEON_HOST }).ok, true);
});

// ── data guards ──
test('user guard: 10 non-test users OK, 11 refused', () => {
  assert.strictEqual(decideRealDataGuard(10).ok, true);
  assert.strictEqual(decideRealDataGuard(11).ok, false);
});
test('admin guard: up to 3 other admins OK, 4 refused, bad count refused', () => {
  assert.strictEqual(MAX_OTHER_ADMINS, 3);
  assert.strictEqual(decideAdminGuard(0).ok, true);
  assert.strictEqual(decideAdminGuard(3).ok, true);
  assert.strictEqual(decideAdminGuard(4).ok, false);
  assert.strictEqual(decideAdminGuard(-1).ok, false);
  assert.strictEqual(decideAdminGuard(1.5).ok, false);
});

console.log(`\n${passed} tests passed`);
