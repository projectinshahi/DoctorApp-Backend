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


// The account behind the token. Everything the settings screen renders, and a
// cheap way for the panel to find out on load that a token is still good.
const ADMIN_SELECT = {
  id: true, email: true, name: true, role: true, status: true,
  createdAt: true, updatedAt: true,
};

// GET /admin/me
async function getAdminProfile(req, res) {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.adminId }, select: ADMIN_SELECT,
    });
    // The token verified but the row is gone — a deleted admin holding a valid
    // 8h token. 401 rather than 404: the answer is to log in again.
    if (!admin) {
      return res.status(401).json({ error: { message: 'This admin account no longer exists' } });
    }
    if (admin.status !== 'active') {
      return res.status(403).json({ error: { message: 'Admin account is not active' } });
    }
    return res.status(200).json({ admin });
  } catch (error) {
    console.error('getAdminProfile error:', error);
    return res.status(500).json({ error: { message: 'Failed to load your profile' } });
  }
}


// PATCH /admin/me   { name?, email? }
//
// Name and email only. `role` and `status` are deliberately not editable here:
// they are the two fields that decide what this account may do, so a stolen
// token must not be able to promote itself or reactivate a disabled account.
async function updateAdminProfile(req, res) {
  try {
    const { name, email } = req.body ?? {};
    const data = {};

    if (name !== undefined) {
      if (name === null || (typeof name === 'string' && name.trim() === '')) {
        data.name = null;
      } else if (typeof name !== 'string') {
        return res.status(400).json({ error: { message: 'name must be text' } });
      } else {
        data.name = name.trim();
      }
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
        return res.status(400).json({ error: { message: 'Enter a valid email address' } });
      }
      data.email = email.trim().toLowerCase();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    const admin = await prisma.admin.update({
      where: { id: req.admin.adminId }, data, select: ADMIN_SELECT,
    });

    return res.status(200).json({
      admin,
      // The email IS the login. Changing it and not saying so is how an admin
      // locks themselves out at the next login screen.
      emailChanged: data.email !== undefined,
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: { message: 'Another admin already uses that email' } });
    }
    if (error?.code === 'P2025') {
      return res.status(401).json({ error: { message: 'This admin account no longer exists' } });
    }
    console.error('updateAdminProfile error:', error);
    return res.status(500).json({ error: { message: 'Failed to update your profile' } });
  }
}


const MIN_PASSWORD_LENGTH = 8;

// POST /admin/me/password   { currentPassword, newPassword }
//
// The current password is required even though the caller already holds a
// valid token. A token left open on a shared machine is exactly the case this
// guards, and it is the one moment where proving who is at the keyboard costs
// nothing.
async function changeAdminPassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: { message: 'currentPassword and newPassword are required' },
      });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: { message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.adminId } });
    if (!admin) {
      return res.status(401).json({ error: { message: 'This admin account no longer exists' } });
    }

    const matches = await bcrypt.compare(currentPassword, admin.password);
    if (!matches) {
      // 401, and worded as the current password rather than "invalid
      // credentials" — the admin is already logged in, so the only useful
      // information is which field is wrong.
      return res.status(401).json({ error: { message: 'Your current password is incorrect' } });
    }

    if (await bcrypt.compare(newPassword, admin.password)) {
      return res.status(400).json({ error: { message: 'The new password must be different from the current one' } });
    }

    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });

    // A fresh token, so the panel can carry on without a re-login.
    //
    // ponytail: tokens minted before this change stay valid until they expire
    // (8h), because admin auth is stateless — there is no session row to
    // revoke. Fine for "I want a better password", not enough for "my password
    // leaked". Add a tokenVersion column to the admins table and check it in
    // authenticateAdmin if that second case ever comes up.
    const token = jwt.sign({ adminId: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });

    return res.status(200).json({
      message: 'Password changed',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch (error) {
    console.error('changeAdminPassword error:', error);
    return res.status(500).json({ error: { message: 'Failed to change your password' } });
  }
}


module.exports = { adminLogin, getAdminProfile, updateAdminProfile, changeAdminPassword };