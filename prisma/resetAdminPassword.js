// Recover a locked-out admin. Bcrypt hashes are one-way, so a forgotten
// password cannot be read back — it can only be replaced.
//
//   node prisma/resetAdminPassword.js admin@yourapp.com 'NewPassword123!'
//
// The password is an argument, not a literal, so it never lands in git the
// way prisma/seedAdmin.ts's did.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('../src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node prisma/resetAdminPassword.js <email> '<new password>'");
  process.exit(1);
}

// Same cost factor as seedAdmin.ts and auth.service.js. A mismatch here would
// still verify fine — bcrypt reads the cost from the hash — but keeping them
// equal means every admin row costs the same to check.
bcrypt.hash(password, 10)
  .then((hash) => prisma.admin.update({ where: { email }, data: { password: hash } }))
  .then((admin) => console.log(`Password reset for ${admin.email}`))
  .catch((error) => {
    // P2025 is Prisma's "record not found" — a typo'd email, not a real fault.
    if (error.code === 'P2025') console.error(`No admin with email ${email}`);
    else console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
