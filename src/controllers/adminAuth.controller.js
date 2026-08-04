const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { message: 'Email and password are required' },
      });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      return res.status(401).json({
        error: { message: 'Invalid email or password' },
      });
    }

    if (admin.status !== 'active') {
      return res.status(403).json({
        error: { message: 'Admin account is not active' },
      });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password);

    if (!passwordMatches) {
      return res.status(401).json({
        error: { message: 'Invalid email or password' },
      });
    }

    const token = jwt.sign(
      { adminId: admin.id, role: admin.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.status(200).json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong' },
    });
  }
}

module.exports = { adminLogin };