// LOCAL / TEST DATABASES ONLY. Creates an admin account, or resets the password
// of an existing one, so you can sign in to the admin panel against a test DB.
//
//   node scripts/createTestAdmin.js <email> <password> [name]
//
// Credentials come only from the arguments; nothing is hard-coded. The email
// is trimmed and lower-cased (admin login matches the email exactly, so log in
// with the lower-case form). Password: at least 8 characters, the same rule as
// POST /admin/me/password. Hashed exactly like the admin password code:
// bcrypt.hash(password, 10) (adminAuth.controller changeAdminPassword,
// prisma/resetAdminPassword.js). Neither the password nor the hash is printed.
//
// If an admin with that email exists: its password is replaced and it is set
// to role "admin", status "active" (both needed to log in: adminLogin checks
// status, authenticateAdmin checks role). The name changes only if given.
//
// SAFETY GUARD, all checked before anything is written. (a), (b), (d) and the
// user count in (c) reuse the helpers exported by scripts/seedTestAccounts.js:
//   (a) NODE_ENV=production -> refuse.
//   (b) DATABASE_URL host must be local (localhost, 127.0.0.1, ::1, db,
//       postgres, ...) or exactly equal SEED_ALLOWED_DB_HOST.
//   (c) After connecting: more than 10 users whose email does not end with
//       @test.local, or more than MAX_OTHER_ADMINS admins other than the target
//       email -> refuse (looks like real data).
//   (d) Only the host is printed, never the URL; URLs are redacted from errors.
//
// Exit codes: 0 done, 1 bad arguments or a database error, 2 refused by the guard.
require('dotenv').config({ quiet: true });

const {
  checkEnvironment, decideRealDataGuard, redact, MAX_FOREIGN_USERS,
} = require('./seedTestAccounts');

const MIN_PASSWORD_LENGTH = 8; // adminAuth.controller MIN_PASSWORD_LENGTH
const BCRYPT_COST = 10; // adminAuth.controller / resetAdminPassword.js
const EMAIL_RE = /^\S+@\S+\.\S+$/; // adminAuth.controller updateAdminProfile
const TEST_USER_DOMAIN = '@test.local';
const MAX_OTHER_ADMINS = 3;

const USAGE = [
  'Usage: node scripts/createTestAdmin.js <email> <password> [name]',
  '',
  'Creates an admin (or resets an existing admin\'s password) in a LOCAL/TEST',
  'database. Refuses unless DATABASE_URL\'s host is local (localhost, 127.0.0.1,',
  '::1, db, postgres, ...) or exactly equals SEED_ALLOWED_DB_HOST, and refuses',
  'when NODE_ENV=production. Password: at least 8 characters.',
].join('\n');

// ── pure helpers (unit-tested in createTestAdmin.test.js) ──

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [rawEmail, password, rawName, ...extra] = argv;
  if (rawEmail === undefined || password === undefined || extra.length > 0) return { error: USAGE };

  const email = String(rawEmail).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: `Not a valid email address: ${rawEmail}\n${USAGE}` };

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters (same rule as the admin password change).` };
  }

  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
  return { email, password, name };
}

// Guard (c), admin half: other admin rows besides the target email.
function decideAdminGuard(otherAdminCount, max = MAX_OTHER_ADMINS) {
  if (!Number.isInteger(otherAdminCount) || otherAdminCount < 0) {
    return { ok: false, reason: 'Could not count existing admins.' };
  }
  if (otherAdminCount > max) {
    return {
      ok: false,
      reason: `The database has ${otherAdminCount} other admins (limit ${max}). It looks like real data, so nothing was written.`,
    };
  }
  return { ok: true, reason: `${otherAdminCount} other admins (limit ${max})` };
}

// ── DB work ──

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.error) {
    console.error(args.error);
    return 1;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const env = checkEnvironment({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl,
    allowedHost: process.env.SEED_ALLOWED_DB_HOST,
  });
  if (!env.ok) {
    console.error(`REFUSED: ${env.reason}`);
    return 2;
  }
  console.log(`Database host: ${env.host} (${env.reason})`);

  // Loaded only after the guard, so a refused run never builds a client.
  const bcrypt = require('bcrypt');
  const { PrismaClient } = require('../src/generated/prisma');
  const { PrismaPg } = require('@prisma/adapter-pg');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const foreignUsers = await prisma.user.count({ where: { NOT: { email: { endsWith: TEST_USER_DOMAIN } } } });
    const userCheck = decideRealDataGuard(foreignUsers, MAX_FOREIGN_USERS);
    if (!userCheck.ok) {
      console.error(`REFUSED: ${userCheck.reason} (counting users not ending in ${TEST_USER_DOMAIN})`);
      return 2;
    }
    const otherAdmins = await prisma.admin.count({ where: { NOT: { email: args.email } } });
    const adminCheck = decideAdminGuard(otherAdmins);
    if (!adminCheck.ok) {
      console.error(`REFUSED: ${adminCheck.reason}`);
      return 2;
    }
    console.log(`Data check: ${userCheck.reason.replace('non-seed', `non-${TEST_USER_DOMAIN}`)}; ${adminCheck.reason}`);

    // Postgres compares emails case-sensitively, and login matches exactly. A
    // row that differs only in case would leave two near-identical admins.
    const caseVariant = await prisma.admin.findFirst({
      where: { email: { equals: args.email, mode: 'insensitive' }, NOT: { email: args.email } },
      select: { id: true, email: true },
    });
    if (caseVariant) {
      console.error(`An admin with the same email in different case already exists (id ${caseVariant.id}). Nothing was written.`);
      return 1;
    }

    const passwordHash = await bcrypt.hash(args.password, BCRYPT_COST);
    const existing = await prisma.admin.findUnique({ where: { email: args.email }, select: { id: true } });
    const state = { password: passwordHash, role: 'admin', status: 'active' };
    if (args.name !== undefined) state.name = args.name;

    const admin = existing
      ? await prisma.admin.update({ where: { id: existing.id }, data: state, select: { id: true, email: true, role: true, status: true } })
      : await prisma.admin.create({ data: { email: args.email, ...state }, select: { id: true, email: true, role: true, status: true } });

    console.log('');
    console.log(existing
      ? `UPDATED existing admin: password replaced, role/status set to ${admin.role}/${admin.status}.`
      : `CREATED new admin (role ${admin.role}, status ${admin.status}).`);
    console.log(`Email:    ${admin.email}`);
    console.log(`Admin id: ${admin.id}`);
    console.log('Password: from the command line (not shown).');
    console.log('Log in:   POST /api/auth/admin/login  {"email": "<the email above>", "password": "..."}');
    return 0;
  } catch (error) {
    console.error(redact(error && error.stack ? error.stack : error, databaseUrl, env.host));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { parseArgs, decideAdminGuard, MIN_PASSWORD_LENGTH, BCRYPT_COST, MAX_OTHER_ADMINS, USAGE };
