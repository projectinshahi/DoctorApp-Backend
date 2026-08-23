const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { validateSubjectAndTopic } = require('./questionBank.controller');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_QUIZ_STATUSES = ['active', 'inactive'];

const QUIZ_SELECT = {
  id: true,
  title: true,
  subjectId: true,
  topicId: true,
  examTag: true,
  questionCount: true,
  status: true,
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  lesson: { select: { id: true, title: true } },
  createdAt: true,
  updatedAt: true,
};

// The whole point of a Quiz: it stores a *filter*, and the question set is
// resolved from the bank at read time. Questions added to the bank later are
// picked up automatically, and nothing is ever written back to Question.
function questionPoolWhere(quiz) {
  const where = {
    subjectId: quiz.subjectId,
    topicId: quiz.topicId,
    status: 'active',
  };
  if (quiz.examTag) {
    where.tags = { some: { tag: { name: quiz.examTag } } };
  }
  return where;
}

// Same shape the client sees, minus `isCorrect` — see serveLessonQuizQuestions.
const PUBLIC_OPTION_SELECT = {
  id: true,
  optionText: true,
  optionImageUrl: true,
  displayOrder: true,
};

// ─────────────────────────── validation helpers ───────────────────────────

function readExamTag(body) {
  if (body.examTag === undefined) return { provided: false, value: null };
  if (body.examTag === null) return { provided: true, value: null };
  if (typeof body.examTag !== 'string') {
    return { provided: true, value: null, error: 'examTag must be a string or null' };
  }
  const value = body.examTag.trim();
  if (value.length === 0) return { provided: true, value: null };
  return { provided: true, value };
}

function readQuestionCount(body) {
  if (body.questionCount === undefined) return { provided: false, value: null };
  if (body.questionCount === null) return { provided: true, value: null };
  const value = Number(body.questionCount);
  if (!Number.isInteger(value) || value < 1) {
    return { provided: true, value: null, error: 'questionCount must be a positive integer or null' };
  }
  return { provided: true, value };
}

// ─────────────────────────── quizzes ───────────────────────────

// POST /api/quizzes
async function createQuiz(req, res) {
  try {
    const { title, subjectId, topicId, status } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: { message: 'Title is required' } });
    }

    const subjectTopicError = await validateSubjectAndTopic(Number(subjectId), Number(topicId));
    if (subjectTopicError) {
      return res.status(400).json({ error: { message: subjectTopicError } });
    }

    if (status !== undefined && !VALID_QUIZ_STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUIZ_STATUSES.join(', ')}` } });
    }

    const tag = readExamTag(req.body);
    if (tag.error) return res.status(400).json({ error: { message: tag.error } });

    const count = readQuestionCount(req.body);
    if (count.error) return res.status(400).json({ error: { message: count.error } });

    const quiz = await prisma.quiz.create({
      data: {
        title: title.trim(),
        subjectId: Number(subjectId),
        topicId: Number(topicId),
        examTag: tag.value,
        questionCount: count.value,
        status: status ?? 'active',
      },
      select: QUIZ_SELECT,
    });

    return res.status(201).json({ quiz });
  } catch (error) {
    console.error('Create quiz error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the quiz' } });
  }
}

// GET /api/quizzes
// Filters combine cumulatively (AND), same as listQuestions.
async function listQuizzes(req, res) {
  try {
    const where = {};

    if (req.query.subjectId !== undefined) {
      const subjectId = Number(req.query.subjectId);
      if (!Number.isInteger(subjectId)) {
        return res.status(400).json({ error: { message: 'subjectId must be an integer' } });
      }
      where.subjectId = subjectId;
    }

    if (req.query.topicId !== undefined) {
      const topicId = Number(req.query.topicId);
      if (!Number.isInteger(topicId)) {
        return res.status(400).json({ error: { message: 'topicId must be an integer' } });
      }
      where.topicId = topicId;
    }

    if (req.query.examTag !== undefined) {
      const examTag = String(req.query.examTag).trim();
      if (examTag.length === 0) {
        return res.status(400).json({ error: { message: 'examTag must be a non-empty string' } });
      }
      where.examTag = examTag;
    }

    if (req.query.status !== undefined) {
      if (!VALID_QUIZ_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUIZ_STATUSES.join(', ')}` } });
      }
      where.status = req.query.status;
    }

    const quizzes = await prisma.quiz.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: QUIZ_SELECT,
    });

    return res.status(200).json({ quizzes });
  } catch (error) {
    console.error('List quizzes error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching quizzes' } });
  }
}

// GET /api/quizzes/:id
// Carries a live pool count so the admin sees how many questions this filter
// actually matches before linking it to a lesson.
async function getQuiz(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: QUIZ_SELECT });
    if (!quiz) {
      return res.status(404).json({ error: { message: 'Quiz not found' } });
    }

    const { availableQuestions, isPinned } = await countAvailableQuestions(quiz);

    return res.status(200).json({
      quiz: {
        ...quiz,
        // "manual" means the admin pinned specific questions; "filter" means it
        // takes whatever matches subject+topic+examTag. The client needs this to
        // know whether a question picker or a filter editor is the right UI.
        mode: isPinned ? 'manual' : 'filter',
        availableQuestions,
        // Flags a quiz that promises more questions than the bank can supply.
        servedQuestions: quiz.questionCount
          ? Math.min(quiz.questionCount, availableQuestions)
          : availableQuestions,
        isUnderfilled: quiz.questionCount !== null && availableQuestions < quiz.questionCount,
      },
    });
  } catch (error) {
    console.error('Get quiz error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the quiz' } });
  }
}

// PATCH /api/quizzes/:id
async function updateQuiz(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const existing = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Quiz not found' } });
    }

    const { title, subjectId, topicId, status } = req.body;
    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: { message: 'Title must be a non-empty string' } });
      }
      data.title = title.trim();
    }

    // subject and topic are validated together against the post-update state,
    // so changing only one of them still has to land on a valid pair.
    if (subjectId !== undefined || topicId !== undefined) {
      const nextSubjectId = subjectId !== undefined ? Number(subjectId) : existing.subjectId;
      const nextTopicId = topicId !== undefined ? Number(topicId) : existing.topicId;
      const subjectTopicError = await validateSubjectAndTopic(nextSubjectId, nextTopicId);
      if (subjectTopicError) {
        return res.status(400).json({ error: { message: subjectTopicError } });
      }
      data.subjectId = nextSubjectId;
      data.topicId = nextTopicId;
    }

    if (status !== undefined) {
      if (!VALID_QUIZ_STATUSES.includes(status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUIZ_STATUSES.join(', ')}` } });
      }
      data.status = status;
    }

    const tag = readExamTag(req.body);
    if (tag.error) return res.status(400).json({ error: { message: tag.error } });
    if (tag.provided) data.examTag = tag.value;

    const count = readQuestionCount(req.body);
    if (count.error) return res.status(400).json({ error: { message: count.error } });
    if (count.provided) data.questionCount = count.value;

    const quiz = await prisma.quiz.update({ where: { id: quizId }, data, select: QUIZ_SELECT });

    return res.status(200).json({ quiz });
  } catch (error) {
    console.error('Update quiz error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the quiz' } });
  }
}

// DELETE /api/quizzes/:id
// Only deletable while no lesson points at it — otherwise deactivate.
async function deleteQuiz(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const existing = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, lesson: { select: { id: true, title: true } } },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Quiz not found' } });
    }

    if (existing.lesson) {
      return res.status(409).json({
        error: {
          message: `This quiz is linked to lesson ${existing.lesson.id} ("${existing.lesson.title}") and cannot be deleted. Unlink it from the lesson first, or deactivate the quiz instead (PATCH /api/quizzes/:id).`,
        },
      });
    }

    await prisma.quiz.delete({ where: { id: quizId } });

    return res.status(200).json({ message: 'Quiz deleted successfully', quizId });
  } catch (error) {
    console.error('Delete quiz error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the quiz' } });
  }
}

// ─────────────────────────── serving ───────────────────────────

// What a student is allowed to see: no `isCorrect`, no `explanation`.
const PUBLIC_QUESTION_SELECT = {
  id: true,
  questionText: true,
  questionImageUrl: true,
  difficulty: true,
  marksCorrect: true,
  marksIncorrect: true,
  options: { select: PUBLIC_OPTION_SELECT, orderBy: { displayOrder: 'asc' } },
};

// The admin preview adds the answer key back. Only ever reached through an
// admin-authenticated route.
const ADMIN_QUESTION_SELECT = {
  ...PUBLIC_QUESTION_SELECT,
  explanation: true,
  options: {
    select: { ...PUBLIC_OPTION_SELECT, isCorrect: true },
    orderBy: { displayOrder: 'asc' },
  },
  tags: { select: { tag: { select: { id: true, name: true } } } },
};

// Resolves a quiz's filter into the actual question rows. One place, so the
// admin preview and the student serve can never drift apart on which
// questions a quiz means.
/**
 * A quiz resolves one of two ways, and which one is not a setting — it is
 * whether the admin pinned any questions.
 *
 *   pinned rows exist -> serve exactly those, in the admin's order
 *   none              -> fall back to the subject+topic+examTag filter
 *
 * The fallback is what every spreadsheet-built quiz uses, so pinning is purely
 * additive: an existing quiz keeps behaving identically until someone picks
 * questions for it.
 */
async function resolveQuizQuestions(quiz, { includeAnswers = false } = {}) {
  const select = includeAnswers ? ADMIN_QUESTION_SELECT : PUBLIC_QUESTION_SELECT;

  const pinned = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id, question: { status: 'active' } },
    orderBy: [{ displayOrder: 'asc' }, { questionId: 'asc' }],
    select: { question: { select } },
  });

  if (pinned.length > 0) {
    // questionCount still caps a pinned quiz, but never reshuffles it — the
    // admin chose an order and a truncated quiz must respect its own start.
    const questions = pinned.map((row) => row.question);
    return quiz.questionCount ? questions.slice(0, quiz.questionCount) : questions;
  }

  const poolWhere = questionPoolWhere(quiz);

  // A count-capped quiz samples ids first; an uncapped one takes the whole
  // pool in a stable order.
  const where = quiz.questionCount
    ? { id: { in: await sampleQuestionIds(poolWhere, quiz.questionCount) } }
    : poolWhere;

  return prisma.question.findMany({
    where,
    select,
    orderBy: { id: 'asc' },
  });
}

/** How many active questions a quiz can draw on, whichever mode it is in. */
async function countAvailableQuestions(quiz) {
  const pinned = await prisma.quizQuestion.count({
    where: { quizId: quiz.id, question: { status: 'active' } },
  });
  if (pinned > 0) return { availableQuestions: pinned, isPinned: true };

  const availableQuestions = await prisma.question.count({ where: questionPoolWhere(quiz) });
  return { availableQuestions, isPinned: false };
}

// Picks `count` ids out of the pool at random.
// ponytail: loads every matching id to sample in JS. Fine for a topic-sized
// pool (hundreds); swap for `ORDER BY random() LIMIT n` raw SQL if a pool
// ever runs to tens of thousands.
async function sampleQuestionIds(where, count) {
  const ids = (await prisma.question.findMany({ where, select: { id: true } })).map((q) => q.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

// GET /api/lessons/:id/quiz-questions
// The answer key never leaves the server: `isCorrect` is deliberately absent
// from the option select, so scoring has to happen server-side.
async function serveLessonQuizQuestions(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, type: true, quiz: { select: QUIZ_SELECT } },
    });
    if (!lesson) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }
    if (!lesson.quiz) {
      return res.status(409).json({ error: { message: 'This lesson has no quiz linked' } });
    }
    if (lesson.quiz.status !== 'active') {
      return res.status(409).json({ error: { message: 'The quiz linked to this lesson is inactive' } });
    }

    const { quiz } = lesson;
    const questions = await resolveQuizQuestions(quiz);

    return res.status(200).json({
      lessonId: lesson.id,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subjectId: quiz.subjectId,
        topicId: quiz.topicId,
        examTag: quiz.examTag,
        questionCount: quiz.questionCount,
      },
      totalQuestions: questions.length,
      totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
      questions,
    });
  } catch (error) {
    console.error('Serve lesson quiz questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching quiz questions' } });
  }
}

// GET /api/quizzes/:id/preview
// Admin-only: the same question set a student would get, WITH the answer key,
// so the admin can review a quiz before publishing the lesson that serves it.
async function previewQuizQuestions(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: QUIZ_SELECT });
    if (!quiz) {
      return res.status(404).json({ error: { message: 'Quiz not found' } });
    }

    const [questions, availableQuestions] = await Promise.all([
      resolveQuizQuestions(quiz, { includeAnswers: true }),
      prisma.question.count({ where: questionPoolWhere(quiz) }),
    ]);

    return res.status(200).json({
      quiz,
      availableQuestions,
      isUnderfilled: quiz.questionCount !== null && availableQuestions < quiz.questionCount,
      totalQuestions: questions.length,
      totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
      questions: questions.map((q) => {
        const { tags = [], ...rest } = q;
        return {
          ...rest,
          tagNames: tags.map((qt) => qt.tag.name),
          correctOptionId: (rest.options || []).find((o) => o.isCorrect)?.id ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('Preview quiz questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while previewing the quiz' } });
  }
}

// ─────────────────── pinned questions (manual quizzes) ───────────────────

/**
 * Reads a questionIds array and checks every id exists. Returns them
 * de-duplicated in the caller's order, because that order becomes displayOrder.
 */
async function readQuestionIds(body) {
  const { questionIds } = body;
  if (!Array.isArray(questionIds)) {
    return { error: 'questionIds must be an array' };
  }

  const ids = [];
  for (const raw of questionIds) {
    const id = Number(raw);
    if (!Number.isInteger(id)) return { error: `questionIds must contain integers, got ${JSON.stringify(raw)}` };
    if (!ids.includes(id)) ids.push(id);   // first occurrence wins the position
  }

  if (ids.length === 0) return { ids: [] };

  const found = await prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const foundIds = new Set(found.map((q) => q.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { error: `Questions not found: ${missing.join(', ')}` };
  }

  return { ids };
}

// GET /api/quizzes/:id/questions
// The admin's editing view of a manual quiz: every pinned question with its
// answer key, in the pinned order. A filter quiz returns an empty list and
// mode "filter" — it has nothing pinned to edit.
async function listQuizQuestions(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: QUIZ_SELECT });
    if (!quiz) return res.status(404).json({ error: { message: 'Quiz not found' } });

    const rows = await prisma.quizQuestion.findMany({
      where: { quizId },
      orderBy: [{ displayOrder: 'asc' }, { questionId: 'asc' }],
      select: { displayOrder: true, question: { select: ADMIN_QUESTION_SELECT } },
    });

    return res.status(200).json({
      quizId,
      mode: rows.length > 0 ? 'manual' : 'filter',
      totalQuestions: rows.length,
      questions: rows.map((row) => ({ ...row.question, displayOrder: row.displayOrder })),
    });
  } catch (error) {
    console.error('List quiz questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching quiz questions' } });
  }
}

// PUT /api/quizzes/:id/questions   body: { questionIds: [...] }
// Replaces the whole pinned set. Array order becomes display order, so this is
// also how reordering works — send the full list in the order you want.
// An empty array unpins everything and returns the quiz to filter mode.
async function setQuizQuestions(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true } });
    if (!quiz) return res.status(404).json({ error: { message: 'Quiz not found' } });

    const parsed = await readQuestionIds(req.body);
    if (parsed.error) return res.status(400).json({ error: { message: parsed.error } });

    // Replace wholesale inside a transaction: a half-applied reorder would
    // leave the quiz serving a mix of the old and new sets.
    await prisma.$transaction([
      prisma.quizQuestion.deleteMany({ where: { quizId } }),
      prisma.quizQuestion.createMany({
        data: parsed.ids.map((questionId, index) => ({ quizId, questionId, displayOrder: index })),
      }),
    ]);

    return res.status(200).json({
      quizId,
      mode: parsed.ids.length > 0 ? 'manual' : 'filter',
      totalQuestions: parsed.ids.length,
      questionIds: parsed.ids,
    });
  } catch (error) {
    console.error('Set quiz questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while setting quiz questions' } });
  }
}

// POST /api/quizzes/:id/questions   body: { questionIds: [...] }
// Appends to the end of the pinned set, skipping ids already pinned.
async function addQuizQuestions(req, res) {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz id' } });
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true } });
    if (!quiz) return res.status(404).json({ error: { message: 'Quiz not found' } });

    const parsed = await readQuestionIds(req.body);
    if (parsed.error) return res.status(400).json({ error: { message: parsed.error } });

    const existing = await prisma.quizQuestion.findMany({
      where: { quizId },
      select: { questionId: true, displayOrder: true },
    });
    const alreadyPinned = new Set(existing.map((row) => row.questionId));
    const nextOrder = existing.reduce((max, row) => Math.max(max, row.displayOrder + 1), 0);

    const toAdd = parsed.ids.filter((id) => !alreadyPinned.has(id));
    if (toAdd.length > 0) {
      await prisma.quizQuestion.createMany({
        data: toAdd.map((questionId, index) => ({ quizId, questionId, displayOrder: nextOrder + index })),
      });
    }

    return res.status(200).json({
      quizId,
      added: toAdd.length,
      skipped: parsed.ids.length - toAdd.length,
      totalQuestions: alreadyPinned.size + toAdd.length,
    });
  } catch (error) {
    console.error('Add quiz questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while adding quiz questions' } });
  }
}

// DELETE /api/quizzes/:id/questions/:questionId
// Unpins one question. The question itself is untouched — it stays in the bank
// and in any other quiz that pinned it.
async function removeQuizQuestion(req, res) {
  try {
    const quizId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(quizId) || !Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid quiz or question id' } });
    }

    const removed = await prisma.quizQuestion.deleteMany({ where: { quizId, questionId } });
    if (removed.count === 0) {
      return res.status(404).json({ error: { message: 'That question is not pinned to this quiz' } });
    }

    const remaining = await prisma.quizQuestion.count({ where: { quizId } });
    return res.status(200).json({
      quizId,
      questionId,
      totalQuestions: remaining,
      // Unpinning the last one hands the quiz back to its filter.
      mode: remaining > 0 ? 'manual' : 'filter',
    });
  } catch (error) {
    console.error('Remove quiz question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while removing the question' } });
  }
}

module.exports = {
  listQuizQuestions,
  setQuizQuestions,
  addQuizQuestions,
  removeQuizQuestion,
  createQuiz,
  listQuizzes,
  getQuiz,
  updateQuiz,
  deleteQuiz,
  serveLessonQuizQuestions,
  previewQuizQuestions,
  // Reused by selected-course.controller.js for the student-facing serve.
  resolveQuizQuestions,
  countAvailableQuestions,
  // Exported for quiz.test.js — pure, no DB.
  questionPoolWhere,
  readExamTag,
  readQuestionCount,
};
