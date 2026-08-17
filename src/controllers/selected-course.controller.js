// backend/src/controllers/selected-course.controller.js
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Free lessons and free previews are always open. A premium lesson tied to a
// plan needs *that* plan; one with no plan accepts any active subscription for
// the course. Exported so the decision table is testable.
function isLessonUnlocked(lesson, paidPlanIds) {
  if (lesson.accessType !== 'premium' || lesson.isFreePreview) return true;
  if (lesson.planId !== null && lesson.planId !== undefined) {
    return paidPlanIds.has(lesson.planId);
  }
  return paidPlanIds.size > 0;
}

// GET /api/users/me/selection/content
// Full tree for the student's selected exam: courseType -> chapters -> lessons
// (video, notes, thumbnail). Locked lessons come back with the media stripped.
async function getSelectedCourseContent(req, res) {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        selectedCourseId: true,
        selectedCourseTypeId: true,
        selectedCourse: {
          select: { id: true, title: true, thumbnail: true, accessType: true },
        },
      },
    });

    if (!user?.selectedCourseId) {
      return res.status(200).json({ course: null, courseType: null, chapters: [] });
    }

    // Which plans has this student actually paid for and not yet outlived?
    const activeSubs = await prisma.subscription.findMany({
      where: {
        userId,
        courseId: user.selectedCourseId,
        isActive: true,
        endDate: { gte: new Date() },
      },
      select: { planId: true },
    });
    const paidPlanIds = new Set(activeSubs.map((s) => s.planId));

    // Course-level flag for the UI banner. A free course needs no purchase.
    const hasPaid =
      user.selectedCourse.accessType !== 'premium' || paidPlanIds.size > 0;

    const courseType = user.selectedCourseTypeId
      ? await prisma.courseType.findUnique({
          where: { id: user.selectedCourseTypeId },
          select: { id: true, title: true, description: true, accessType: true },
        })
      : null;

    // Chapters hang off either the course type (exam) or the course itself.
    const chapters = await prisma.chapter.findMany({
      where: user.selectedCourseTypeId
        ? { courseTypeId: user.selectedCourseTypeId }
        : { courseId: user.selectedCourseId },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        title: true,
        displayOrder: true,
        lessons: {
          where: { status: 'published' },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            content: true,
            videoUrl: true,
            thumbnailUrl: true,
            noteUrl: true,
            noteFileType: true,
            displayOrder: true,
            isFreePreview: true,
            accessType: true,
            planId: true,
            plan: { select: { id: true, title: true, price: true, durationDays: true } },
          },
        },
      },
    });

    const shaped = chapters.map((ch) => ({
      ...ch,
      lessons: ch.lessons.map((l) => {
        return isLessonUnlocked(l, paidPlanIds)
          ? { ...l, locked: false }
          : { ...l, videoUrl: null, noteUrl: null, content: null, locked: true };
      }),
    }));

    return res.status(200).json({
      course: user.selectedCourse,
      courseType,
      hasPaid,
      chapters: shaped,
    });
  } catch (err) {
    console.error('getSelectedCourseContent error:', err);
    return res.status(500).json({ error: { message: 'Failed to load selected course content' } });
  }
}

module.exports = { getSelectedCourseContent, isLessonUnlocked };
