// Marrow-style quiz taking: start an attempt, answer one question at a time
// with immediate feedback, then review the whole thing at the end.
//
// The alternative — collect every answer in the app and post them all at once —
// loses the run if the app is killed mid-quiz, and cannot show feedback per
// question without shipping the answer key to the client. Both are the reasons
// this is server-side and incremental.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const { resolveQuizQuestions } = require('./quiz.controller');
const { loadStudentQuiz } = require('./selected-course.controller');


// The answer key, for a set of ids already frozen into an attempt.
//
// Deliberately does NOT filter on status. The attempt's questionIds are the
// authorization — they were resolved through the quiz's own filter when it
// started. Re-applying `status: active` here would make a question deactivated
// mid-quiz disappear from the review, silently dropping the mark the student
// had already earned for it.
const ATTEMPT_QUESTION_SELECT = {
  id: true,
  questionText: true,
  questionImageUrl: true,
  difficulty: true,
  marksCorrect: true,
  marksIncorrect: true,
  explanation: true,
  options: {
    select: { id: true, optionText: true, optionImageUrl: true, displayOrder: true, isCorrect: true },
    orderBy: { displayOrder: 'asc' },
  },
};

function fetchAttemptQuestions(questionIds) {
  if (questionIds.length === 0) return Promise.resolve([]);
  return prisma.question.findMany({
    where: { id: { in: questionIds } },
    select: ATTEMPT_QUESTION_SELECT,
    orderBy: { id: 'asc' },
  });
}

/** Strips the answer key. The same shape the serve endpoint returns. */
function publicQuestion(question) {
  return {
    id: question.id,
    questionText: question.questionText,
    questionImageUrl: question.questionImageUrl,
    difficulty: question.difficulty,
    marksCorrect: question.marksCorrect,
    marksIncorrect: question.marksIncorrect,
    options: question.options.map((opt) => ({
      id: opt.id,
      optionText: opt.optionText,
      optionImageUrl: opt.optionImageUrl,
      displayOrder: opt.displayOrder,
    })),
  };
}

/** The answer key for one question, plus how this student did on it. */
function reviewedQuestion(question, answer) {
  const correctOption = question.options.find((opt) => opt.isCorrect);
  return {
    questionId: question.id,
    questionText: question.questionText,
    questionImageUrl: question.questionImageUrl,
    selectedOptionId: answer ? answer.selectedOptionId : null,
    correctOptionId: correctOption ? correctOption.id : null,
    isCorrect: answer ? answer.isCorrect : false,
    answered: Boolean(answer),
    marksAwarded: answer ? answer.marksAwarded : 0,
    explanation: question.explanation,
    options: question.options,
  };
}

/** Totals for the review screen, derived from the stored rows. */
function summarise(questions, answers) {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const results = questions.map((q) => reviewedQuestion(q, byQuestion.get(q.id)));

  return {
    totalQuestions: results.length,
    totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
    score: results.reduce((sum, r) => sum + r.marksAwarded, 0),
    correctCount: results.filter((r) => r.isCorrect).length,
    wrongCount: results.filter((r) => r.answered && !r.isCorrect).length,
    skippedCount: results.filter((r) => !r.answered).length,
    results,
  };
}

/**
 * Loads an attempt and proves it belongs to this student.
 *
 * Without the userId check any student could read any attempt id and get the
 * answer key for a quiz they never opened.
 */
async function loadOwnAttempt(userId, attemptId) {
  if (!Number.isInteger(attemptId)) {
    return { error: { status: 400, body: { error: { message: 'Invalid attempt id' } } } };
  }

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: { answers: true, quiz: { select: { id: true, title: true } } },
  });

  if (!attempt || attempt.userId !== userId) {
    return { error: { status: 404, body: { error: { message: 'Attempt not found' } } } };
  }

  return { attempt };
}


// POST /api/users/me/lessons/:id/quiz-attempts
// Starts a run and freezes the questions it serves.
async function startAttempt(req, res) {
  try {
    const gate = await loadStudentQuiz(req.user.userId, Number(req.params.id));
    if (gate.error) return res.status(gate.error.status).json(gate.error.body);
    const { lesson } = gate;

    // An unfinished attempt is resumed rather than replaced. Leaving the app
    // mid-quiz and coming back is normal, and starting over would silently
    // discard answers the student already gave.
    const open = await prisma.quizAttempt.findFirst({
      where: { userId: req.user.userId, lessonId: lesson.id, completedAt: null },
      orderBy: { startedAt: 'desc' },
      include: { answers: { select: { questionId: true, selectedOptionId: true } } },
    });

    if (open) {
      const questions = await fetchAttemptQuestions(open.questionIds);
      return res.status(200).json({
        attemptId: open.id,
        resumed: true,
        lessonId: lesson.id,
        quiz: { id: lesson.quiz.id, title: lesson.quiz.title },
        totalQuestions: questions.length,
        totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
        answered: open.answers,
        questions: questions.map(publicQuestion),
      });
    }

    const questions = await resolveQuizQuestions(lesson.quiz);
    if (questions.length === 0) {
      return res.status(409).json({ error: { message: 'This quiz has no questions yet' } });
    }

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: req.user.userId,
        quizId: lesson.quiz.id,
        lessonId: lesson.id,
        questionIds: questions.map((q) => q.id),
      },
    });

    return res.status(201).json({
      attemptId: attempt.id,
      resumed: false,
      lessonId: lesson.id,
      quiz: { id: lesson.quiz.id, title: lesson.quiz.title },
      totalQuestions: questions.length,
      totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
      answered: [],
      questions,
    });
  } catch (error) {
    console.error('startAttempt error:', error);
    return res.status(500).json({ error: { message: 'Failed to start the quiz' } });
  }
}


// POST /api/users/me/quiz-attempts/:attemptId/answers
// Body: { questionId, optionId }
// Saves one answer and returns the feedback for that question only.
async function saveAnswer(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    if (attempt.completedAt) {
      return res.status(409).json({ error: { message: 'This attempt is already finished' } });
    }

    const questionId = Number(req.body?.questionId);
    const optionId = Number(req.body?.optionId);

    if (!Number.isInteger(questionId) || !Number.isInteger(optionId)) {
      return res.status(400).json({ error: { message: 'questionId and optionId are required' } });
    }
    if (!attempt.questionIds.includes(questionId)) {
      return res.status(400).json({ error: { message: `Question ${questionId} is not part of this attempt` } });
    }

    const [question] = await fetchAttemptQuestions([questionId]);
    if (!question) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    const chosen = question.options.find((opt) => opt.id === optionId);
    if (!chosen) {
      return res.status(400).json({ error: { message: `Option ${optionId} does not belong to question ${questionId}` } });
    }

    const isCorrect = chosen.isCorrect;
    const marksAwarded = isCorrect ? question.marksCorrect : question.marksIncorrect;

    // Upsert, so changing an answer before finishing overwrites rather than
    // failing on the composite primary key.
    const saved = await prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      create: { attemptId: attempt.id, questionId, selectedOptionId: optionId, isCorrect, marksAwarded },
      update: { selectedOptionId: optionId, isCorrect, marksAwarded, answeredAt: new Date() },
    });

    const answeredCount = await prisma.attemptAnswer.count({ where: { attemptId: attempt.id } });

    return res.status(200).json({
      attemptId: attempt.id,
      answeredCount,
      remainingCount: attempt.questionIds.length - answeredCount,
      result: reviewedQuestion(question, saved),
    });
  } catch (error) {
    console.error('saveAnswer error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the answer' } });
  }
}


// POST /api/users/me/quiz-attempts/:attemptId/finish
// Closes the attempt and returns the review screen.
async function finishAttempt(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    // Finishing twice is not an error — a retried request or a back-button
    // should get the same review, not a 409. completedAt is kept from the
    // first call so the timestamp stays honest.
    const closed = attempt.completedAt
      ? attempt
      : await prisma.quizAttempt.update({ where: { id: attempt.id }, data: { completedAt: new Date() } });

    const questions = await fetchAttemptQuestions(attempt.questionIds);

    return res.status(200).json({
      attemptId: attempt.id,
      lessonId: attempt.lessonId,
      quiz: attempt.quiz,
      startedAt: attempt.startedAt,
      completedAt: closed.completedAt,
      ...summarise(questions, attempt.answers),
    });
  } catch (error) {
    console.error('finishAttempt error:', error);
    return res.status(500).json({ error: { message: 'Failed to finish the quiz' } });
  }
}


// GET /api/users/me/quiz-attempts/:attemptId
// Resume an unfinished attempt, or re-open a finished one's review.
async function getAttempt(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    const questions = await fetchAttemptQuestions(attempt.questionIds);

    // An unfinished attempt must not leak the answer key — the student is
    // still taking it. They get their own picks back and nothing more.
    if (!attempt.completedAt) {
      return res.status(200).json({
        attemptId: attempt.id,
        lessonId: attempt.lessonId,
        quiz: attempt.quiz,
        completed: false,
        startedAt: attempt.startedAt,
        totalQuestions: questions.length,
        totalMarks: questions.reduce((sum, q) => sum + q.marksCorrect, 0),
        answered: attempt.answers.map((a) => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId })),
        questions: questions.map(publicQuestion),
      });
    }

    return res.status(200).json({
      attemptId: attempt.id,
      lessonId: attempt.lessonId,
      quiz: attempt.quiz,
      completed: true,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      ...summarise(questions, attempt.answers),
    });
  } catch (error) {
    console.error('getAttempt error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the attempt' } });
  }
}


// GET /api/users/me/lessons/:id/quiz-attempts
// Past runs at this lesson, newest first. Summary rows only.
async function listAttempts(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const attempts = await prisma.quizAttempt.findMany({
      where: { userId: req.user.userId, lessonId },
      orderBy: { startedAt: 'desc' },
      include: { answers: { select: { isCorrect: true, marksAwarded: true } } },
    });

    return res.status(200).json({
      lessonId,
      attempts: attempts.map((a) => ({
        attemptId: a.id,
        quizId: a.quizId,
        completed: Boolean(a.completedAt),
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        totalQuestions: a.questionIds.length,
        answeredCount: a.answers.length,
        correctCount: a.answers.filter((x) => x.isCorrect).length,
        score: a.answers.reduce((sum, x) => sum + x.marksAwarded, 0),
      })),
    });
  } catch (error) {
    console.error('listAttempts error:', error);
    return res.status(500).json({ error: { message: 'Failed to load attempts' } });
  }
}

module.exports = {
  startAttempt,
  saveAnswer,
  finishAttempt,
  getAttempt,
  listAttempts,
  // Exported for quizAttempt.test.js — pure, no DB.
  summarise,
  reviewedQuestion,
};
