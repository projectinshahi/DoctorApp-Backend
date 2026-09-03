
// module.exports = authenticateStudent;

const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { verifyAccessToken } = require('../services/auth.service');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// How often a session's lastSeenAt is refreshed. Short enough that an idle
// device is spotted quickly, long enough that it is not a write per request.
const TOUCH_EVERY_MS = 3 * 60 * 1000;

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
      include: { user: { select: { status: true } } },
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

    // Checked before revokedAt: blocking also revokes the session, so testing
    // the session first would tell a blocked student they were signed in on
    // another device — wrong reason, and it hides the real one.
    if (session.user.status === 'blocked') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_BLOCKED',
          message: 'Your account has been blocked. Please contact support.',
          status: 403,
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

    // Mark the session alive, at most once every few minutes.
    //
    // This is what lets a second device be refused while the first is genuinely
    // in use, and released once it clearly is not. Writing on every request
    // would be a write per API call per student; the throttle costs one write
    // per active student per TOUCH_EVERY_MS instead.
    //
    // Deliberately not awaited: a slow write must not delay the response, and
    // a failed one only means the timestamp is a few minutes stale.
    const now = Date.now();
    const seen = session.lastSeenAt ? session.lastSeenAt.getTime() : 0;
    if (now - seen > TOUCH_EVERY_MS) {
      prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
        .catch((e) => console.error('lastSeenAt touch failed:', e.message));
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