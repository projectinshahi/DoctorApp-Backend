// Question of the Day.
//
// The set is DERIVED from (courseId, date), never stored. A seeded shuffle
// means every student on a given day sees the same questions, tomorrow's set
// exists without anyone scheduling it, and there is no cron job to forget.
//
// Reloading must not reroll. That is the rule the obvious implementation
// breaks: `ORDER BY random() LIMIT 10` gives a student a fresh set every time
// they pull to refresh, which is both a cheat and a confusing bug.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DAILY_QUESTION_COUNT = 10;

// The app's day, not the server's. Render runs UTC; the students are in the
// Gulf, so a UTC boundary would roll the quiz over at 4am local — mid-revision
// for exactly the people who study late.
const APP_UTC_OFFSET_MINUTES = 4 * 60;

/** Today in the app's timezone, as YYYY-MM-DD. */
function appToday(now = new Date()) {
  const shifted = new Date(now.getTime() + APP_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** A DATE column wants midnight UTC of that calendar day. */
function dateKey(ymd) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function shiftDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}


/**
 * mulberry32 — a small, fast PRNG with a 32-bit seed.
 *
 * Any deterministic generator would do; the requirement is only that the same
 * seed gives the same sequence on every machine and every restart, which
 * Math.random cannot promise.
 */
function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The day's set: a Fisher-Yates shuffle driven by a seed made of the course
 * and the date.
 *
 * `ids` must arrive in a stable order — sorted — or the same seed would pick
 * different questions depending on what order the database happened to return
 * them in, which is the whole property this function exists to provide.
 */
function pickDaily(ids, courseId, ymd, count = DAILY_QUESTION_COUNT) {
  const pool = [...ids].sort((a, b) => a - b);
  const rand = seededRandom(hashSeed(`${courseId}:${ymd}`));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}


/**
 * Consecutive days completed, counting back from today.
 *
 * Today not being done yet does not break the streak — it is not over. Looking
 * only at yesterday-and-back until today is finished is what stops a student
 * being told at 9am that they lost a 40-day run.
 */
function streakFrom(completedDates, today) {
  const done = new Set(completedDates);
  let day = done.has(today) ? today : shiftDays(today, -1);
  let streak = 0;
  while (done.has(day)) {
    streak += 1;
    day = shiftDays(day, -1);
  }
  return streak;
}


/**
 * Every active question reachable from a course.
 *
 * Two routes, unioned, because both are in use: subjects linked directly to
 * the course, and the subjects behind the quizzes its lessons point at. Only
 * the second is populated on the live data, and a daily quiz that returned
 * nothing because the first is empty would look broken rather than unconfigured.
 */
async function courseQuestionIds(courseId) {
  const [course, quizLessons] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, status: true, subjects: { select: { id: true } } },
    }),
    prisma.lesson.findMany({
      where: {
        type: 'quiz', quizId: { not: null }, status: 'published',
        chapter: { OR: [{ courseId }, { courseType: { courseId } }] },
      },
      select: { quiz: { select: { subjectId: true } } },
    }),
  ]);
  if (!course) return { course: null, ids: [] };

  const subjectIds = [...new Set([
    ...course.subjects.map((s) => s.id),
    ...quizLessons.map((l) => l.quiz?.subjectId).filter((x) => x != null),
  ])];

  if (subjectIds.length === 0) return { course, ids: [] };

  // Topic is deliberately ignored: a day's set should roam the whole course,
  // not one corner of it.
  const questions = await prisma.question.findMany({
    where: { status: 'active', subjectId: { in: subjectIds }, options: { some: {} } },
    select: { id: true },
  });
  return { course, ids: questions.map((q) => q.id) };
}


/** Options as a student may see them before answering: no answer key. */
const PUBLIC_OPTIONS = {
  select: { id: true, optionText: true, optionImageUrl: true, displayOrder: true },
  orderBy: { displayOrder: 'asc' },
};


// GET /api/users/me/courses/:courseId/daily-quiz
async function getDailyQuiz(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }
    const userId = req.user.userId;
    const today = appToday();

    const { course, ids } = await courseQuestionIds(courseId);
    if (!course) return res.status(404).json({ error: { message: 'Course not found' } });

    if (ids.length === 0) {
      return res.status(200).json({
        course: { id: course.id, title: course.title },
        date: today, available: false,
        reason: 'No questions are set up for this course yet.',
        totalQuestions: 0, questions: [], answers: [],
      });
    }

    // Freeze on first open. Deriving it again later would change the paper
    // under a student if an admin touched the bank mid-morning.
    let attempt = await prisma.dailyQuizAttempt.findUnique({
      where: { userId_courseId_quizDate: { userId, courseId, quizDate: dateKey(today) } },
      include: { answers: true },
    });

    if (!attempt) {
      attempt = await prisma.dailyQuizAttempt.create({
        data: {
          userId, courseId, quizDate: dateKey(today),
          questionIds: pickDaily(ids, courseId, today),
        },
        include: { answers: true },
      });
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: attempt.questionIds } },
      select: {
        id: true, questionText: true, questionImageUrl: true, difficulty: true,
        marksCorrect: true, marksIncorrect: true,
        subject: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        options: PUBLIC_OPTIONS,
      },
    });
    // Serve in the frozen order, not the database's.
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ordered = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean);

    const completedDates = (await prisma.dailyQuizAttempt.findMany({
      where: { userId, courseId, completedAt: { not: null } },
      orderBy: { quizDate: 'desc' },
      take: 400,
      select: { quizDate: true },
    })).map((a) => a.quizDate.toISOString().slice(0, 10));

    const answered = attempt.answers.length;

    return res.status(200).json({
      course: { id: course.id, title: course.title },
      date: today,
      available: true,
      attemptId: attempt.id,
      totalQuestions: ordered.length,
      answeredCount: answered,
      remainingCount: ordered.length - answered,
      completed: attempt.completedAt !== null,
      completedAt: attempt.completedAt,
      currentStreak: streakFrom(completedDates, today),
      // So the app can say "new set in 4h 12m" without guessing the boundary.
      nextSetAt: `${shiftDays(today, 1)}T00:00:00+04:00`,
      questions: ordered,
      // Restores a half-finished set: which were answered, and how they went.
      answers: attempt.answers.map((a) => ({
        questionId: a.questionId,
        selectedOptionId: a.selectedOptionId,
        isCorrect: a.isCorrect,
        marksAwarded: a.marksAwarded,
      })),
    });
  } catch (error) {
    console.error('getDailyQuiz error:', error);
    return res.status(500).json({ error: { message: "Failed to load today's quiz" } });
  }
}


// POST /api/users/me/courses/:courseId/daily-quiz/answers
// { questionId, optionId }
async function answerDailyQuestion(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }
    const userId = req.user.userId;
    const today = appToday();

    const questionId = Number(req.body?.questionId);
    const optionId = Number(req.body?.optionId);
    if (!Number.isInteger(questionId) || !Number.isInteger(optionId)) {
      return res.status(400).json({ error: { message: 'questionId and optionId are required' } });
    }

    const attempt = await prisma.dailyQuizAttempt.findUnique({
      where: { userId_courseId_quizDate: { userId, courseId, quizDate: dateKey(today) } },
      include: { answers: { select: { questionId: true } } },
    });
    if (!attempt) {
      return res.status(409).json({ error: { message: "Open today's quiz first" } });
    }
    if (attempt.completedAt) {
      return res.status(409).json({ error: { message: "You have already finished today's quiz" } });
    }
    if (!attempt.questionIds.includes(questionId)) {
      return res.status(400).json({ error: { message: "That question is not in today's set" } });
    }
    // One shot per question. Re-answering after seeing the explanation would
    // make every score a perfect one.
    if (attempt.answers.some((a) => a.questionId === questionId)) {
      return res.status(409).json({ error: { message: 'You have already answered this question' } });
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true, explanation: true, marksCorrect: true, marksIncorrect: true,
        options: { select: { id: true, optionText: true, isCorrect: true, displayOrder: true }, orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!question) return res.status(404).json({ error: { message: 'Question not found' } });

    const chosen = question.options.find((o) => o.id === optionId);
    if (!chosen) {
      return res.status(400).json({ error: { message: 'That option does not belong to this question' } });
    }

    const correct = question.options.find((o) => o.isCorrect) ?? null;
    const isCorrect = chosen.isCorrect;
    const marksAwarded = isCorrect ? question.marksCorrect : question.marksIncorrect;

    await prisma.dailyQuizAnswer.create({
      data: { attemptId: attempt.id, questionId, selectedOptionId: optionId, isCorrect, marksAwarded },
    });

    const answeredCount = attempt.answers.length + 1;

    // The answer key is released HERE and only here — after the student has
    // committed. Sending it with the question would put it in the payload for
    // anyone who opens the network tab.
    return res.status(200).json({
      questionId,
      selectedOptionId: optionId,
      isCorrect,
      correctOptionId: correct?.id ?? null,
      explanation: question.explanation,
      marksAwarded,
      answeredCount,
      remainingCount: attempt.questionIds.length - answeredCount,
      allAnswered: answeredCount === attempt.questionIds.length,
    });
  } catch (error) {
    console.error('answerDailyQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the answer' } });
  }
}


// POST /api/users/me/courses/:courseId/daily-quiz/finish
async function finishDailyQuiz(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }
    const userId = req.user.userId;
    const today = appToday();

    const attempt = await prisma.dailyQuizAttempt.findUnique({
      where: { userId_courseId_quizDate: { userId, courseId, quizDate: dateKey(today) } },
      include: { answers: true },
    });
    if (!attempt) return res.status(409).json({ error: { message: "Open today's quiz first" } });

    // Idempotent: finishing twice returns the same sheet rather than a 409.
    // The app calls this when the last question is answered AND when the
    // student taps Finish, and those can both happen.
    const completed = attempt.completedAt
      ? attempt
      : await prisma.dailyQuizAttempt.update({
          where: { id: attempt.id },
          data: { completedAt: new Date() },
          include: { answers: true },
        });

    const questions = await prisma.question.findMany({
      where: { id: { in: attempt.questionIds } },
      select: {
        id: true, questionText: true, explanation: true,
        subject: { select: { name: true } }, topic: { select: { name: true } },
        options: { select: { id: true, optionText: true, isCorrect: true, displayOrder: true }, orderBy: { displayOrder: 'asc' } },
      },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const answerBy = new Map(completed.answers.map((a) => [a.questionId, a]));

    const results = attempt.questionIds.map((id) => {
      const q = byId.get(id);
      if (!q) return null;
      const a = answerBy.get(id) ?? null;
      return {
        questionId: id,
        questionText: q.questionText,
        subject: q.subject?.name ?? null,
        topic: q.topic?.name ?? null,
        options: q.options,
        selectedOptionId: a?.selectedOptionId ?? null,
        correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
        // Skipped is its own state, not a wrong answer — it scores zero rather
        // than the negative mark.
        answered: a !== null,
        isCorrect: a?.isCorrect ?? false,
        marksAwarded: a?.marksAwarded ?? 0,
        explanation: q.explanation,
      };
    }).filter(Boolean);

    const correctCount = results.filter((r) => r.isCorrect).length;
    const answeredCount = results.filter((r) => r.answered).length;

    const completedDates = (await prisma.dailyQuizAttempt.findMany({
      where: { userId, courseId, completedAt: { not: null } },
      orderBy: { quizDate: 'desc' }, take: 400, select: { quizDate: true },
    })).map((x) => x.quizDate.toISOString().slice(0, 10));

    return res.status(200).json({
      date: today,
      attemptId: attempt.id,
      completedAt: completed.completedAt,
      totalQuestions: results.length,
      answeredCount,
      correctCount,
      wrongCount: answeredCount - correctCount,
      skippedCount: results.length - answeredCount,
      score: results.reduce((sum, r) => sum + r.marksAwarded, 0),
      accuracy: answeredCount === 0 ? 0 : Math.round((correctCount / answeredCount) * 100),
      currentStreak: streakFrom(completedDates, today),
      results,
    });
  } catch (error) {
    console.error('finishDailyQuiz error:', error);
    return res.status(500).json({ error: { message: 'Failed to finish the quiz' } });
  }
}


// GET /api/users/me/courses/:courseId/daily-quiz/history?days=30
async function dailyQuizHistory(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }
    const userId = req.user.userId;
    const today = appToday();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    const attempts = await prisma.dailyQuizAttempt.findMany({
      where: { userId, courseId, quizDate: { gte: dateKey(shiftDays(today, -(days - 1))) } },
      orderBy: { quizDate: 'desc' },
      include: { answers: { select: { isCorrect: true, marksAwarded: true } } },
    });

    const completedDates = attempts.filter((a) => a.completedAt)
      .map((a) => a.quizDate.toISOString().slice(0, 10));

    return res.status(200).json({
      days,
      currentStreak: streakFrom(completedDates, today),
      // Every day in the window, including the missed ones — a calendar with
      // gaps is the point of a history screen.
      history: Array.from({ length: days }, (_, i) => {
        const ymd = shiftDays(today, -i);
        const a = attempts.find((x) => x.quizDate.toISOString().slice(0, 10) === ymd);
        if (!a) return { date: ymd, attempted: false, completed: false };
        const correct = a.answers.filter((x) => x.isCorrect).length;
        return {
          date: ymd,
          attempted: true,
          completed: a.completedAt !== null,
          totalQuestions: a.questionIds.length,
          answeredCount: a.answers.length,
          correctCount: correct,
          score: a.answers.reduce((sum, x) => sum + x.marksAwarded, 0),
        };
      }),
    });
  } catch (error) {
    console.error('dailyQuizHistory error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the history' } });
  }
}



/**
 * The home card's view of today, WITHOUT starting it.
 *
 * `getDailyQuiz` creates the attempt on first call — that is what freezes the
 * set. The home screen must not do that: a student who opened the app and
 * never tapped the card would have a started, unfinished quiz and a broken
 * streak by midnight. So this reads the attempt if one exists and reports
 * `notStarted` otherwise.
 */
async function dailyQuizSummary(userId, courseId) {
  const today = appToday();

  const [attempt, completedRows] = await Promise.all([
    prisma.dailyQuizAttempt.findUnique({
      where: { userId_courseId_quizDate: { userId, courseId, quizDate: dateKey(today) } },
      include: { answers: { select: { isCorrect: true, marksAwarded: true } } },
    }),
    prisma.dailyQuizAttempt.findMany({
      where: { userId, courseId, completedAt: { not: null } },
      orderBy: { quizDate: 'desc' }, take: 400, select: { quizDate: true },
    }),
  ]);

  const streak = streakFrom(
    completedRows.map((a) => a.quizDate.toISOString().slice(0, 10)), today,
  );

  if (!attempt) {
    return {
      date: today, state: 'notStarted',
      totalQuestions: DAILY_QUESTION_COUNT,
      answeredCount: 0, correctCount: null, score: null,
      currentStreak: streak,
      nextSetAt: `${shiftDays(today, 1)}T00:00:00+04:00`,
    };
  }

  const correct = attempt.answers.filter((a) => a.isCorrect).length;
  return {
    date: today,
    state: attempt.completedAt ? 'completed' : 'inProgress',
    totalQuestions: attempt.questionIds.length,
    answeredCount: attempt.answers.length,
    remainingCount: attempt.questionIds.length - attempt.answers.length,
    correctCount: attempt.completedAt ? correct : null,
    score: attempt.completedAt ? attempt.answers.reduce((n, a) => n + a.marksAwarded, 0) : null,
    currentStreak: streak,
    nextSetAt: `${shiftDays(today, 1)}T00:00:00+04:00`,
  };
}


module.exports = {
  getDailyQuiz, answerDailyQuestion, finishDailyQuiz, dailyQuizHistory,
  dailyQuizSummary,
  // Exported for dailyQuiz.test.js — pure, no DB.
  pickDaily, streakFrom, appToday, shiftDays,
};
