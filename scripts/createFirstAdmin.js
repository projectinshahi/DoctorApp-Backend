// PRODUCTION-SAFE, ONE-TIME. Creates the FIRST admin on a new, empty database
// (or recovers that one account with --reset). It never creates a second admin.
//
//   node scripts/createFirstAdmin.js <email> <password> --confirm-host <db host> [--reset]
//   node scripts/createFirstAdmin.js <email> - --confirm-host <db host>     (password from $ADMIN_PASSWORD)
//
// Credentials come only from the arguments (or ADMIN_PASSWORD); nothing is
// hard-coded. The email is trimmed and lower-cased: admin login looks the email
// up exactly as typed (findUnique, no lower-casing), so the stored lower-case
// form is the one to log in with. Password: at least 8 characters, the same rule
// as POST /admin/me/password. Hashed exactly like the admin password code:
// bcrypt.hash(password, 10) (adminAuth.controller changeAdminPassword,
// prisma/resetAdminPassword.js); adminLogin checks it with bcrypt.compare.
// The row gets role "admin" (authenticateAdmin requires it, via the JWT) and
// status "active" (adminLogin requires it). Neither password nor hash is printed.
//
// Rules, decided inside ONE serializable transaction (plus an advisory lock), so
// two runs at once cannot both create:
//   - no admins at all                         -> CREATE
//   - an admin with exactly this email, --reset -> UPDATE its password, role, status
//   - an admin with exactly this email, no flag -> refuse
//   - admins exist but none has this email      -> refuse, even with --reset
//   - an admin with this email in another case  -> refuse
//
// Confirmation: --confirm-host must equal the host in DATABASE_URL. Chosen over
// an interactive prompt because it behaves the same in PowerShell, cmd, Git Bash
// (where node often has no real TTY) and CI, and over a bare --yes because you
// have to type the actual target, so a pasted command cannot hit the wrong DB.
//
// DATABASE_URL: a value already set in the shell wins over .env (dotenv does not
// override existing variables). The output says which one was used.
//
// Exit codes: 0 done, 1 bad arguments or a database error, 2 refused.

// Recorded before dotenv runs, so we know where DATABASE_URL came from.
const DATABASE_URL_FROM_SHELL = Object.prototype.hasOwnProperty.call(process.env, 'DATABASE_URL');
require('dotenv').config({ quiet: true, override: false }); // override:false is the default; stated on purpose

const MIN_PASSWORD_LENGTH = 8; // adminAuth.controller MIN_PASSWORD_LENGTH
const BCRYPT_COST = 10; // adminAuth.controller changeAdminPassword / resetAdminPassword.js
const EMAIL_RE = /^\S+@\S+\.\S+$/; // adminAuth.controller updateAdminProfile, createTestAdmin.js
const PASSWORD_ENV = 'ADMIN_PASSWORD';
const LOCK_KEY = 'createFirstAdmin';
const MIGRATE_HINT = 'The database is not migrated. Run `npx prisma migrate deploy` first (with the same DATABASE_URL), then run this script again.';

const USAGE = [
  'Usage: node scripts/createFirstAdmin.js <email> <password> --confirm-host <db host> [--reset]',
  '',
  'Creates the FIRST admin on a new, empty database. Refuses if any admin exists.',
  '',
  '  <email>                 trimmed and lower-cased; log in with the lower-case form',
  `  <password>              at least ${MIN_PASSWORD_LENGTH} characters. Pass - to read it from the`,
  `                          ${PASSWORD_ENV} environment variable instead, which keeps it out of`,
  '                          shell history. Use -- before a password that starts with --.',
  '  --confirm-host <host>   required; must equal the host in DATABASE_URL',
  '  --reset                 if an admin with exactly this email exists, replace its',
  '                          password and set role admin / status active. Still refuses',
  '                          when other admins exist but none has this email.',
  '  -h, --help              show this help',
  '',
  'DATABASE_URL is read from the shell, or from .env if the shell does not set it.',
  'Run `npx prisma migrate deploy` with the same DATABASE_URL first.',
  'Exit codes: 0 done, 1 bad arguments or database error, 2 refused.',
].join('\n');

// ── pure helpers (unit-tested in createFirstAdmin.test.js) ──

// Never echoes argument values: a mistyped line could put the password anywhere.
function parseArgs(argv, env = {}) {
  const positional = [];
  let reset = false;
  let confirmHost;
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (!endOfOptions && arg === '--') { endOfOptions = true; continue; }
    if (!endOfOptions && (arg === '--help' || arg === '-h')) return { help: true };
    if (!endOfOptions && arg === '--reset') { reset = true; continue; }
    if (!endOfOptions && arg === '--confirm-host') {
      if (i + 1 >= argv.length) return { error: `--confirm-host needs a value.\n\n${USAGE}` };
      confirmHost = String(argv[++i]);
      continue;
    }
    if (!endOfOptions && arg.startsWith('--confirm-host=')) { confirmHost = arg.slice('--confirm-host='.length); continue; }
    if (!endOfOptions && arg.startsWith('--')) {
      return { error: `Unknown option (not shown, in case it was the password). If your password starts with --, put -- before it.\n\n${USAGE}` };
    }
    positional.push(arg);
  }

  if (positional.length !== 2) {
    return { error: `Expected exactly 2 arguments, <email> and <password>; got ${positional.length}.\n\n${USAGE}` };
  }
  const [rawEmail, rawPassword] = positional;

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: `The first argument is not a valid email address (not shown).\n\n${USAGE}` };

  let password = rawPassword;
  let passwordSource = 'argument';
  if (rawPassword === '-') {
    password = env[PASSWORD_ENV];
    passwordSource = `${PASSWORD_ENV} environment variable`;
    if (typeof password !== 'string' || password === '') {
      return { error: `Password argument is "-" but ${PASSWORD_ENV} is not set or is empty.` };
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters (same rule as the admin password change).` };
  }

  if (confirmHost === undefined || confirmHost.trim() === '') {
    return { error: `--confirm-host <db host> is required: the host part of DATABASE_URL, to confirm the target.\n\n${USAGE}` };
  }

  return { email, password, passwordSource, reset, confirmHost: confirmHost.trim() };
}

// { host, database } of a postgres URL; host lower-cased without IPv6 brackets.
// null if it cannot be parsed or has no host.
function parseDbTarget(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return null;
    let database = url.pathname.replace(/^\//, '');
    try { database = decodeURIComponent(database); } catch { /* keep raw */ }
    return { host, database: database || '(default)' };
  } catch {
    return null;
  }
}

// --confirm-host check. Case-insensitive, surrounding whitespace and IPv6 brackets ignored.
function checkConfirmHost(confirmHost, actualHost) {
  const given = String(confirmHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!actualHost) return { ok: false, reason: 'Could not read a host from DATABASE_URL.' };
  if (given !== actualHost) {
    return {
      ok: false,
      reason: `--confirm-host "${given}" does not match the DATABASE_URL host "${actualHost}". Nothing was written.`,
    };
  }
  return { ok: true };
}

// The --reset decision. adminCount: all admin rows. matches: admins whose email
// equals `email` ignoring case ({ id, email }). Returns
// { action: 'create' | 'update' | 'refuse', adminId?, reason? }.
function decideAction({ adminCount, matches, email, reset }) {
  if (!Number.isInteger(adminCount) || adminCount < 0) {
    return { action: 'refuse', reason: 'Could not count existing admins.' };
  }
  const list = Array.isArray(matches) ? matches : [];
  const exact = list.find((a) => a.email === email);
  const variants = list.filter((a) => a.email !== email);

  if (variants.length > 0) {
    return {
      action: 'refuse',
      reason: `An admin with the same email in different case already exists (id ${variants.map((a) => a.id).join(', ')}). `
        + 'Login matches the email exactly, so this would leave two near-identical admins. Nothing was written.',
    };
  }
  if (adminCount === 0) return { action: 'create' };
  if (exact && reset) return { action: 'update', adminId: exact.id };
  if (exact) {
    return {
      action: 'refuse',
      reason: `An admin with this email already exists (id ${exact.id}). Pass --reset to replace its password. Nothing was written.`,
    };
  }
  return {
    action: 'refuse',
    reason: `The database already has ${adminCount} admin(s), none with this email. This script only creates the first admin `
      + 'or recovers that account; it never adds a second one, even with --reset. Adding another admin currently needs a developer '
      + 'to run a script; this script only creates the first admin, or resets that same admin with --reset. Nothing was written.',
  };
}

// Prisma "table does not exist" (P2021) / "column does not exist" (P2022), also
// as the raw driver-adapter or Postgres codes, in case they arrive unmapped.
function isNotMigratedError(error) {
  if (!error) return false;
  if (error.code === 'P2021' || error.code === 'P2022') return true;
  const cause = error.meta && error.meta.driverAdapterError && error.meta.driverAdapterError.cause;
  if (cause && (cause.kind === 'TableDoesNotExist' || cause.kind === 'ColumnNotFound')) return true;
  if (cause && (cause.originalCode === '42P01' || cause.originalCode === '42703')) return true;
  return error.code === '42P01' || error.code === '42703';
}

// Keeps secrets out of anything printed: the full URL, its DB password, any
// postgres:// string, the admin password (raw and URL-encoded) and its hash.
function redact(text, { databaseUrl, host, password, passwordHash } = {}) {
  let out = String(text);
  const cut = (secret, label) => {
    if (typeof secret === 'string' && secret.length > 0) out = out.split(secret).join(label);
  };
  cut(databaseUrl, `<DATABASE_URL host=${host || '?'}>`);
  out = out.replace(/postgres(ql)?:\/\/[^\s'"`]+/gi, '<redacted url>');
  if (typeof databaseUrl === 'string') {
    try {
      const dbPassword = new URL(databaseUrl).password;
      if (dbPassword && dbPassword.length >= 4) {
        cut(dbPassword, '<redacted db password>');
        try { cut(decodeURIComponent(dbPassword), '<redacted db password>'); } catch { /* ignore */ }
      }
    } catch { /* not a URL */ }
  }
  cut(passwordHash, '<redacted hash>');
  cut(password, '<redacted password>');
  if (typeof password === 'string' && password) cut(encodeURIComponent(password), '<redacted password>');
  return out;
}

// ── DB work ──

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, logError = console.error } = {}) {
  const args = parseArgs(argv, env);
  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (args.error) {
    logError(args.error);
    return 1;
  }

  const databaseUrl = env.DATABASE_URL;
  const secrets = { databaseUrl, password: args.password };
  if (!databaseUrl) {
    logError('DATABASE_URL is not set (neither in the shell nor in .env).');
    return 1;
  }
  const target = parseDbTarget(databaseUrl);
  if (!target) {
    logError('Could not read a host from DATABASE_URL.');
    return 1;
  }
  secrets.host = target.host;

  log(`Database host: ${target.host}`);
  log(`Database name: ${target.database}`);
  if (DATABASE_URL_FROM_SHELL) {
    log('DATABASE_URL:  from the shell environment (value not shown)');
  } else {
    log('DATABASE_URL:  from .env (value not shown)');
    log('WARNING: DATABASE_URL was not set in the shell, so the target is the database in your local .env file.');
  }

  const confirm = checkConfirmHost(args.confirmHost, target.host);
  if (!confirm.ok) {
    logError(`REFUSED: ${confirm.reason}`);
    return 2;
  }

  // Loaded only after the arguments are valid and the host is confirmed.
  const bcrypt = require('bcrypt');
  const { PrismaClient } = require('../src/generated/prisma');
  const { PrismaPg } = require('@prisma/adapter-pg');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    // Hashed before the transaction so the transaction stays short.
    const passwordHash = await bcrypt.hash(args.password, BCRYPT_COST);
    secrets.passwordHash = passwordHash;

    const result = await prisma.$transaction(async (tx) => {
      // Serializes concurrent runs of this script; released at commit/rollback.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}::text))::text AS locked`;
      const adminCount = await tx.admin.count();
      const matches = await tx.admin.findMany({
        where: { email: { equals: args.email, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
      const decision = decideAction({ adminCount, matches, email: args.email, reset: args.reset });
      if (decision.action === 'refuse') return { adminCount, decision };

      const state = { password: passwordHash, role: 'admin', status: 'active' };
      const select = { id: true, email: true, role: true, status: true };
      const admin = decision.action === 'update'
        ? await tx.admin.update({ where: { id: decision.adminId }, data: state, select })
        : await tx.admin.create({ data: { email: args.email, ...state }, select });
      return { adminCount, decision, admin };
    }, { isolationLevel: 'Serializable' });

    log(`Admins found:  ${result.adminCount}`);
    log(`Email:         ${args.email} (lower-cased; admin login matches the email exactly, so log in with this form)`);
    if (result.decision.action === 'refuse') {
      logError(`REFUSED: ${redact(result.decision.reason, secrets)}`);
      return 2;
    }
    log(`Admin id:      ${result.admin.id}`);
    log(`Password:      from the ${args.passwordSource} (not shown)`);
    log(result.decision.action === 'update'
      ? `UPDATED: password replaced, role/status set to ${result.admin.role}/${result.admin.status}.`
      : `CREATED: new admin, role ${result.admin.role}, status ${result.admin.status}.`);
    return 0;
  } catch (error) {
    if (isNotMigratedError(error)) {
      logError(MIGRATE_HINT);
      return 1;
    }
    const code = error && error.code ? ` [${error.code}]` : '';
    const message = error && error.message ? error.message : error;
    logError(`Database error${code}: ${redact(message, secrets)}`);
    return 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = {
  parseArgs, parseDbTarget, checkConfirmHost, decideAction, isNotMigratedError, redact, main,
  MIN_PASSWORD_LENGTH, BCRYPT_COST, EMAIL_RE, PASSWORD_ENV, USAGE,
};
