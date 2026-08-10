// services/session.service.js
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Revoke all active sessions for a user (used on new login)
async function revokeActiveSessions(userId) {
  return prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Revoke a single session by id (used on manual logout)
async function revokeSession(sessionId) {
  return prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

module.exports = { revokeActiveSessions, revokeSession };