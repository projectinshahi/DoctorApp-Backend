
// module.exports = authenticateStudent;

const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { verifyAccessToken } = require('../services/auth.service');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function authenticateStudent(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'MISSING_TOKEN',
        message: 'Missing or invalid authorization header',
        status: 401,
      },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    const session = await prisma.session.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session) {
      return res.status(401).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
          status: 401,
        },
      });
    }

    if (session.revokedAt !== null) {
      return res.status(401).json({
        error: {
          code: 'SESSION_ENDED',
          message: 'You were signed out because your account was accessed on another device.',
          status: 401,
        },
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
        status: 401,
      },
    });
  }
}

module.exports = authenticateStudent;