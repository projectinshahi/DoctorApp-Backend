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
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: { message: 'idToken is required', status: 400 },
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

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });

    res.status(200).json({
      accessToken,
      refreshToken,
      isNewUser,
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