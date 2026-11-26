// LOCAL / TEST DATABASES ONLY. Creates three student test accounts and a small
// "[TEST]" course to try the fullAccess owner flag against:
//
//   owner@test.local   fullAccess = true, no subscription
//   paid@test.local    active subscription (365 days) to the [TEST] plan
//   unpaid@test.local  no subscription
//
//   node scripts/seedTestAccounts.js
//   node scripts/seedTestAccounts.js --password <password>
//
// Password: --password, else SEED_TEST_PASSWORD, else DEFAULT_PASSWORD below
// (a local test password, not a real one). Hashed with the same function
// registration uses (auth.service hashPassword, bcrypt cost 12).
//
// Idempotent: users are upserted by email, so re-running resets the three
// accounts to the state above (password, verified, fullAccess, selected
// course), replaces their subscriptions, and revokes their sessions (which
// also clears the one-device lock). The [TEST] course, plan, chapter, lessons
// and test paper are found by title and reset; rows without the "[TEST]"
// prefix are never touched.
//
// SAFETY GUARD, all checked before anything is written:
//   (a) NODE_ENV=production            -> refuse.
//   (b) DATABASE_URL host must be localhost / 127.0.0.1 / ::1 / a docker-style
//       host (db, postgres, postgresql, database), OR exactly equal
//       SEED_ALLOWED_DB_HOST (set it on purpose to your test DB's host, e.g. a
//       Neon test branch). Anything else -> refuse.
//   (c) After connecting: more than MAX_FOREIGN_USERS users whose email is not
//       a seed email -> refuse (looks like real data).
//   (d) Only the host is ever printed, never the full URL.
require('dotenv').config({ quiet: true });

const SEED_DOMAIN = 'test.local';
const ACCOUNTS = [
  { key: 'owner', email: `owner@${SEED_DOMAIN}`, name: 'Test Owner (full access)', fullAccess: true, subscribe: false },
  { key: 'paid', email: `paid@${SEED_DOMAIN}`, name: 'Test Paid Student', fullAccess: false, subscribe: true },
  { key: 'unpaid', email: `unpaid@${SEED_DOMAIN}`, name: 'Test Unpaid Student', fullAccess: false, subscribe: false },
];
const SEED_EMAILS = ACCOUNTS.map((a) => a.email);

const DEFAULT_PASSWORD = 'LocalTest#2026';
const MIN_PASSWORD = 8; // same minimum as register / reset-password
const MAX_FOREIGN_USERS = 10;
const SUBSCRIPTION_DAYS = 365;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres', 'postgresql', 'database']);

const T = '[TEST]';
const COURSE_TITLE = `${T} Full Access Demo Course`;
const PLAN_TITLE = `${T} All-access plan`;
const CHAPTER_TITLE = `${T} Chapter 1`;
const TEST_NAME = `${T} Premium mock test`;
const ALL_ENTITLEMENTS = ['mcq', 'mock', 'rapid_recall', 'video_lecture', 'live_class', 'ai_patient'];
// Cloudinary's public demo clip, so a video row has something playable.
const SAMPLE_VIDEO = 'https://res.cloudinary.com/demo/video/upload/dog.mp4';

const USAGE = [
  'Usage: node scripts/seedTestAccounts.js [--password <password>]',
  '',
  'LOCAL/TEST databases only. Refuses unless DATABASE_URL\'s host is local',
  '(localhost, 127.0.0.1, ::1, db, postgres, ...) or exactly equals',
  'SEED_ALLOWED_DB_HOST, and refuses when NODE_ENV=production.',
  'Password: --password, else SEED_TEST_PASSWORD, else the built-in test password.',
].join('\n');

// ── pure helpers (unit-tested in seedTestAccounts.test.js) ──

function parseArgs(argv, env = {}) {
  let password;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--password') {
      if (i + 1 >= argv.length) return { error: `--password needs a value\n${USAGE}` };
      password = argv[++i];
    } else if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    } else {
      return { error: `Unknown argument: ${arg}\n${USAGE}` };
    }
  }
  let source = 'argument';
  if (password === undefined && env.SEED_TEST_PASSWORD) {
    password = env.SEED_TEST_PASSWORD;
    source = 'SEED_TEST_PASSWORD';
  }
  if (password === undefined) {
    password = DEFAULT_PASSWORD;
    source = 'default';
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters (same rule as signup).` };
  }
  return { password, passwordSource: source };
}

// The host of a postgres URL, lower-cased, without IPv6 brackets. null if the
// URL cannot be parsed or has no host (a socket path, say): treated as unsafe.
function dbHostOf(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl) return null;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host || null;
  } catch {
    return null;
  }
}

function isLocalHost(host) {
  return typeof host === 'string' && LOCAL_HOSTS.has(host.toLowerCase());
}

// Guards (a) and (b). Returns { ok, host, reason }. `reason` never contains
// the URL, only the host.
function checkEnvironment({ nodeEnv, databaseUrl, allowedHost }) {
  if (nodeEnv === 'production') {
    return { ok: false, host: null, reason: 'NODE_ENV is "production". This seed only runs against local/test databases.' };
  }
  if (!databaseUrl) {
    return { ok: false, host: null, reason: 'DATABASE_URL is not set (expected in .env or the environment).' };
  }
  const host = dbHostOf(databaseUrl);
  if (!host) {
    return { ok: false, host: null, reason: 'Could not read a host from DATABASE_URL, so it cannot be confirmed as local/test.' };
  }
  if (isLocalHost(host)) return { ok: true, host, reason: 'local host' };

  const allowed = typeof allowedHost === 'string' ? allowedHost.trim().toLowerCase() : '';
  if (allowed && allowed === host) return { ok: true, host, reason: 'matches SEED_ALLOWED_DB_HOST' };

  return {
    ok: false,
    host,
    reason: `Database host "${host}" is not local and does not equal SEED_ALLOWED_DB_HOST`
      + (allowed ? ` ("${allowed}")` : ' (not set)')
      + '. If this really is a test database, set SEED_ALLOWED_DB_HOST to exactly that host for this one command.',
  };
}

// Guard (c): how many users that are not seed accounts the DB may already have.
function decideRealDataGuard(foreignUserCount, max = MAX_FOREIGN_USERS) {
  if (!Number.isInteger(foreignUserCount) || foreignUserCount < 0) {
    return { ok: false, reason: 'Could not count existing users.' };
  }
  if (foreignUserCount > max) {
    return {
      ok: false,
      reason: `The database has ${foreignUserCount} users that are not seed accounts (limit ${max}). It looks like real data, so nothing was written.`,
    };
  }
  return { ok: true, reason: `${foreignUserCount} non-seed users (limit ${max})` };
}

// Keeps a connection string out of any error text we print.
function redact(text, databaseUrl, host) {
  let out = String(text);
  if (databaseUrl) out = out.split(databaseUrl).join(`<DATABASE_URL host=${host}>`);
  return out.replace(/postgres(ql)?:\/\/[^\s'"]+/gi, '<redacted url>');
}

function formatTable(rows) {
  const cols = Object.keys(rows[0] || {});
  const width = (c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length));
  const line = (r) => cols.map((c) => String(r[c]).padEnd(width(c))).join('  ');
  const header = Object.fromEntries(cols.map((c) => [c, c]));
  return [line(header), cols.map((c) => '-'.repeat(width(c))).join('  '), ...rows.map(line)].join('\n');
}

// ── DB work ──

// findFirst by a unique-in-practice key, then update or create. Only ever
// called with [TEST]-prefixed titles, so real rows are never matched.
async function findOrCreate(delegate, where, data) {
  const existing = await delegate.findFirst({ where, select: { id: true } });
  if (existing) return delegate.update({ where: { id: existing.id }, data });
  return delegate.create({ data: { ...where, ...data } });
}

async function seedContent(prisma) {
  const course = await findOrCreate(prisma.course, { title: COURSE_TITLE }, {
    description: 'Seeded by scripts/seedTestAccounts.js for local testing. Safe to delete.',
    status: 'published',
    // Premium, so a student with nothing paid sees padlocks; the free preview
    // lesson and the free video stay open.
    accessType: 'premium',
    difficulty: 'test',
  });

  const plan = await findOrCreate(prisma.plan, { courseId: course.id, title: PLAN_TITLE }, {
    description: 'Test plan with every entitlement.',
    price: 1,
    currency: 'USD',
    durationDays: SUBSCRIPTION_DAYS,
    features: ['[TEST] Everything'],
    entitlements: ALL_ENTITLEMENTS,
    isActive: true,
  });

  const chapter = await findOrCreate(prisma.chapter, { courseId: course.id, title: CHAPTER_TITLE }, {
    courseTypeId: null,
    displayOrder: 0,
  });

  const lessonDefs = [
    {
      title: `${T} Free preview lesson`, type: 'text', displayOrder: 0, isFreePreview: true, accessType: 'free',
      content: 'FREE PREVIEW: every account should be able to read this text.',
    },
    {
      title: `${T} Premium text lesson`, type: 'text', displayOrder: 1, isFreePreview: false, accessType: 'premium',
      content: 'PREMIUM: only owner (full access) and paid should see this text.',
    },
    {
      title: `${T} Premium video lesson`, type: 'video', displayOrder: 2, isFreePreview: false, accessType: 'premium',
      content: null, videoUrl: SAMPLE_VIDEO,
    },
  ];
  const lessons = [];
  for (const def of lessonDefs) {
    const { title, ...rest } = def;
    lessons.push(await findOrCreate(prisma.lesson, { chapterId: chapter.id, title }, {
      ...rest, status: 'published', commentsEnabled: true, quizId: null,
    }));
  }

  // Video lesson: part 1 free (opens for everyone), part 2 premium.
  const videoLesson = lessons[2];
  await prisma.lessonVideo.deleteMany({ where: { lessonId: videoLesson.id } });
  await prisma.lessonVideo.createMany({
    data: [
      { lessonId: videoLesson.id, title: `${T} Part 1 (free)`, videoUrl: SAMPLE_VIDEO, displayOrder: 0, accessType: 'free', status: 'published' },
      { lessonId: videoLesson.id, title: `${T} Part 2 (premium)`, videoUrl: SAMPLE_VIDEO, displayOrder: 1, accessType: 'premium', status: 'published' },
    ],
  });
  // No plan pinning: the rule is then "any plan selling the entitlement".
  await prisma.lessonPlan.deleteMany({ where: { lessonId: { in: lessons.map((l) => l.id) } } });

  // Mock test: gated by the `mock` entitlement (hasCourseFeature).
  const testQuestions = [
    { questionOrder: 1, questionText: `${T} 2 + 2 = ?`, optionA: '4', optionB: '3', optionC: '5', optionD: '22', correctOption: 'A' },
    { questionOrder: 2, questionText: `${T} Which organ pumps blood?`, optionA: 'Liver', optionB: 'Heart', optionC: 'Lung', optionD: 'Kidney', correctOption: 'B' },
  ];
  const test = await findOrCreate(prisma.test, { courseId: course.id, name: TEST_NAME }, {
    courseTypeId: null,
    instructions: 'Seeded test paper. Mock tests need the "mock" entitlement or full access.',
    totalQuestions: testQuestions.length,
    durationMinutes: 10,
    isPublished: true,
  });
  const questionCount = await prisma.testQuestion.count({ where: { testId: test.id } });
  if (questionCount === 0) {
    await prisma.testQuestion.createMany({ data: testQuestions.map((q) => ({ ...q, testId: test.id })) });
  }

  return { course, plan, chapter, lessons, test };
}

async function seedUsers(prisma, { passwordHash, course, plan }) {
  const now = new Date();
  const users = [];
  for (const account of ACCOUNTS) {
    // Exactly what a verified, email-registered student looks like, plus the
    // selected course. Any OTP in flight is cleared.
    const state = {
      name: account.name,
      password: passwordHash,
      role: 'student',
      status: 'verified',
      fullAccess: account.fullAccess,
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      emailOtpSentAt: null,
      selectedCourseId: course.id,
      selectedCourseTypeId: null,
    };
    const user = await prisma.user.upsert({
      where: { email: account.email },
      create: { email: account.email, ...state },
      update: state,
      select: { id: true, email: true, role: true, status: true, fullAccess: true },
    });

    // Known subscription state: only the paid account has one.
    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    let endDate = null;
    if (account.subscribe) {
      endDate = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: { userId: user.id, courseId: course.id, planId: plan.id, startDate: now, endDate, isActive: true },
      });
    }

    // Releases the one-device lock, like a logout on every device.
    const revoked = await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    users.push({ ...user, endDate, revokedSessions: revoked.count });
  }
  return users;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);
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
  const { PrismaClient } = require('../src/generated/prisma');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { hashPassword } = require('../src/services/auth.service');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const foreignUsers = await prisma.user.count({ where: { email: { notIn: SEED_EMAILS } } });
    const dataCheck = decideRealDataGuard(foreignUsers);
    if (!dataCheck.ok) {
      console.error(`REFUSED: ${dataCheck.reason}`);
      return 2;
    }
    console.log(`Data check: ${dataCheck.reason}`);

    const passwordHash = await hashPassword(args.password);
    const content = await seedContent(prisma);
    const users = await seedUsers(prisma, { passwordHash, course: content.course, plan: content.plan });

    console.log('');
    console.log(`Course: "${content.course.title}" (id ${content.course.id}, ${content.course.accessType}, ${content.course.status})`);
    console.log(`Plan:   "${content.plan.title}" (id ${content.plan.id}, entitlements: ${content.plan.entitlements.join(', ')})`);
    console.log(`Lessons: ${content.lessons.map((l) => `${l.id} ${l.title}`).join(' | ')}`);
    console.log(`Mock test: "${content.test.name}" (id ${content.test.id})`);
    console.log('');
    console.log(formatTable(users.map((u) => ({
      email: u.email,
      role: u.role,
      status: u.status,
      fullAccess: u.fullAccess,
      subscriptionEnd: u.endDate ? u.endDate.toISOString() : '-',
      selectedCourse: `${content.course.id} ${content.course.title}`,
      sessionsRevoked: u.revokedSessions,
    }))));
    console.log('');
    console.log(args.passwordSource === 'default'
      ? `Password for all three: ${DEFAULT_PASSWORD} (built-in local test password)`
      : `Password for all three: from ${args.passwordSource === 'argument' ? '--password' : 'SEED_TEST_PASSWORD'} (not shown)`);
    console.log('Login is email + password, then the 6-digit email code (POST /api/auth/login/verify-otp).');
    console.log('Without RESEND_API_KEY the code is printed by the server: look for "[email] RESEND_API_KEY not set".');
    return 0;
  } catch (error) {
    if (error.code === 'P2022') {
      console.error('A column is missing (probably users.fullAccess). Run `npx prisma migrate deploy` first.');
    } else {
      console.error(redact(error && error.stack ? error.stack : error, databaseUrl, env.host));
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = {
  parseArgs, dbHostOf, isLocalHost, checkEnvironment, decideRealDataGuard, redact, formatTable,
  SEED_EMAILS, DEFAULT_PASSWORD, MAX_FOREIGN_USERS,
};
