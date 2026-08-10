const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── Set (or change) the student's currently selected course/exam ──
async function selectCourse(req, res) {
  try {
    const userId = req.user.userId;
    const { courseId, courseTypeId } = req.body;

    if (!courseId && !courseTypeId) {
      return res.status(400).json({
        error: { message: 'At least one of courseId or courseTypeId is required' },
      });
    }

    let validatedCourseId = null;
    let validatedCourseTypeId = null;

    if (courseId) {
      const course = await prisma.course.findUnique({ where: { id: Number(courseId) } });
      if (!course) {
        return res.status(404).json({ error: { message: 'Course not found' } });
      }
      validatedCourseId = course.id;
    }

    if (courseTypeId) {
      const courseType = await prisma.courseType.findUnique({
        where: { id: Number(courseTypeId) },
      });
      if (!courseType) {
        return res.status(404).json({ error: { message: 'Course type not found' } });
      }

      if (courseId && courseType.courseId !== Number(courseId)) {
        return res.status(400).json({
          error: { message: 'courseTypeId does not belong to the given courseId' },
        });
      }

      validatedCourseTypeId = courseType.id;

      if (!courseId) {
        validatedCourseId = courseType.courseId;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        selectedCourseId: validatedCourseId,
        selectedCourseTypeId: validatedCourseTypeId,
      },
      include: {
        selectedCourse: true,
        selectedCourseType: true,
      },
    });

    return res.status(200).json({
      selectedCourse: updatedUser.selectedCourse,
      selectedCourseType: updatedUser.selectedCourseType,
    });
  } catch (error) {
    console.error('Select course error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while selecting the course' },
    });
  }
}

// ── Get the student's currently selected course/exam (for the home screen) ──
async function getSelectedCourse(req, res) {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        selectedCourse: {
          include: { subjects: true },
        },
        selectedCourseType: {
          include: { course: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    return res.status(200).json({
      selectedCourse: user.selectedCourse,
      selectedCourseType: user.selectedCourseType,
    });
  } catch (error) {
    console.error('Get selected course error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching the selected course' },
    });
  }
}

module.exports = { selectCourse, getSelectedCourse };