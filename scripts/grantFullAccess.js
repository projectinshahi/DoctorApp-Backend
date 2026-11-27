// Turn "full access" on or off for one student account (the owner's).
//
//   node scripts/grantFullAccess.js owner@example.com true
//   node scripts/grantFullAccess.js owner@example.com false
//
// A full-access account opens every course's content in the student app with
// no subscription: premium lessons and videos, quizzes with premium
// questions, mock tests, Rapid Recall. See src/services/access.service.js.
//
// This script is the ONLY way to set the flag: no API endpoint writes it, and
// the admin app cannot. It touches the students table (`users`) only, never
// `admins`. It reads DATABASE_URL from .env, so it acts on whatever database
// that points at: check before running it against production.
//
// The change applies on the student's next request (the flag is read from the
// database every time, not from the login token). A blocked account gets
// nothing from the flag until it is unblocked.
require('dotenv').config();
const { PrismaClient } = require('../src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const USAGE = 'Usage: node scripts/grantFullAccess.js <email> <true|false>';

function parseArgs(argv) {
  const [rawEmail, rawValue, ...extra] = argv;
  if (!rawEmail || rawValue === undefined || extra.length > 0) return { error: USAGE };

  // Stored lower-cased by signup, so match it the same way.
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return { error: `Not an email address: ${rawEmail}\n${USAGE}` };

  // Strict on purpose: "yes", "1" or a typo must not silently grant access.
  if (rawValue !== 'true' && rawValue !== 'false') {
    return { error: `Second argument must be exactly true or false, got: ${rawValue}\n${USAGE}` };
  }
  return { email, value: rawValue === 'true' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (expected in .env or the environment).');
    return 1;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email: args.email },
      select: { id: true, role: true, status: true, fullAccess: true },
    });
    if (!user) {
      console.error(`No student account with email ${args.email}`);
      return 1;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { fullAccess: args.value },
      select: { id: true, role: true, status: true, fullAccess: true },
    });

    console.log(`User id ${updated.id} (${args.email}): fullAccess ${user.fullAccess} -> ${updated.fullAccess}`);
    console.log(`Role: ${updated.role}. Status: ${updated.status}.`);
    if (updated.role !== 'student') {
      console.warn(`Warning: role is "${updated.role}", not "student".`);
    }
    if (updated.fullAccess && updated.status === 'blocked') {
      console.warn('Warning: this account is blocked. Full access has no effect until it is unblocked.');
    }
    if (updated.fullAccess && updated.status === 'unverified') {
      console.warn('Note: this account is unverified; it must finish email verification to sign in.');
    }
    return 0;
  } catch (error) {
    // P2022: the column does not exist yet; the migration has not been run.
    if (error.code === 'P2022') {
      console.error('The users.fullAccess column is missing. Run `npx prisma migrate deploy` first.');
    } else {
      console.error(error);
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { parseArgs };
