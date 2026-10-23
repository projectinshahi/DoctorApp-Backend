
const prisma = require('../db');

// Shared helper: computes subscription status for a given user + their selected course
async function getSubscriptionInfo(userId, selectedCourseId, selectedCourseAccessType) {
  if (!selectedCourseId) {
    return {
      isPremiumCourse: false,
      hasPaid: false,
    };
  }

  const isPremiumCourse = selectedCourseAccessType === 'premium';

  if (!isPremiumCourse) {
    return {
      isPremiumCourse: false,
      hasPaid: true, // free courses don't need payment
    };
  }

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId,
      courseId: selectedCourseId,
      isActive: true,
      endDate: { gte: new Date() },
    },
  });

  return {
    isPremiumCourse: true,
    hasPaid: !!activeSubscription,
    subscription: activeSubscription ?? null,
  };
}

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
      },
    });

    if (!user) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const subscriptionInfo = await getSubscriptionInfo(
      userId,
      user.selectedCourseId,
      user.selectedCourse?.accessType
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
      },
    });

    const subscriptionInfo = await getSubscriptionInfo(
      userId,
      updatedUser.selectedCourseId,
      updatedUser.selectedCourse?.accessType
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
// Play Store require. Progress, attempts, saved items, comments, reports,
// notifications, FCM tokens and daily quizzes cascade from the user row;
// sessions and subscriptions do not, so they are deleted first, in the same
// transaction — a failure part way leaves the account untouched rather than
// half-erased.
//
// Subscriptions go too: the student asked for every detail removed, and a
// payment row keyed to their id is one. Signing in with Google again later
// creates a new, empty account.
async function deleteAccount(req, res) {
  try {
    const userId = req.user.userId;
    const deletedAt = new Date();

    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    console.log(`[account] user ${userId} deleted at ${deletedAt.toISOString()}`);
    return res.status(200).json({ deleted: true, deletedAt });
  } catch (error) {
    console.error('deleteAccount error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the account' } });
  }
}

module.exports = { getProfile, updateProfile, deleteAccount };