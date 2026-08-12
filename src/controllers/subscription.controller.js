const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// GET /api/users/me/subscription-status
// Tells the student: is my currently selected course premium,
// and if so, do I have an active paid subscription for it?
async function getMySubscriptionStatus(req, res) {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        selectedCourseId: true,
        selectedCourse: { select: { accessType: true } },
      },
    });

    if (!user || !user.selectedCourseId) {
      return res.status(200).json({
        hasCourseSelected: false,
        isPremiumCourse: false,
        hasPaid: false,
      });
    }

    const isPremiumCourse = user.selectedCourse.accessType === 'premium';

    if (!isPremiumCourse) {
      return res.status(200).json({
        hasCourseSelected: true,
        isPremiumCourse: false,
        hasPaid: true, // free courses don't need payment
      });
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        courseId: user.selectedCourseId,
        isActive: true,
        endDate: { gte: new Date() },
      },
    });

    return res.status(200).json({
      hasCourseSelected: true,
      isPremiumCourse: true,
      hasPaid: !!activeSubscription,
      subscription: activeSubscription ?? null,
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while checking subscription status' },
    });
  }
}




module.exports = { getMySubscriptionStatus };