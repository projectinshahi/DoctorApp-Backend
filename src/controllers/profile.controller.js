
const prisma = require('../db');
const { getSubscriptionStatus } = require('../services/access.service');
const { deleteUserAccount } = require('../services/account.service');

// Subscription status for a user + their selected course. The same helper
// backs GET /users/me/subscription-status.
const getSubscriptionInfo = getSubscriptionStatus;

// GET /api/users/me
async function getProfile(req, res) {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        status: true,
        selectedCourseId: true,
        selectedCourse: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            accessType: true,
          },
        },
        selectedCourseType: {
          select: {
            id: true,
            title: true,
          },
        },
        // Owner override, read from the DB (never the JWT). Additive in the
        // response, and it saves getSubscriptionInfo a user query.
        fullAccess: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const subscriptionInfo = await getSubscriptionInfo(
      userId,
      user.selectedCourseId,
      user.selectedCourse?.accessType,
      { user }
    );

    return res.status(200).json({
      user: {
        ...user,
        subscriptionInfo,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching the profile' },
    });
  }
}

// PUT /api/users/me
async function updateProfile(req, res) {
  try {
    const userId = req.user.userId;
    const { name, phone, avatarUrl } = req.body;

    const data = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          error: { message: 'Name must be a non-empty string' },
        });
      }
      data.name = name.trim();
    }

    if (phone !== undefined) {
      if (phone !== null && typeof phone !== 'string') {
        return res.status(400).json({
          error: { message: 'Phone must be a string' },
        });
      }
      data.phone = phone === null ? null : phone.trim();
    }

    if (avatarUrl !== undefined) {
      if (typeof avatarUrl !== 'string' || avatarUrl.trim().length === 0) {
        return res.status(400).json({
          error: { message: 'avatarUrl must be a non-empty string' },
        });
      }
      data.avatarUrl = avatarUrl.trim();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: { message: 'At least one field (name, phone, avatarUrl) is required' },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        status: true,
        selectedCourseId: true,
        selectedCourse: {
          select: { id: true, title: true, thumbnail: true, accessType: true },
        },
        selectedCourseType: {
          select: { id: true, title: true },
        },
        // Read-only here: `data` above is an allow-list of name / phone /
        // avatarUrl, so a fullAccess field in the body is ignored.
        fullAccess: true,
      },
    });

    const subscriptionInfo = await getSubscriptionInfo(
      userId,
      updatedUser.selectedCourseId,
      updatedUser.selectedCourse?.accessType,
      { user: updatedUser }
    );

    return res.status(200).json({
      user: {
        ...updatedUser,
        subscriptionInfo,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while updating the profile' },
    });
  }
}

// DELETE /api/users/me
//
// Removes the account and everything stored against it, as the App Store and
// Play Store require. What is removed, and why sessions and subscriptions go
// first in one transaction, is in services/account.service.js — shared with
// the admin's DELETE /admin/students/:id so both erase the same rows.
//
// Subscriptions go too: the student asked for every detail removed, and a
// payment row keyed to their id is one. Signing in with Google again later
// creates a new, empty account.
async function deleteAccount(req, res) {
  try {
    const userId = req.user.userId;
    const deletedAt = new Date();

    await deleteUserAccount(userId);

    console.log(`[account] user ${userId} deleted at ${deletedAt.toISOString()}`);
    return res.status(200).json({ deleted: true, deletedAt });
  } catch (error) {
    console.error('deleteAccount error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the account' } });
  }
}

module.exports = { getProfile, updateProfile, deleteAccount };