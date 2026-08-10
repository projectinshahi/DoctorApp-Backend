// backend/src/controllers/selected-course.controller.js
const { PrismaClient } = require('../generated/prisma');

const prisma = new PrismaClient();

// GET /api/profile/selected-course
// Returns the course + exam type the logged-in user picked (User.selectedCourseId /
// User.selectedCourseTypeId), along with that exam type's chapters -> lessons.
async function getSelectedCourseDetails(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { selectedCourseId: true, selectedCourseTypeId: true },
    });

    if (!user || !user.selectedCourseId) {
      // Not an error — the user just hasn't picked a course yet.
      return res.json({ course: null, courseType: null });
    }

    const course = await prisma.course.findUnique({
      where: { id: user.selectedCourseId },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        accessType: true,
        status: true,
      },
    });

    let courseType = null;
    if (user.selectedCourseTypeId) {
      courseType = await prisma.courseType.findUnique({
        where: { id: user.selectedCourseTypeId },
        select: {
          id: true,
          title: true,
          description: true,
          accessType: true,
          status: true,
          chapters: {
            orderBy: { displayOrder: 'asc' },
            select: {
              id: true,
              title: true,
              displayOrder: true,
              lessons: {
                orderBy: { displayOrder: 'asc' },
                select: {
                  id: true,
                  title: true,
                  type: true,
                  isFreePreview: true,
                  displayOrder: true,
                },
              },
            },
          },
        },
      });
    }

    return res.json({ course, courseType });
  } catch (err) {
    console.error('getSelectedCourseDetails error:', err);
    return res.status(500).json({ message: 'Failed to load selected course' });
  }
}

module.exports = { getSelectedCourseDetails };