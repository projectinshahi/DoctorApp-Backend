// backend/src/controllers/selected-course.controller.js
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const { resolveQuizQuestions } = require('./quiz.controller');

// Free lessons and free previews are always open. A premium lesson tied to
// plans needs *one of* them; one with no plans accepts any active subscription
// for the course. Exported so the decision table is testable.
function isLessonUnlocked(lesson, paidPlanIds) {
  if (lesson.accessType !== 'premium' || lesson.isFreePreview) return true;
  const planIds = lessonPlanIds(lesson);
  if (planIds.length > 0) {
    return planIds.some((id) => paidPlanIds.has(id));
  }
  return paidPlanIds.size > 0;
}

// Accepts either a shaped lesson (`planIds`) or a raw Prisma row
// (`lessonPlans`), so callers don't all have to flatten first.
function lessonPlanIds(lesson) {
  if (Array.isArray(lesson.planIds)) return lesson.planIds;
  if (Array.isArray(lesson.lessonPlans)) return lesson.lessonPlans.map((lp) => lp.plan?.id ?? lp.planId);
  return [];
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
            quizId: true,
            quiz: { select: { id: true, title: true, questionCount: true, status: true } },
            lessonPlans: {
              select: { plan: { select: { id: true, title: true, price: true, durationDays: true } } },
            },
          },
        },
      },
    });

    const shaped = chapters.map((ch) => ({
      ...ch,
      lessons: ch.lessons.map((l) => {
        const unlocked = isLessonUnlocked(l, paidPlanIds);
        const { lessonPlans = [], ...rest } = l;
        const plans = lessonPlans.map((lp) => lp.plan);
        const base = { ...rest, plans, planIds: plans.map((p) => p.id) };
        return unlocked
          ? { ...base, locked: false }
          : { ...base, videoUrl: null, noteUrl: null, content: null, quiz: null, locked: true };
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

// GET /api/users/me/lessons/:id
// One lesson for the student's detail screen. A locked lesson still comes back
// (200, media stripped) carrying the plan needed to unlock it, so the paywall
// sheet has its price without a second call.
async function getStudentLesson(req, res) {
  try {
    const userId = req.user.userId;
    const lessonId = Number(req.params.id);

    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedCourseId: true, selectedCourseTypeId: true },
    });

    if (!user?.selectedCourseId) {
      return res.status(409).json({
        error: { message: 'Select a course before opening a lesson' },
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true, title: true, description: true, type: true, content: true,
        videoUrl: true, thumbnailUrl: true, noteUrl: true, noteFileType: true,
        displayOrder: true, isFreePreview: true, accessType: true, status: true,
        quizId: true,
        quiz: { select: { id: true, title: true, questionCount: true, status: true } },
        lessonPlans: {
          select: {
            plan: { select: { id: true, title: true, description: true, price: true, durationDays: true } },
          },
        },
        chapter: {
          select: { id: true, title: true, courseId: true, courseTypeId: true },
        },
      },
    });

    // Draft/archived lessons don't exist as far as students are concerned.
    if (!lesson || lesson.status !== 'published') {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    // Must belong to what this student actually selected, or one student could
    // read another course's lessons by guessing ids.
    const belongs = user.selectedCourseTypeId
      ? lesson.chapter.courseTypeId === user.selectedCourseTypeId
      : lesson.chapter.courseId === user.selectedCourseId;

    if (!belongs) {
      return res.status(403).json({
        error: { message: 'This lesson is not part of your selected course' },
      });
    }

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

    const unlocked = isLessonUnlocked(lesson, paidPlanIds);
    const { status, lessonPlans = [], ...rest } = lesson;
    const requiredPlans = lessonPlans.map((lp) => lp.plan);

    return res.status(200).json({
      lesson: unlocked
        ? { ...rest, plans: requiredPlans, planIds: requiredPlans.map((p) => p.id), locked: false }
        : {
            ...rest,
            plans: requiredPlans,
            planIds: requiredPlans.map((p) => p.id),
            videoUrl: null,
            noteUrl: null,
            content: null,
            quiz: null,
            locked: true,
          },
      // What to offer in the paywall: the plans that unlock this lesson, or
      // all course plans when it accepts any subscription.
      requiredPlans: unlocked ? [] : requiredPlans,
      // Legacy single-plan field, kept for older clients.
      requiredPlan: unlocked || requiredPlans.length === 0 ? null : requiredPlans[0],
      unlockOptions:
        unlocked || requiredPlans.length > 0
          ? []
          : await prisma.plan.findMany({
              where: { courseId: user.selectedCourseId, isActive: true },
              orderBy: { price: 'asc' },
              select: { id: true, title: true, description: true, price: true, durationDays: true },
            }),
    });
  } catch (error) {
    console.error('getStudentLesson error:', error);
    return res.status(500).json({ error: { message: 'Failed to load lesson' } });
  }
}


// GET /api/users/me/lessons/:id/quiz-questions
// The student-facing twin of the admin serve endpoint. Same three gates as
// getStudentLesson — published, belongs to the selected course, unlocked —
// because a quiz is lesson content and must not bypass the paywall.
async function getStudentQuizQuestions(req, res) {
  try {
    const userId = req.user.userId;
    const lessonId = Number(req.params.id);

    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selectedCourseId: true, selectedCourseTypeId: true },
    });

    if (!user?.selectedCourseId) {
      return res.status(409).json({ error: { message: 'Select a course before opening a lesson' } });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true, title: true, type: true, status: true, accessType: true, isFreePreview: true,
        lessonPlans: { select: { planId: true, plan: { select: { id: true, title: true, price: true, durationDays: true } } } },
        chapter: { select: { courseId: true, courseTypeId: true } },
        quiz: {
          select: { id: true, title: true, subjectId: true, topicId: true, examTag: true, questionCount: true, status: true },
        },
      },
    });

    if (!lesson || lesson.status !== 'published') {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const belongs = user.selectedCourseTypeId
      ? lesson.chapter.courseTypeId === user.selectedCourseTypeId
      : lesson.chapter.courseId === user.selectedCourseId;

    if (!belongs) {
      return res.status(403).json({ error: { message: 'This lesson is not part of your selected course' } });
    }

    const activeSubs = await prisma.subscription.findMany({
      where: { userId, courseId: user.selectedCourseId, isActive: true, endDate: { gte: new Date() } },
      select: { planId: true },
    });

    if (!isLessonUnlocked(lesson, new Set(activeSubs.map((sub) => sub.planId)))) {
      return res.status(403).json({
        error: { message: 'This lesson is locked. Subscribe to unlock it.' },
        requiredPlans: lesson.lessonPlans.map((lp) => lp.plan),
      });
    }

    if (!lesson.quiz) {
      return res.status(409).json({ error: { message: 'This lesson has no quiz linked' } });
    }
    if (lesson.quiz.status !== 'active') {
      return res.status(409).json({ error: { message: 'The quiz linked to this lesson is inactive' } });
    }

    // includeAnswers stays false — the answer key never reaches a student.
    const questions = await resolveQuizQuestions(lesson.quiz);

    return res.status(200).json({
      lessonId: lesson.id,
      quiz: {
        id: lesson.quiz.id,
        title: lesson.quiz.title,
        questionCount: lesson.quiz.questionCount,
      },
      totalQuestions: questions.length,
      totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
      questions,
    });
  } catch (error) {
    console.error('getStudentQuizQuestions error:', error);
    return res.status(500).json({ error: { message: 'Failed to load quiz questions' } });
  }
}

module.exports = { getSelectedCourseContent, getStudentLesson, getStudentQuizQuestions, isLessonUnlocked };
