
const prisma = require('../db');
const { getSubscriptionStatus, FULL_ACCESS_SELECT } = require('../services/access.service');

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
        // Owner override, read from the DB so getSubscriptionStatus needs no
        // user query of its own.
        ...FULL_ACCESS_SELECT,
      },
    });

    if (!user || !user.selectedCourseId) {
      return res.status(200).json({
        hasCourseSelected: false,
        isPremiumCourse: false,
        hasPaid: false,
      });
    }

    // Free course -> hasPaid true; premium -> any live subscription. Same
    // helper the profile uses, so the two can no longer drift apart.
    const status = await getSubscriptionStatus(
      userId, user.selectedCourseId, user.selectedCourse.accessType, { user });

    return res.status(200).json({ hasCourseSelected: true, ...status });
  } catch (error) {
    console.error('Get subscription status error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while checking subscription status' },
    });
  }
}




module.exports = { getMySubscriptionStatus };