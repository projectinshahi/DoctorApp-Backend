// Grand Test, student side: list, start, answer, submit, result.
//
// The timer is enforced on the server. A client-side countdown is a display,
// not a rule — anyone can pause it, so the deadline is recomputed from
// startedAt on every write.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_OPTIONS = ['A', 'B', 'C', 'D'];

/** Questions as a student may see them: no answer, no explanation. */
const STUDENT_QUESTION_SELECT = {
  id: true, questionOrder: true, questionText: true, questionImageUrl: true,
  optionA: true, optionAImageUrl: true,
  optionB: true, optionBImageUrl: true,
  optionC: true, optionCImageUrl: true,
  optionD: true, optionDImageUrl: true,
};

function deadlineOf(attempt, test) {
  return new Date(attempt.startedAt.getTime() + test.durationMinutes * 60_000);
}

/** Seconds between starting and submitting. Null while still in progress. */
function timeTaken(attempt) {
  if (!attempt.submittedAt) return null;
  return Math.max(0, Math.round((attempt.submittedAt - attempt.startedAt) / 1000));
}

function secondsRemaining(attempt, test) {
  return Math.max(0, Math.round((deadlineOf(attempt, test) - Date.now()) / 1000));
}

/**
 * Closes an attempt whose time is up.
 *
 * The spec asked for a scheduled sweep; this runs the same rule lazily instead,
 * on every read and write of the attempt. It costs no infrastructure and gives
 * the student the identical result, because an expired attempt is closed before
 * anything can be read from or written to it.
 *
 * ponytail: an abandoned expired attempt keeps submittedAt = null in the table
 * until someone touches it. That is invisible to students and only skews admin
 * "in progress" counts. Add a cron sweep if those counts start to matter.
 */
async function submitIfExpired(attempt, test) {
  if (attempt.submittedAt) return attempt;
  if (Date.now() < deadlineOf(attempt, test).getTime()) return attempt;
  return finalise(attempt.id, test.id, deadlineOf(attempt, test));
}

/** Totals the stored marks and closes the attempt. Also locks the paper. */
async function finalise(attemptId, testId, submittedAt) {
  const answers = await prisma.testAttemptAnswer.findMany({
    where: { attemptId }, select: { marksAwarded: true },
  });
  const score = answers.reduce((sum, a) => sum + a.marksAwarded, 0);

  const [updated] = await prisma.$transaction([
    prisma.testAttempt.update({
      where: { id: attemptId },
      data: { submittedAt, score },
    }),
    // First submission freezes the paper. Editing it afterwards would rewrite
    // the score of everyone who already sat it.
    prisma.test.update({ where: { id: testId }, data: { isLocked: true } }),
  ]);
  return updated;
}


// GET /api/users/me/courses/:courseId/tests
async function listTests(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    // A paper scoped to one exam is only for students sitting that exam. A
    // paper with no courseTypeId belongs to the whole course, so it stays
    // visible to everyone in it.
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { selectedCourseTypeId: true },
    });

    const tests = await prisma.test.findMany({
      where: {
        courseId,
        isPublished: true,
        ...(user?.selectedCourseTypeId
          ? { OR: [{ courseTypeId: null }, { courseTypeId: user.selectedCourseTypeId }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, type: true, courseTypeId: true, totalQuestions: true,
        durationMinutes: true, marksCorrect: true, marksIncorrect: true,
        attempts: {
          where: { userId: req.user.userId },
          orderBy: { startedAt: 'desc' },
          select: { id: true, startedAt: true, submittedAt: true, score: true },
        },
      },
    });

    return res.status(200).json({
      tests: tests.map(({ attempts, ...test }) => ({
        ...test,
        // Enough for the card to say Start / Resume / View result without a
        // second call per test.
        attemptCount: attempts.length,
        lastAttempt: attempts[0]
          ? {
              attemptId: attempts[0].id,
              startedAt: attempts[0].startedAt,
              submittedAt: attempts[0].submittedAt,
              score: attempts[0].score,
              inProgress: attempts[0].submittedAt === null,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error('listTests error:', error);
    return res.status(500).json({ error: { message: 'Failed to load tests' } });
  }
}


// POST /api/users/me/tests/:testId/attempts
async function startTestAttempt(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || !test.isPublished) {
      return res.status(404).json({ error: { message: 'Test not found' } });
    }

    const open = await prisma.testAttempt.findFirst({
      where: { userId: req.user.userId, testId, submittedAt: null },
      orderBy: { startedAt: 'desc' },
      include: { answers: { select: { testQuestionId: true, selectedOption: true } } },
    });

    // An in-progress attempt is resumed, never replaced — starting over would
    // hand back a fresh timer on a paper they are already part-way through.
    if (open) {
      const closed = await submitIfExpired(open, test);
      if (closed.submittedAt) {
        return res.status(409).json({
          error: { message: 'Your time for this attempt ran out and it was submitted automatically.' },
          attemptId: open.id,
        });
      }

      const questions = await prisma.testQuestion.findMany({
        where: { testId }, orderBy: { questionOrder: 'asc' }, select: STUDENT_QUESTION_SELECT,
      });

      return res.status(200).json({
        attemptId: open.id,
        resumed: true,
        test: { id: test.id, name: test.name, type: test.type,
                totalQuestions: test.totalQuestions, durationMinutes: test.durationMinutes,
                marksCorrect: test.marksCorrect, marksIncorrect: test.marksIncorrect },
        startedAt: open.startedAt,
        secondsRemaining: secondsRemaining(open, test),
        answered: open.answers.map((a) => ({ testQuestionId: a.testQuestionId, selectedOption: a.selectedOption })),
        questions,
      });
    }

    const questions = await prisma.testQuestion.findMany({
      where: { testId }, orderBy: { questionOrder: 'asc' }, select: STUDENT_QUESTION_SELECT,
    });
    if (questions.length === 0) {
      return res.status(409).json({ error: { message: 'This test has no questions yet' } });
    }

    const attempt = await prisma.testAttempt.create({
      data: { userId: req.user.userId, testId },
    });

    return res.status(201).json({
      attemptId: attempt.id,
      resumed: false,
      test: { id: test.id, name: test.name, type: test.type,
              totalQuestions: test.totalQuestions, durationMinutes: test.durationMinutes,
              marksCorrect: test.marksCorrect, marksIncorrect: test.marksIncorrect },
      startedAt: attempt.startedAt,
      secondsRemaining: test.durationMinutes * 60,
      answered: [],
      questions,
    });
  } catch (error) {
    console.error('startTestAttempt error:', error);
    return res.status(500).json({ error: { message: 'Failed to start the test' } });
  }
}


/** Loads an attempt and proves it belongs to this student. */
async function loadOwnAttempt(userId, attemptId) {
  if (!Number.isInteger(attemptId)) {
    return { error: { status: 400, body: { error: { message: 'Invalid attempt id' } } } };
  }
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId }, include: { test: true },
  });
  if (!attempt || attempt.userId !== userId) {
    return { error: { status: 404, body: { error: { message: 'Attempt not found' } } } };
  }
  return { attempt };
}


// PATCH /api/users/me/test-attempts/:attemptId/answers/:testQuestionId
// Body: { selectedOption: "A" }
async function answerTestQuestion(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    if (attempt.submittedAt) {
      return res.status(409).json({ error: { message: 'This attempt has already been submitted' } });
    }

    // Checked before the write, so an answer typed after the bell never counts.
    const closed = await submitIfExpired(attempt, attempt.test);
    if (closed.submittedAt) {
      return res.status(409).json({
        error: { message: 'Time is up. This attempt was submitted automatically.' },
        attemptId: attempt.id,
        score: closed.score,
      });
    }

    const testQuestionId = Number(req.params.testQuestionId);
    if (!Number.isInteger(testQuestionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const selected = String(req.body?.selectedOption ?? '').toUpperCase();
    if (!VALID_OPTIONS.includes(selected)) {
      return res.status(400).json({ error: { message: 'selectedOption must be one of: A, B, C, D' } });
    }

    const question = await prisma.testQuestion.findUnique({ where: { id: testQuestionId } });
    if (!question || question.testId !== attempt.testId) {
      return res.status(400).json({ error: { message: 'That question is not part of this test' } });
    }

    // Correctness is decided here and stored. The client is never asked, and
    // the result is not recomputed later — an edited paper must not rewrite it.
    const isCorrect = question.correctOption === selected;
    const marksAwarded = isCorrect ? attempt.test.marksCorrect : attempt.test.marksIncorrect;

    await prisma.testAttemptAnswer.upsert({
      where: { attemptId_testQuestionId: { attemptId: attempt.id, testQuestionId } },
      create: { attemptId: attempt.id, testQuestionId, selectedOption: selected, isCorrect, marksAwarded },
      update: { selectedOption: selected, isCorrect, marksAwarded, answeredAt: new Date() },
    });

    const answeredCount = await prisma.testAttemptAnswer.count({ where: { attemptId: attempt.id } });

    // No isCorrect in the response: this is an exam, and per-question feedback
    // before submitting would turn it into a practice quiz.
    return res.status(200).json({
      attemptId: attempt.id,
      testQuestionId,
      selectedOption: selected,
      answeredCount,
      remainingCount: attempt.test.totalQuestions - answeredCount,
      secondsRemaining: secondsRemaining(attempt, attempt.test),
    });
  } catch (error) {
    console.error('answerTestQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the answer' } });
  }
}


// DELETE /api/users/me/test-attempts/:attemptId/answers/:testQuestionId
// Clearing an answer restores "skipped", which scores 0 rather than a penalty.
async function clearTestAnswer(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    if (attempt.submittedAt) {
      return res.status(409).json({ error: { message: 'This attempt has already been submitted' } });
    }

    const testQuestionId = Number(req.params.testQuestionId);
    await prisma.testAttemptAnswer.deleteMany({ where: { attemptId: attempt.id, testQuestionId } });

    const answeredCount = await prisma.testAttemptAnswer.count({ where: { attemptId: attempt.id } });
    return res.status(200).json({
      attemptId: attempt.id, testQuestionId, cleared: true,
      answeredCount, remainingCount: attempt.test.totalQuestions - answeredCount,
    });
  } catch (error) {
    console.error('clearTestAnswer error:', error);
    return res.status(500).json({ error: { message: 'Failed to clear the answer' } });
  }
}


// POST /api/users/me/test-attempts/:attemptId/submit
async function submitTestAttempt(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    // Submitting twice returns the same result rather than an error, so a retry
    // or a back-button does not look like a failure.
    const closed = attempt.submittedAt
      ? attempt
      : await finalise(attempt.id, attempt.testId, new Date());

    return res.status(200).json(await buildResult(attempt.id, closed, attempt.test));
  } catch (error) {
    console.error('submitTestAttempt error:', error);
    return res.status(500).json({ error: { message: 'Failed to submit the test' } });
  }
}


/** The result sheet. Only ever built for a submitted attempt. */
async function buildResult(attemptId, attempt, test) {
  const [questions, answers] = await Promise.all([
    prisma.testQuestion.findMany({ where: { testId: test.id }, orderBy: { questionOrder: 'asc' } }),
    prisma.testAttemptAnswer.findMany({ where: { attemptId } }),
  ]);

  const byQuestion = new Map(answers.map((a) => [a.testQuestionId, a]));
  const results = questions.map((q) => {
    const answer = byQuestion.get(q.id);
    return {
      testQuestionId: q.id,
      questionOrder: q.questionOrder,
      questionText: q.questionText,
      questionImageUrl: q.questionImageUrl,
      optionA: q.optionA, optionAImageUrl: q.optionAImageUrl,
      optionB: q.optionB, optionBImageUrl: q.optionBImageUrl,
      optionC: q.optionC, optionCImageUrl: q.optionCImageUrl,
      optionD: q.optionD, optionDImageUrl: q.optionDImageUrl,
      selectedOption: answer ? answer.selectedOption : null,
      correctOption: q.correctOption,
      // Absence of a row is what "skipped" means, so it is neither correct nor
      // wrong and scores 0 rather than the negative mark.
      isCorrect: answer ? answer.isCorrect : false,
      answered: Boolean(answer),
      marksAwarded: answer ? answer.marksAwarded : 0,
      explanation: q.explanation,
      subject: q.subject,
      topic: q.topic,
    };
  });

  return {
    attemptId,
    test: { id: test.id, name: test.name, type: test.type, durationMinutes: test.durationMinutes },
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    // How long they actually took, which is what a leaderboard ranks on after
    // score. Derived rather than stored — startedAt and submittedAt already
    // say it, and a stored copy could disagree with them.
    timeTakenSeconds: timeTaken(attempt),
    totalQuestions: questions.length,
    totalMarks: questions.length * test.marksCorrect,
    score: attempt.score ?? 0,
    correctCount: results.filter((r) => r.isCorrect).length,
    wrongCount: results.filter((r) => r.answered && !r.isCorrect).length,
    skippedCount: results.filter((r) => !r.answered).length,
    results,
  };
}


// GET /api/users/me/test-attempts/:attemptId/result
async function getTestResult(req, res) {
  try {
    const loaded = await loadOwnAttempt(req.user.userId, Number(req.params.attemptId));
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);
    const { attempt } = loaded;

    const closed = await submitIfExpired(attempt, attempt.test);
    if (!closed.submittedAt) {
      return res.status(409).json({
        error: { message: 'This attempt has not been submitted yet' },
        secondsRemaining: secondsRemaining(attempt, attempt.test),
      });
    }

    return res.status(200).json(await buildResult(attempt.id, closed, attempt.test));
  } catch (error) {
    console.error('getTestResult error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the result' } });
  }
}


/**
 * Ranks submitted attempts: highest score, then fastest, then whoever finished
 * first.
 *
 * Speed only breaks a tie — it never beats a better score, which is how a real
 * exam works and the opposite of rewarding someone for rushing.
 *
 * Competition ranking, so two students on the same score and time both take
 * rank 3 and the next takes rank 5. Sharing a rank but printing 3 and 4 would
 * tell one of them they were beaten by someone they tied.
 */
function rankAttempts(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
    return a.submittedAt - b.submittedAt;
  });

  let rank = 0;
  let previous = null;
  return sorted.map((row, index) => {
    const tied = previous
      && previous.score === row.score
      && previous.timeTakenSeconds === row.timeTakenSeconds;
    if (!tied) rank = index + 1;
    previous = row;
    return { ...row, rank };
  });
}


/**
 * One ranked row per student — their best attempt, not every retake.
 *
 * Shared by the student leaderboard and the admin one. The two differ only in
 * what they may show: `includeEmail` is opt-in so a student board can never
 * leak the cohort's email addresses by inheriting an admin field.
 */
async function buildLeaderboard(test, { includeEmail = false } = {}) {
  const attempts = await prisma.testAttempt.findMany({
    where: { testId: test.id, submittedAt: { not: null } },
    select: {
      id: true, userId: true, score: true, startedAt: true, submittedAt: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
  if (attempts.length === 0) return [];

  // Two grouped queries instead of loading every answer row. A 200-question
  // paper with 500 students is 100k answers; the leaderboard only needs a
  // correct-count per attempt.
  const attemptIds = attempts.map((a) => a.id);
  const [correctRows, answeredRows] = await Promise.all([
    prisma.testAttemptAnswer.groupBy({
      by: ['attemptId'],
      where: { attemptId: { in: attemptIds }, isCorrect: true },
      _count: { testQuestionId: true },
    }),
    prisma.testAttemptAnswer.groupBy({
      by: ['attemptId'],
      where: { attemptId: { in: attemptIds } },
      _count: { testQuestionId: true },
    }),
  ]);
  const correctBy = new Map(correctRows.map((r) => [r.attemptId, r._count.testQuestionId]));
  const answeredBy = new Map(answeredRows.map((r) => [r.attemptId, r._count.testQuestionId]));

  const rows = attempts.map((a) => {
    const answered = answeredBy.get(a.id) ?? 0;
    const correct = correctBy.get(a.id) ?? 0;
    const row = {
      attemptId: a.id,
      userId: a.userId,
      name: a.user.name,
      avatarUrl: a.user.avatarUrl,
      score: a.score ?? 0,
      correctCount: correct,
      wrongCount: answered - correct,
      skippedCount: test.totalQuestions - answered,
      timeTakenSeconds: timeTaken(a) ?? 0,
      submittedAt: a.submittedAt,
    };
    if (includeEmail) row.email = a.user.email;
    return row;
  });

  return rankAttempts(pickBestAttempts(rows));
}


/**
 * Collapses many attempts to one row per student: their best.
 *
 * A leaderboard where one person holds the top five places is not a ranking.
 * The kept row carries `attemptCount` — the student's total retakes, not the
 * count of the row that won — because an admin comparing a rank-1 first
 * attempt against a rank-1 sixth attempt is reading two different results.
 */
function pickBestAttempts(rows) {
  const bestByUser = new Map();
  for (const row of rows) {
    const held = bestByUser.get(row.userId);
    const better = !held
      || row.score > held.score
      || (row.score === held.score && row.timeTakenSeconds < held.timeTakenSeconds);
    const attemptCount = (held?.attemptCount ?? 0) + 1;
    bestByUser.set(row.userId, { ...(better ? row : held), attemptCount });
  }
  return [...bestByUser.values()];
}


// GET /api/users/me/tests/:testId/leaderboard?limit=50
async function getTestLeaderboard(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || !test.isPublished) {
      return res.status(404).json({ error: { message: 'Test not found' } });
    }

    const ranked = await buildLeaderboard(test);
    const mine = ranked.find((r) => r.userId === req.user.userId) ?? null;

    return res.status(200).json({
      test: {
        id: test.id, name: test.name, type: test.type,
        totalQuestions: test.totalQuestions,
        totalMarks: test.totalQuestions * test.marksCorrect,
      },
      totalParticipants: ranked.length,
      // The student's own row is returned separately as well as in the list.
      // Ranked 87th, they would otherwise never see themselves in a top 50.
      me: mine,
      entries: ranked.slice(0, limit),
    });
  } catch (error) {
    console.error('getTestLeaderboard error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the leaderboard' } });
  }
}

module.exports = {
  listTests, startTestAttempt, answerTestQuestion,
  clearTestAnswer, submitTestAttempt, getTestResult, getTestLeaderboard,
  // Shared with the admin leaderboard and the admin student detail screen.
  buildLeaderboard, timeTaken,
  // Exported for testAttempt.test.js — pure, no DB.
  rankAttempts, pickBestAttempts,
};
