// Pure argument, decision and redaction logic of createFirstAdmin.js, plus the
// main() paths that stop before any database connection. No database.
// Run: node scripts/createFirstAdmin.test.js
const assert = require('assert');
const bcrypt = require('bcrypt');
const {
  parseArgs, parseDbTarget, checkConfirmHost, decideAction, isNotMigratedError, redact, main,
  BCRYPT_COST, MIN_PASSWORD_LENGTH, PASSWORD_ENV,
} = require('./createFirstAdmin');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const PW = 'S3cret!Pass$word';
const HOST = 'ep-prod-123-pooler.c-5.aws.neon.tech';
const URL_ = `postgresql://owner:dbP4ssw0rd@${HOST}/proddb?sslmode=require`;
const base = (extra = []) => ['admin@example.com', PW, '--confirm-host', HOST, ...extra];

// ── arguments ──
test('--help / -h anywhere', () => {
  assert.deepStrictEqual(parseArgs(['--help']), { help: true });
  assert.deepStrictEqual(parseArgs(['-h']), { help: true });
  assert.deepStrictEqual(parseArgs(['a@b.co', '--help']), { help: true });
});
test('valid arguments', () => {
  assert.deepStrictEqual(parseArgs(base()), {
    email: 'admin@example.com', password: PW, passwordSource: 'argument', reset: false, confirmHost: HOST,
  });
  assert.strictEqual(parseArgs(base(['--reset'])).reset, true);
  assert.strictEqual(parseArgs(['--reset', '--confirm-host', HOST, 'admin@example.com', PW]).reset, true);
  assert.strictEqual(parseArgs(['admin@example.com', PW, `--confirm-host=${HOST}`]).confirmHost, HOST);
});
test('email is trimmed and lower-cased', () => {
  assert.strictEqual(parseArgs(['  Me@Example.COM ', PW, '--confirm-host', HOST]).email, 'me@example.com');
});
test('missing or extra positional arguments', () => {
  assert.match(parseArgs([]).error, /Expected exactly 2/);
  assert.match(parseArgs(['a@b.co', '--confirm-host', HOST]).error, /Expected exactly 2/);
  assert.match(parseArgs([...base(), 'extra']).error, /Expected exactly 2/);
});
test('invalid email', () => {
  for (const e of ['nope', 'a@b', 'a b@c.d', '@x.y']) {
    assert.match(parseArgs([e, PW, '--confirm-host', HOST]).error, /not a valid email/, e);
  }
});
test(`password shorter than ${MIN_PASSWORD_LENGTH} refused, exactly ${MIN_PASSWORD_LENGTH} accepted`, () => {
  assert.match(parseArgs(['a@b.co', '1234567', '--confirm-host', HOST]).error, /at least 8/);
  assert.strictEqual(parseArgs(['a@b.co', '12345678', '--confirm-host', HOST]).password, '12345678');
});
test('--confirm-host required and needs a value', () => {
  assert.match(parseArgs(['a@b.co', PW]).error, /--confirm-host <db host> is required/);
  assert.match(parseArgs(['a@b.co', PW, '--confirm-host']).error, /needs a value/);
  assert.match(parseArgs(['a@b.co', PW, '--confirm-host', '  ']).error, /is required/);
  assert.match(parseArgs(['a@b.co', PW, '--confirm-host=']).error, /is required/);
});
test('unknown option refused; -- allows a password starting with --', () => {
  assert.match(parseArgs([...base(), '--yes']).error, /Unknown option/);
  const r = parseArgs(['--confirm-host', HOST, '--', 'a@b.co', '--dashpass1']);
  assert.strictEqual(r.password, '--dashpass1');
  assert.match(parseArgs(['a@b.co', '--dashpass1', '--confirm-host', HOST]).error, /Unknown option/);
});
test(`password "-" reads ${PASSWORD_ENV}`, () => {
  const r = parseArgs(['a@b.co', '-', '--confirm-host', HOST], { [PASSWORD_ENV]: PW });
  assert.strictEqual(r.password, PW);
  assert.match(r.passwordSource, /ADMIN_PASSWORD/);
  assert.match(parseArgs(['a@b.co', '-', '--confirm-host', HOST], {}).error, /ADMIN_PASSWORD is not set/);
  assert.match(parseArgs(['a@b.co', '-', '--confirm-host', HOST], { [PASSWORD_ENV]: '' }).error, /not set or is empty/);
  assert.match(parseArgs(['a@b.co', '-', '--confirm-host', HOST], { [PASSWORD_ENV]: 'short' }).error, /at least 8/);
});
test('no parse error ever contains the password', () => {
  const cases = [
    [PW], ['not-an-email', PW, '--confirm-host', HOST], [PW, 'admin@example.com', '--confirm-host', HOST],
    ['a@b.co', PW], ['a@b.co', PW, '--confirm-host'], ['a@b.co', `--${PW}`, '--confirm-host', HOST],
    [`--${PW}`], ['a@b.co', PW, 'x', '--confirm-host', HOST],
  ];
  for (const argv of cases) {
    const r = parseArgs(argv, { [PASSWORD_ENV]: PW });
    assert.ok(r.error, JSON.stringify(argv.length));
    assert.ok(!r.error.includes(PW), 'password leaked in parse error');
  }
});

// ── target and confirm-host ──
test('parseDbTarget', () => {
  assert.deepStrictEqual(parseDbTarget(URL_), { host: HOST, database: 'proddb' });
  assert.deepStrictEqual(parseDbTarget('postgres://u:p@LOCALHOST:5432/my%20db'), { host: 'localhost', database: 'my db' });
  assert.deepStrictEqual(parseDbTarget('postgres://u:p@[::1]:5432/x'), { host: '::1', database: 'x' });
  assert.strictEqual(parseDbTarget('postgres://u:p@h.example').database, '(default)');
  assert.strictEqual(parseDbTarget(''), null);
  assert.strictEqual(parseDbTarget(undefined), null);
  assert.strictEqual(parseDbTarget('not a url'), null);
});
test('checkConfirmHost', () => {
  assert.strictEqual(checkConfirmHost(HOST, HOST).ok, true);
  assert.strictEqual(checkConfirmHost(` ${HOST.toUpperCase()} `, HOST).ok, true);
  assert.strictEqual(checkConfirmHost('[::1]', '::1').ok, true);
  const bad = checkConfirmHost('ep-other.neon.tech', HOST);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /does not match/);
  assert.strictEqual(checkConfirmHost(HOST.replace('-pooler', ''), HOST).ok, false, 'pooler vs direct host must differ');
  assert.strictEqual(checkConfirmHost(HOST, null).ok, false);
});

// ── --reset decision ──
const E = 'admin@example.com';
test('no admins -> create (with or without --reset)', () => {
  assert.deepStrictEqual(decideAction({ adminCount: 0, matches: [], email: E, reset: false }), { action: 'create' });
  assert.deepStrictEqual(decideAction({ adminCount: 0, matches: [], email: E, reset: true }), { action: 'create' });
});
test('same email + --reset -> update that id', () => {
  assert.deepStrictEqual(
    decideAction({ adminCount: 1, matches: [{ id: 7, email: E }], email: E, reset: true }),
    { action: 'update', adminId: 7 },
  );
  // even if other admins also exist: this is recovering an existing account, not adding one
  assert.deepStrictEqual(
    decideAction({ adminCount: 3, matches: [{ id: 7, email: E }], email: E, reset: true }),
    { action: 'update', adminId: 7 },
  );
});
test('same email without --reset -> refuse', () => {
  const d = decideAction({ adminCount: 1, matches: [{ id: 7, email: E }], email: E, reset: false });
  assert.strictEqual(d.action, 'refuse');
  assert.match(d.reason, /Pass --reset/);
});
test('other admins, none with this email -> refuse, even with --reset', () => {
  for (const reset of [false, true]) {
    const d = decideAction({ adminCount: 1, matches: [], email: E, reset });
    assert.strictEqual(d.action, 'refuse');
    assert.match(d.reason, /never adds a second one/);
    assert.match(d.reason, /Adding another admin currently needs a developer to run a script/);
    assert.match(d.reason, /only creates the first admin, or resets that same admin with --reset/);
    assert.doesNotMatch(d.reason, /panel/i);
  }
});
test('case-variant duplicate -> refuse, with or without --reset, even alongside an exact match', () => {
  for (const reset of [false, true]) {
    let d = decideAction({ adminCount: 1, matches: [{ id: 3, email: 'Admin@Example.com' }], email: E, reset });
    assert.strictEqual(d.action, 'refuse');
    assert.match(d.reason, /different case/);
    d = decideAction({ adminCount: 2, matches: [{ id: 7, email: E }, { id: 3, email: 'ADMIN@example.com' }], email: E, reset });
    assert.strictEqual(d.action, 'refuse');
    assert.match(d.reason, /id 3/);
  }
});
test('bad admin count -> refuse', () => {
  assert.strictEqual(decideAction({ adminCount: -1, matches: [], email: E, reset: true }).action, 'refuse');
  assert.strictEqual(decideAction({ adminCount: undefined, matches: [], email: E, reset: true }).action, 'refuse');
});

// ── errors and redaction ──
test('isNotMigratedError', () => {
  assert.strictEqual(isNotMigratedError({ code: 'P2021' }), true);
  assert.strictEqual(isNotMigratedError({ code: 'P2022' }), true);
  assert.strictEqual(isNotMigratedError({ code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'TableDoesNotExist' } } } }), true);
  assert.strictEqual(isNotMigratedError({ meta: { driverAdapterError: { cause: { originalCode: '42703' } } } }), true);
  assert.strictEqual(isNotMigratedError({ code: 'P2002' }), false);
  assert.strictEqual(isNotMigratedError(null), false);
});
test('redact removes URL, any postgres:// string, DB password, admin password and hash', () => {
  const hash = '$2b$10$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU';
  const text = `failed ${URL_} and postgres://x:y@other/z; db pw dbP4ssw0rd; data ${PW} ${encodeURIComponent(PW)} ${hash}`;
  const out = redact(text, { databaseUrl: URL_, host: HOST, password: PW, passwordHash: hash });
  for (const secret of [URL_, 'postgres://', 'dbP4ssw0rd', PW, encodeURIComponent(PW), hash]) {
    assert.ok(!out.includes(secret), `leaked: ${secret.slice(0, 12)}`);
  }
  assert.match(out, new RegExp(`<DATABASE_URL host=${HOST.replace(/\./g, '\\.')}>`));
  assert.strictEqual(redact('plain', {}), 'plain');
});
test('bcrypt cost 10 round-trips with bcrypt.compare (what adminLogin uses)', () => {
  assert.strictEqual(BCRYPT_COST, 10);
  const hash = bcrypt.hashSync(PW, BCRYPT_COST);
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.strictEqual(bcrypt.compareSync(PW, hash), true);
  assert.strictEqual(bcrypt.compareSync(`${PW}x`, hash), false);
});

// ── main(), paths that never connect ──
async function run(argv, env) {
  const out = [];
  const code = await main({ argv, env, log: (s) => out.push(String(s)), logError: (s) => out.push(String(s)) });
  return { code, text: out.join('\n') };
}
test('main: --help 0, bad args 1, no DATABASE_URL 1, host mismatch 2; never prints the password or URL', async () => {
  let r = await run(['--help'], {});
  assert.strictEqual(r.code, 0);
  assert.match(r.text, /Usage/);

  r = await run(['bad', PW, '--confirm-host', HOST], { DATABASE_URL: URL_ });
  assert.strictEqual(r.code, 1);
  assert.ok(!r.text.includes(PW));

  r = await run(base(), {});
  assert.strictEqual(r.code, 1);
  assert.match(r.text, /DATABASE_URL is not set/);

  r = await run(base(), { DATABASE_URL: 'garbage' });
  assert.strictEqual(r.code, 1);

  r = await run(['admin@example.com', PW, '--confirm-host', 'ep-wrong.neon.tech'], { DATABASE_URL: URL_ });
  assert.strictEqual(r.code, 2);
  assert.match(r.text, /REFUSED: --confirm-host/);
  assert.match(r.text, new RegExp(`Database host: ${HOST.replace(/\./g, '\\.')}`));
  assert.match(r.text, /Database name: proddb/);
  assert.match(r.text, /DATABASE_URL: {2}from (the shell environment|\.env) \(value not shown\)/);
  for (const secret of [PW, URL_, 'dbP4ssw0rd', 'postgres']) assert.ok(!r.text.includes(secret), `leaked ${secret.slice(0, 8)}`);

  r = await run(['admin@example.com', '-', '--confirm-host', 'ep-wrong.neon.tech'], { DATABASE_URL: URL_, [PASSWORD_ENV]: PW });
  assert.strictEqual(r.code, 2);
  assert.ok(!r.text.includes(PW));
});

(async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  }
  console.log(`\n${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
