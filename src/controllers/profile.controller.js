const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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

module.exports = { getProfile, updateProfile };