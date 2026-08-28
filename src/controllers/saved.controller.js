// Bookmarks for questions and lessons, moved off the device.
//
// The whole point is that they survive sign-out and follow the account, so
// everything here is keyed on the authenticated user and nothing trusts a
// client-supplied userId.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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
// Unpublished lessons are dropped: a bookmark must not resurrect content an
// admin has taken down. `count` reflects what is actually returned.
async function listSavedLessons(req, res) {
  try {
    const rows = await prisma.savedLesson.findMany({
      where: { userId: req.user.userId, lesson: { status: 'published' } },
      orderBy: { savedAt: 'desc' },
      select: {
        savedAt: true,
        lesson: {
          select: {
            id: true, title: true, description: true, type: true,
            thumbnailUrl: true, accessType: true, isFreePreview: true, quizId: true,
            chapter: { select: { id: true, title: true } },
          },
        },
      },
    });

    return res.status(200).json({
      count: rows.length,
      lessons: rows.map((row) => ({ ...row.lesson, savedAt: row.savedAt })),
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
