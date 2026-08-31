// Bookmarks for questions and lessons, moved off the device.
//
// The whole point is that they survive sign-out and follow the account, so
// everything here is keyed on the authenticated user and nothing trusts a
// client-supplied userId.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Lazily required: selected-course.controller does not import this file, but
// keeping the shape identical between the tree and the bookmark list matters
// more than the import style.
const isLessonUnlocked = (...args) => require('./selected-course.controller').isLessonUnlocked(...args);
const lessonDone = (...args) => require('./selected-course.controller').lessonDone(...args);
const attemptStatusByLesson = (...args) => require('./quizAttempt.controller').attemptStatusByLesson(...args);

/**
 * Which of these questions has the student already answered in a *completed*
 * attempt?
 *
 * This is the gate on revealing the answer key from a bookmark. Without it a
 * student saves a question mid-quiz, opens their bookmark list, and reads the
 * correct option straight out of it — the exact leak the serve endpoint is
 * careful to avoid. Answering it in an attempt they never finished does not
 * count either, or the same trick works one question at a time.
 */
async function earnedQuestionIds(userId, questionIds) {
  if (questionIds.length === 0) return new Set();

  const rows = await prisma.attemptAnswer.findMany({
    where: {
      questionId: { in: questionIds },
      attempt: { userId, completedAt: { not: null } },
    },
    select: { questionId: true },
    distinct: ['questionId'],
  });

  return new Set(rows.map((r) => r.questionId));
}

const SAVED_QUESTION_SELECT = {
  id: true,
  questionText: true,
  questionImageUrl: true,
  difficulty: true,
  marksCorrect: true,
  marksIncorrect: true,
  explanation: true,
  status: true,
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  options: {
    select: { id: true, optionText: true, optionImageUrl: true, displayOrder: true, isCorrect: true },
    orderBy: { displayOrder: 'asc' },
  },
};

/** Strips the answer key unless this student has earned it. */
function shapeSavedQuestion(row, earned) {
  const q = row.question;
  const revealed = earned.has(q.id);
  const correctOption = q.options.find((opt) => opt.isCorrect);

  return {
    questionId: q.id,
    savedAt: row.savedAt,
    questionText: q.questionText,
    questionImageUrl: q.questionImageUrl,
    difficulty: q.difficulty,
    marksCorrect: q.marksCorrect,
    marksIncorrect: q.marksIncorrect,
    subject: q.subject,
    topic: q.topic,
    // `revealed` is what the UI branches on. Both fields are null until then,
    // so a client that forgets to check still cannot show an answer.
    revealed,
    correctOptionId: revealed && correctOption ? correctOption.id : null,
    explanation: revealed ? q.explanation : null,
    options: q.options.map((opt) => ({
      id: opt.id,
      optionText: opt.optionText,
      optionImageUrl: opt.optionImageUrl,
      displayOrder: opt.displayOrder,
      isCorrect: revealed ? opt.isCorrect : null,
    })),
  };
}


// POST /api/users/me/saved-questions   { questionId }
async function saveQuestion(req, res) {
  try {
    const questionId = Number(req.body?.questionId);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'questionId is required' } });
    }

    const exists = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    // Upsert, so a double tap is idempotent instead of a 500 on the primary key.
    await prisma.savedQuestion.upsert({
      where: { userId_questionId: { userId: req.user.userId, questionId } },
      create: { userId: req.user.userId, questionId },
      update: {},
    });

    const count = await prisma.savedQuestion.count({ where: { userId: req.user.userId } });
    return res.status(201).json({ saved: true, questionId, count });
  } catch (error) {
    console.error('saveQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the question' } });
  }
}


// DELETE /api/users/me/saved-questions/:questionId
async function unsaveQuestion(req, res) {
  try {
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    // deleteMany rather than delete: removing a bookmark that is already gone
    // is the desired end state, not a 404 the app has to special-case.
    const { count: removed } = await prisma.savedQuestion.deleteMany({
      where: { userId: req.user.userId, questionId },
    });

    const count = await prisma.savedQuestion.count({ where: { userId: req.user.userId } });
    return res.status(200).json({ saved: false, questionId, removed: removed > 0, count });
  } catch (error) {
    console.error('unsaveQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to remove the bookmark' } });
  }
}


// GET /api/users/me/saved-questions
// `count` is top level so the QBank card can read it without the list.
async function listSavedQuestions(req, res) {
  try {
    const rows = await prisma.savedQuestion.findMany({
      where: { userId: req.user.userId },
      orderBy: { savedAt: 'desc' },
      select: { savedAt: true, question: { select: SAVED_QUESTION_SELECT } },
    });

    const earned = await earnedQuestionIds(req.user.userId, rows.map((r) => r.question.id));

    return res.status(200).json({
      count: rows.length,
      questions: rows.map((row) => shapeSavedQuestion(row, earned)),
    });
  } catch (error) {
    console.error('listSavedQuestions error:', error);
    return res.status(500).json({ error: { message: 'Failed to load saved questions' } });
  }
}


// POST /api/users/me/saved-lessons   { lessonId }
async function saveLesson(req, res) {
  try {
    const lessonId = Number(req.body?.lessonId);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'lessonId is required' } });
    }

    const exists = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    await prisma.savedLesson.upsert({
      where: { userId_lessonId: { userId: req.user.userId, lessonId } },
      create: { userId: req.user.userId, lessonId },
      update: {},
    });

    const count = await prisma.savedLesson.count({ where: { userId: req.user.userId } });
    return res.status(201).json({ saved: true, lessonId, count });
  } catch (error) {
    console.error('saveLesson error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the lesson' } });
  }
}


// DELETE /api/users/me/saved-lessons/:lessonId
async function unsaveLesson(req, res) {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const { count: removed } = await prisma.savedLesson.deleteMany({
      where: { userId: req.user.userId, lessonId },
    });

    const count = await prisma.savedLesson.count({ where: { userId: req.user.userId } });
    return res.status(200).json({ saved: false, lessonId, removed: removed > 0, count });
  } catch (error) {
    console.error('unsaveLesson error:', error);
    return res.status(500).json({ error: { message: 'Failed to remove the bookmark' } });
  }
}


// GET /api/users/me/saved-lessons
//
// Carries the same progress and lock state as the course tree. A bookmark list
// that only had titles would need a second call per row to draw a tick or a
// paywall, which is the N+1 the tree endpoint already exists to avoid.
//
// Unpublished lessons are dropped: a bookmark must not resurrect content an
// admin has taken down. `count` reflects what is actually returned.
async function listSavedLessons(req, res) {
  try {
    const userId = req.user.userId;

    const rows = await prisma.savedLesson.findMany({
      where: { userId, lesson: { status: 'published' } },
      orderBy: { savedAt: 'desc' },
      select: {
        savedAt: true,
        lesson: {
          select: {
            id: true, title: true, description: true, type: true,
            videoUrl: true, noteUrl: true, noteFileType: true,
            thumbnailUrl: true, accessType: true, isFreePreview: true, quizId: true,
            chapter: { select: { id: true, title: true } },
            lessonPlans: {
              select: { plan: { select: { id: true, title: true, price: true, durationDays: true } } },
            },
          },
        },
      },
    });

    if (rows.length === 0) return res.status(200).json({ count: 0, lessons: [] });

    const lessonIds = rows.map((r) => r.lesson.id);
    const quizLessonIds = rows.filter((r) => r.lesson.type === 'quiz').map((r) => r.lesson.id);

    const [user, progressRows, attemptByLesson] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { selectedCourseId: true } }),
      prisma.lessonProgress.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true, completed: true, lastPositionSeconds: true },
      }),
      attemptStatusByLesson(userId, quizLessonIds),
    ]);

    const activeSubs = user?.selectedCourseId
      ? await prisma.subscription.findMany({
          where: { userId, courseId: user.selectedCourseId, isActive: true, endDate: { gte: new Date() } },
          select: { planId: true },
        })
      : [];
    const paidPlanIds = new Set(activeSubs.map((sub) => sub.planId));
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));

    return res.status(200).json({
      count: rows.length,
      lessons: rows.map((row) => {
        const { lessonPlans = [], ...lesson } = row.lesson;
        const plans = lessonPlans.map((lp) => lp.plan);
        const unlocked = isLessonUnlocked(row.lesson, paidPlanIds);
        const progress = progressByLesson.get(lesson.id);
        const attempt = lesson.type === 'quiz' ? attemptByLesson.get(lesson.id) ?? null : null;

        const base = {
          ...lesson,
          savedAt: row.savedAt,
          plans,
          planIds: plans.map((plan) => plan.id),
          attempt,
          completed: lessonDone(row.lesson, progress, attempt),
          lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
          // Every row here is bookmarked by definition. Stated anyway so one
          // lesson model can be reused from the tree without a null check.
          isSaved: true,
        };

        return unlocked
          ? { ...base, locked: false }
          : { ...base, videoUrl: null, noteUrl: null, locked: true };
      }),
    });
  } catch (error) {
    console.error('listSavedLessons error:', error);
    return res.status(500).json({ error: { message: 'Failed to load saved lessons' } });
  }
}

module.exports = {
  saveQuestion,
  unsaveQuestion,
  listSavedQuestions,
  saveLesson,
  unsaveLesson,
  listSavedLessons,
  // Exported for saved.test.js — pure, no DB.
  shapeSavedQuestion,
};
