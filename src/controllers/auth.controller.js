// const crypto = require('crypto');
// const { PrismaClient } = require('../generated/prisma');
// const { PrismaPg } = require('@prisma/adapter-pg');
// const {
//   verifyGoogleToken,
//   generateAccessToken,
//   generateRefreshToken,
// } = require('../services/auth.service');

// const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
// const prisma = new PrismaClient({ adapter });

// async function googleSignIn(req, res, next) {
//   try {
//     const { idToken, deviceId } = req.body;

//     if (!idToken) {
//       return res.status(400).json({
//         error: { message: 'idToken is required', status: 400 },
//       });
//     }

//     if (!deviceId) {
//       return res.status(400).json({
//         error: { message: 'deviceId is required', status: 400 },
//       });
//     }

//     const googleUser = await verifyGoogleToken(idToken);

//     let user = await prisma.user.findUnique({
//       where: { email: googleUser.email },
//     });

//     let isNewUser = false;

//     if (!user) {
//       user = await prisma.user.create({
//         data: {
//           email: googleUser.email,
//           name: googleUser.name,
//           status: 'verified',
//           password: null,
//         },
//       });
//       isNewUser = true;
//     }

//     // Revoke any existing active session(s) for this user (single-active-session rule)
//     await prisma.session.updateMany({
//       where: {
//         userId: user.id,
//         revokedAt: null,
//       },
//       data: {
//         revokedAt: new Date(),
//       },
//     });

//     // Create the new session with a temporary unique placeholder token
//     const session = await prisma.session.create({
//       data: {
//         userId: user.id,
//         deviceId: deviceId,
//         refreshToken: crypto.randomUUID(), // temporary unique value, replaced below
//       },
//     });

//     // Now generate the real tokens, embedding the session's id
//     const accessToken = generateAccessToken({
//       userId: user.id,
//       role: user.role,
//       sessionId: session.id,
//     });
//     const refreshToken = generateRefreshToken({
//       userId: user.id,
//       sessionId: session.id,
//     });

//     // Update the session with the real refresh token
//     await prisma.session.update({
//       where: { id: session.id },
//       data: { refreshToken: refreshToken },
//     });

//     res.status(200).json({
//       accessToken,
//       refreshToken,
//       isNewUser,
//       sessionId: session.id,
//       user: {
//         id: user.id,
//         email: user.email,
//         name: user.name,
//         role: user.role,
//       },
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(401).json({
//       error: { message: 'Invalid or expired Google token', status: 401 },
//     });
//   }
// }

// module.exports = { googleSignIn };

const crypto = require('crypto');
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  verifyGoogleToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../services/auth.service');
const { revokeActiveSessions, revokeSession } = require('../services/session.service');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function googleSignIn(req, res, next) {
  try {
    const { idToken, deviceId } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: { message: 'idToken is required', status: 400 },
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        error: { message: 'deviceId is required', status: 400 },
      });
    }

    const googleUser = await verifyGoogleToken(idToken);

    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          status: 'verified',
          password: null,
        },
      });
      isNewUser = true;
    }

    // Without this, a blocked student could simply sign in again and get a
    // fresh session, making the admin block button useless.
    if (user.status === 'blocked') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_BLOCKED',
          message: 'Your account has been blocked. Please contact support.',
          status: 403,
        },
      });
    }

    // Revoke any existing active session(s) for this user (single-active-session rule)
    await revokeActiveSessions(user.id);

    // Create the new session with a temporary unique placeholder token
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        deviceId: deviceId,
        refreshToken: crypto.randomUUID(),
      },
    });

    // Now generate the real tokens, embedding the session's id
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: session.id,
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      sessionId: session.id,
    });

    // Update the session with the real refresh token
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: refreshToken },
    });

    res.status(200).json({
      accessToken,
      refreshToken,
      isNewUser,
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({
      error: { message: 'Invalid or expired Google token', status: 401 },
    });
  }
}

// NEW: refresh access token using a valid refresh token
async function refreshAccessToken(req, res) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: { code: 'MISSING_REFRESH_TOKEN', message: 'refreshToken is required', status: 400 },
      });
    }

    // 1. Verify JWT signature/expiry
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token', status: 401 },
      });
    }

    // 2. Look up the session
    const session = await prisma.session.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session) {
      return res.status(401).json({
        error: { code: 'SESSION_NOT_FOUND', message: 'Session not found', status: 401 },
      });
    }

    // 3. Session must not be revoked (kicked out by another device / logged out)
    if (session.revokedAt !== null) {
      return res.status(401).json({
        error: {
          code: 'SESSION_ENDED',
          message: 'You were signed out because your account was accessed on another device.',
          status: 401,
        },
      });
    }

    // 4. The refresh token sent must match the one currently stored for this session
    //    (prevents reuse of an old/rotated-out refresh token)
    if (session.refreshToken !== refreshToken) {
      // Someone is trying to use a stale/stolen refresh token — revoke the session as a precaution
      await revokeSession(session.id);
      return res.status(401).json({
        error: { code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token is no longer valid', status: 401 },
      });
    }

    // 5. Fetch user for role info
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return res.status(401).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found', status: 401 },
      });
    }

    // 6. Issue a new access token
    const newAccessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: session.id,
    });

    // 7. Rotate the refresh token too (recommended security practice)
    const newRefreshToken = generateRefreshToken({
      userId: user.id,
      sessionId: session.id,
    });

    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: newRefreshToken },
    });

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: { message: 'Failed to refresh token', status: 500 },
    });
  }
}

// logout controller
async function logout(req, res) {
  try {
    await revokeSession(req.user.sessionId); // req.user comes from authenticateStudent middleware
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Logout failed', status: 500 } });
  }
}

module.exports = { googleSignIn, refreshAccessToken, logout };