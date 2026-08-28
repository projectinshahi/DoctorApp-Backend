// The home screen: one call, module cards with counts, and the two "continue
// where you left off" rows.
//
// Every count is scoped to the student's SELECTED course. A global count would
// be meaningless — a student studying DHA does not care that the bank holds
// 4000 MOHAP questions.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const { isLessonUnlocked } = require('./selected-course.controller');

/**
 * completed / total as a whole percent.
 *
 * 100 is reserved for actually finished. Plain rounding turns 199 of 200 into
 * "100%", so a student sees a completed module with a lesson still in it and
 * cannot tell which. Capping at 99 until done keeps the badge honest.
 */
function percent(done, total) {
  if (total === 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.round((done / total) * 100));
}

/**
 * Every published lesson in the student's selected course, split by type.
 *
 * Chapters hang off either the course type (an exam like DHA) or the course
 * itself, which is why the where clause branches — the same rule the content
 * tree uses.
 */
async function courseLessons(user) {
  return prisma.lesson.findMany({
    where: {
      status: 'published',
      chapter: user.selectedCourseTypeId
        ? { courseTypeId: user.selectedCourseTypeId }
        : { courseId: user.selectedCourseId },
    },
    select: {
      id: true, title: true, type: true, thumbnailUrl: true, quizId: true,
      accessType: true, isFreePreview: true,
      lessonPlans: { select: { planId: true } },
      quiz: { select: { id: true, title: true, subjectId: true, topicId: true, examTag: true } },
      chapter: { select: { id: true, title: true } },
    },
  });
}

// GET /api/users/me/home
async function getHome(req, res) {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        selectedCourseId: true,
        selectedCourseTypeId: true,
        selectedCourse: { select: { id: true, title: true, thumbnail: true, accessType: true } },
      },
    });

    // A fresh account with no course is a real state, not an error. Zeroed
    // modules let the home screen render its cards instead of an error page.
    if (!user?.selectedCourseId) {
      return res.status(200).json({
        course: null,
        courseType: null,
        hasPaid: false,
        modules: {
          videos: { total: 0, completed: 0, inProgress: 0, percent: 0 },
          notes: { total: 0, completed: 0, percent: 0 },
          qbank: { totalQuestions: 0, attempted: 0, correct: 0, accuracy: 0 },
          tests: { total: 0, attempted: 0, completed: 0, percent: 0 },
          bookmarks: { questions: 0, lessons: 0 },
        },
        continueWatching: null,
        continueQuiz: null,
      });
    }

    const [courseType, activeSubs, lessons] = await Promise.all([
      user.selectedCourseTypeId
        ? prisma.courseType.findUnique({
            where: { id: user.selectedCourseTypeId },
            select: { id: true, title: true, description: true },
          })
        : null,
      prisma.subscription.findMany({
        where: { userId, courseId: user.selectedCourseId, isActive: true, endDate: { gte: new Date() } },
        select: { planId: true },
      }),
      courseLessons(user),
    ]);

    const paidPlanIds = new Set(activeSubs.map((s) => s.planId));
    const hasPaid = user.selectedCourse.accessType !== 'premium' || paidPlanIds.size > 0;

    const videoLessons = lessons.filter((l) => l.type === 'video');
    const noteLessons = lessons.filter((l) => l.type === 'note');
    const quizLessons = lessons.filter((l) => l.type === 'quiz');
    const lessonIds = lessons.map((l) => l.id);
    const quizLessonIds = quizLessons.map((l) => l.id);

    const [progress, attempts, savedQuestions, savedLessons] = await Promise.all([
      prisma.lessonProgress.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true, completed: true, lastPositionSeconds: true, updatedAt: true },
      }),
      prisma.quizAttempt.findMany({
        where: { userId, lessonId: { in: quizLessonIds }, answers: { some: {} } },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true, lessonId: true, questionIds: true, completedAt: true, startedAt: true,
          answers: { select: { questionId: true, isCorrect: true } },
        },
      }),
      prisma.savedQuestion.count({ where: { userId } }),
      prisma.savedLesson.count({ where: { userId, lesson: { status: 'published' } } }),
    ]);

    const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
    const countDone = (ls) => ls.filter((l) => progressByLesson.get(l.id)?.completed).length;

    // "Started but not finished" is its own number — a card showing only
    // completed makes a student who is halfway through look like they have
    // done nothing.
    const videosInProgress = videoLessons.filter((l) => {
      const p = progressByLesson.get(l.id);
      return p && !p.completed && p.lastPositionSeconds > 0;
    }).length;

    // QBank totals: how many distinct questions this student has answered,
    // across every attempt, against the pool their quizzes can draw on.
    const answeredQuestionIds = new Set();
    const correctQuestionIds = new Set();
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        answeredQuestionIds.add(answer.questionId);
        if (answer.isCorrect) correctQuestionIds.add(answer.questionId);
      }
    }

    // The pool is every active question in the subject+topic pairs this
    // course's quizzes point at. Counting the whole bank would inflate the
    // denominator with questions no quiz here can ever serve.
    const pairs = quizLessons
      .filter((l) => l.quiz)
      .map((l) => ({ subjectId: l.quiz.subjectId, topicId: l.quiz.topicId }));
    const totalQuestions = pairs.length === 0
      ? 0
      : await prisma.question.count({ where: { status: 'active', OR: pairs } });

    const attemptsByLesson = new Map();
    for (const a of attempts) {
      if (!attemptsByLesson.has(a.lessonId)) attemptsByLesson.set(a.lessonId, []);
      attemptsByLesson.get(a.lessonId).push(a);
    }
    const testsCompleted = quizLessons
      .filter((l) => (attemptsByLesson.get(l.id) ?? []).some((a) => a.completedAt)).length;

    // Continue watching: the most recently touched unfinished video.
    const lastTouched = progress
      .filter((p) => !p.completed && p.lastPositionSeconds > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const continueLesson = lastTouched
      ? lessons.find((l) => l.id === lastTouched.lessonId)
      : null;

    const openAttempt = attempts.find((a) => !a.completedAt);
    const openLesson = openAttempt
      ? quizLessons.find((l) => l.id === openAttempt.lessonId)
      : null;

    return res.status(200).json({
      course: user.selectedCourse,
      courseType,
      hasPaid,
      modules: {
        videos: {
          total: videoLessons.length,
          completed: countDone(videoLessons),
          inProgress: videosInProgress,
          percent: percent(countDone(videoLessons), videoLessons.length),
        },
        notes: {
          total: noteLessons.length,
          completed: countDone(noteLessons),
          percent: percent(countDone(noteLessons), noteLessons.length),
        },
        qbank: {
          totalQuestions,
          attempted: answeredQuestionIds.size,
          correct: correctQuestionIds.size,
          // Accuracy is out of what they answered, not out of the bank —
          // otherwise it only ever falls as the bank grows.
          accuracy: percent(correctQuestionIds.size, answeredQuestionIds.size),
        },
        tests: {
          total: quizLessons.length,
          attempted: attemptsByLesson.size,
          completed: testsCompleted,
          percent: percent(testsCompleted, quizLessons.length),
        },
        bookmarks: { questions: savedQuestions, lessons: savedLessons },
      },
      continueWatching: continueLesson
        ? {
            lessonId: continueLesson.id,
            title: continueLesson.title,
            thumbnailUrl: continueLesson.thumbnailUrl,
            chapter: continueLesson.chapter,
            lastPositionSeconds: lastTouched.lastPositionSeconds,
            locked: !isLessonUnlocked(continueLesson, paidPlanIds),
          }
        : null,
      continueQuiz: openAttempt
        ? {
            attemptId: openAttempt.id,
            lessonId: openAttempt.lessonId,
            title: openLesson ? openLesson.title : null,
            totalQuestions: openAttempt.questionIds.length,
            answeredCount: openAttempt.answers.length,
            remainingCount: openAttempt.questionIds.length - openAttempt.answers.length,
          }
        : null,
    });
  } catch (error) {
    console.error('getHome error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the home screen' } });
  }
}


// PUT /api/users/me/lessons/:id/progress
// Body: { completed?: boolean, lastPositionSeconds?: number }
async function saveProgress(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, status: true },
    });
    if (!lesson || lesson.status !== 'published') {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const { completed, lastPositionSeconds } = req.body ?? {};

    if (completed !== undefined && typeof completed !== 'boolean') {
      return res.status(400).json({ error: { message: 'completed must be a boolean' } });
    }
    if (lastPositionSeconds !== undefined
        && (!Number.isFinite(Number(lastPositionSeconds)) || Number(lastPositionSeconds) < 0)) {
      return res.status(400).json({ error: { message: 'lastPositionSeconds must be a non-negative number' } });
    }

    // Partial: sending only a position must not silently un-complete a lesson,
    // and marking complete must not reset the resume point to zero.
    const data = {};
    if (completed !== undefined) data.completed = completed;
    if (lastPositionSeconds !== undefined) data.lastPositionSeconds = Math.floor(Number(lastPositionSeconds));

    const saved = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: req.user.userId, lessonId } },
      create: { userId: req.user.userId, lessonId, ...data },
      update: data,
    });

    return res.status(200).json({
      lessonId,
      completed: saved.completed,
      lastPositionSeconds: saved.lastPositionSeconds,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error('saveProgress error:', error);
    return res.status(500).json({ error: { message: 'Failed to save progress' } });
  }
}

module.exports = { getHome, saveProgress, percent };
