const crypto = require('crypto');
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  verifyGoogleToken,
  generateAccessToken,
  generateRefreshToken,
} = require('../services/auth.service');

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

    // Revoke any existing active session(s) for this user (single-active-session rule)
    await prisma.session.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // Create the new session with a temporary unique placeholder token
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        deviceId: deviceId,
        refreshToken: crypto.randomUUID(), // temporary unique value, replaced below
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

module.exports = { googleSignIn };