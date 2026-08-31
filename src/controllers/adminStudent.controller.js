const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const { revokeActiveSessions } = require('../services/session.service');
const { isLessonUnlocked, lessonDone } = require('./selected-course.controller');
const { percent } = require('./home.controller');
const { attemptStatusByLesson } = require('./quizAttempt.controller');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// 'unverified' is the signup default, 'verified' is set on first Google login,
// 'blocked' is the admin kill switch enforced in authenticateStudent.
const VALID_STUDENT_STATUSES = ['unverified', 'verified', 'blocked'];

// GET /admin/students?page=1&limit=10&search=abc&status=blocked
async function getStudentList(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const search = (req.query.search || '').trim();
    const status = req.query.status;

    if (status !== undefined && !VALID_STUDENT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: { message: `status must be one of: ${VALID_STUDENT_STATUSES.join(', ')}` },
      });
    }

    const where = {
      role: 'student',
      ...(status !== undefined && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          selectedCourse: {
            select: {
              id: true,
              title: true,
              accessType: true,   // "free" | "premium"
              status: true,       // "draft" | "published" | "archived"
            },
          },
          selectedCourseType: {
            select: {
              id: true,
              title: true,
              accessType: true,   // "free" | "premium"
              status: true,
            },
          },
          // Logins are single-device, so at most one session is ever unrevoked.
          sessions: {
            where: { revokedAt: null },
            select: { deviceId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    // Flatten course info for easier frontend consumption
    const data = students.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      status: s.status,
      isBlocked: s.status === 'blocked',
      isLoggedIn: s.sessions.length > 0,
      lastLoginAt: s.sessions[0]?.createdAt ?? null,
      currentDeviceId: s.sessions[0]?.deviceId ?? null,
      createdAt: s.createdAt,
      course: s.selectedCourse
        ? {
            id: s.selectedCourse.id,
            title: s.selectedCourse.title,
            isPremium: s.selectedCourse.accessType === 'premium',
            status: s.selectedCourse.status,
          }
        : null,
      courseType: s.selectedCourseType
        ? {
            id: s.selectedCourseType.id,
            title: s.selectedCourseType.title,
            isPremium: s.selectedCourseType.accessType === 'premium',
            status: s.selectedCourseType.status,
          }
        : null,
    }));

    return res.status(200).json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('getStudentList error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong' },
    });
  }
}

// PATCH /admin/students/:id/status
// Body: { "status": "blocked" }
// Blocking also revokes the live session, otherwise the student keeps working
// until their current access token expires.
async function updateStudentStatus(req, res) {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: { message: 'Invalid student id' } });
    }

    const { status } = req.body;
    if (!VALID_STUDENT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: { message: `status must be one of: ${VALID_STUDENT_STATUSES.join(', ')}` },
      });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, role: true, status: true },
    });

    if (!student || student.role !== 'student') {
      return res.status(404).json({ error: { message: 'Student not found' } });
    }

    const updated = await prisma.user.update({
      where: { id: studentId },
      data: { status },
      select: { id: true, name: true, email: true, status: true },
    });

    let sessionsRevoked = 0;
    if (status === 'blocked') {
      const result = await revokeActiveSessions(studentId);
      sessionsRevoked = result.count;
    }

    return res.status(200).json({
      student: { ...updated, isBlocked: updated.status === 'blocked' },
      sessionsRevoked,
    });
  } catch (error) {
    console.error('updateStudentStatus error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while updating the student status' },
    });
  }
}

// GET /admin/students/:id
// Everything about one student on a single screen: profile, login state, the
// course + course type they picked, their subscriptions, and the full
// chapter -> lesson tree. Unlike the student endpoint this returns draft and
// archived lessons too, and marks which ones that student can actually open.
async function getStudentById(req, res) {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: { message: 'Invalid student id' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true, name: true, email: true, phone: true, avatarUrl: true,
        role: true, status: true, createdAt: true,
        selectedCourseId: true, selectedCourseTypeId: true,
        selectedCourse: {
          select: { id: true, title: true, thumbnail: true, status: true, accessType: true },
        },
        selectedCourseType: {
          select: { id: true, title: true, description: true, status: true, accessType: true },
        },
        sessions: {
          where: { revokedAt: null },
          select: { deviceId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user || user.role !== 'student') {
      return res.status(404).json({ error: { message: 'Student not found' } });
    }

    const subscriptions = user.selectedCourseId
      ? await prisma.subscription.findMany({
          where: { userId: studentId },
          orderBy: { startDate: 'desc' },
          select: {
            id: true, courseId: true, planId: true, startDate: true,
            endDate: true, isActive: true,
            plan: { select: { id: true, title: true, price: true, durationDays: true, isActive: true } },
          },
        })
      : [];

    const now = new Date();
    const paidPlanIds = new Set(
      subscriptions
        .filter((s) => s.isActive && s.endDate >= now && s.courseId === user.selectedCourseId)
        .map((s) => s.planId)
    );

    // Same either/or resolution the student feed uses.
    const chapters = user.selectedCourseId
      ? await prisma.chapter.findMany({
          where: user.selectedCourseTypeId
            ? { courseTypeId: user.selectedCourseTypeId }
            : { courseId: user.selectedCourseId },
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true, title: true, displayOrder: true,
            lessons: {
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true, title: true, type: true, status: true,
                accessType: true, isFreePreview: true, displayOrder: true,
                videoUrl: true, noteUrl: true, thumbnailUrl: true, noteFileType: true,
                lessonPlans: {
                  select: {
                    plan: { select: { id: true, title: true, price: true, durationDays: true, isActive: true } },
                  },
                },
              },
            },
          },
        })
      : [];

    // ── this student's actual progress through that tree ──
    const allLessons = chapters.flatMap((ch) => ch.lessons);
    const lessonIds = allLessons.map((l) => l.id);
    const quizLessonIds = allLessons.filter((l) => l.type === 'quiz').map((l) => l.id);

    const [progressRows, attemptByLesson, attempts, savedQuestions, savedLessons, testAttempts] =
      await Promise.all([
        prisma.lessonProgress.findMany({
          where: { userId: studentId, lessonId: { in: lessonIds } },
          select: { lessonId: true, completed: true, lastPositionSeconds: true, updatedAt: true },
        }),
        attemptStatusByLesson(studentId, quizLessonIds),
        prisma.quizAttempt.findMany({
          where: { userId: studentId, answers: { some: {} } },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true, lessonId: true, questionIds: true, startedAt: true, completedAt: true,
            quiz: { select: { id: true, title: true } },
            answers: { select: { questionId: true, isCorrect: true, marksAwarded: true } },
          },
        }),
        prisma.savedQuestion.count({ where: { userId: studentId } }),
        prisma.savedLesson.count({ where: { userId: studentId, lesson: { status: 'published' } } }),
        prisma.testAttempt.findMany({
          where: { userId: studentId },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true, startedAt: true, submittedAt: true, score: true,
            test: { select: { id: true, name: true, totalQuestions: true, marksCorrect: true } },
          },
        }),
      ]);

    const progressByLesson = new Map(progressRows.map((row) => [row.lessonId, row]));

    const shapedChapters = chapters.map((ch) => {
      const lessons = ch.lessons.map((l) => {
        const { lessonPlans = [], ...rest } = l;
        const plans = lessonPlans.map((lp) => lp.plan);
        const prog = progressByLesson.get(l.id);
        const attempt = l.type === 'quiz' ? attemptByLesson.get(l.id) ?? null : null;
        return {
          ...rest,
          plans,
          planIds: plans.map((p) => p.id),
          // What this specific student sees. Draft lessons never reach them,
          // however their subscription looks.
          visibleToStudent: l.status === 'published' && isLessonUnlocked(l, paidPlanIds),
          unlockedByPlan: isLessonUnlocked(l, paidPlanIds),
          completed: lessonDone(l, prog, attempt),
          lastPositionSeconds: prog?.lastPositionSeconds ?? 0,
          lastActivityAt: prog?.updatedAt ?? attempt?.startedAt ?? null,
          attempt,
        };
      });

      // Only published lessons count. A draft is not work the student has
      // failed to do — it is work nobody can see yet, and including it would
      // make every chapter look permanently unfinished.
      const published = lessons.filter((l) => l.status === 'published');
      const done = published.filter((l) => l.completed).length;

      return {
        ...ch,
        lessons,
        lessonCount: ch.lessons.length,
        publishedCount: published.length,
        progress: {
          total: published.length,
          completed: done,
          remaining: published.length - done,
          percent: percent(done, published.length),
        },
      };
    });

    // Count off the shaped lessons, which already carry `completed`. Only
    // published ones: a draft is not work the student failed to do.
    const published = shapedChapters
      .flatMap((ch) => ch.lessons)
      .filter((l) => l.status === 'published');

    const doneIn = (list) => list.filter((l) => l.completed).length;

    const videos = published.filter((l) => l.type === 'video');
    // 'text' is the note type; 'note' is not a LessonType and matches nothing.
    const notes = published.filter((l) => l.type === 'text');
    const quizzes = published.filter((l) => l.type === 'quiz');

    const videosInProgress = videos
      .filter((l) => !l.completed && l.lastPositionSeconds > 0).length;

    // Distinct questions, not answer rows: retaking the same quiz must not
    // inflate how much of the bank this student has actually seen.
    const answeredQuestionIds = new Set();
    const correctQuestionIds = new Set();
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        answeredQuestionIds.add(answer.questionId);
        if (answer.isCorrect) correctQuestionIds.add(answer.questionId);
      }
    }

    const lessonsDone = doneIn(published);
    const quizzesDone = doneIn(quizzes);
    const submittedTests = testAttempts.filter((a) => a.submittedAt);

    const lastActivityAt = [
      ...progressRows.map((r) => r.updatedAt),
      ...attempts.map((a) => a.completedAt ?? a.startedAt),
      ...testAttempts.map((a) => a.submittedAt ?? a.startedAt),
    ].filter(Boolean).sort((a, b) => b - a)[0] ?? null;

    const studentProgress = {
      lessons: {
        total: published.length,
        completed: lessonsDone,
        remaining: published.length - lessonsDone,
        percent: percent(lessonsDone, published.length),
      },
      videos: {
        total: videos.length,
        completed: doneIn(videos),
        inProgress: videosInProgress,
        percent: percent(doneIn(videos), videos.length),
      },
      notes: {
        total: notes.length,
        completed: doneIn(notes),
        percent: percent(doneIn(notes), notes.length),
      },
      quizzes: {
        total: quizzes.length,
        attempted: quizzes.filter((l) => attemptByLesson.has(l.id)).length,
        completed: quizzesDone,
        remaining: quizzes.length - quizzesDone,
        percent: percent(quizzesDone, quizzes.length),
      },
      qbank: {
        attempted: answeredQuestionIds.size,
        correct: correctQuestionIds.size,
        wrong: answeredQuestionIds.size - correctQuestionIds.size,
        // Out of what they answered. Dividing by the bank would make accuracy
        // fall every time an admin adds a question.
        accuracy: percent(correctQuestionIds.size, answeredQuestionIds.size),
      },
      tests: {
        attempted: testAttempts.length,
        submitted: submittedTests.length,
        bestScore: submittedTests.length
          ? Math.max(...submittedTests.map((a) => a.score ?? 0))
          : null,
      },
      bookmarks: { questions: savedQuestions, lessons: savedLessons },
      lastActivityAt,
    };

    // Newest first, capped: the detail screen wants a recent history, not an
    // unbounded log that grows with every retake.
    const recentQuizAttempts = attempts.slice(0, 20).map((a) => ({
      attemptId: a.id,
      lessonId: a.lessonId,
      quiz: a.quiz,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      completed: Boolean(a.completedAt),
      totalQuestions: a.questionIds.length,
      answeredCount: a.answers.length,
      correctCount: a.answers.filter((x) => x.isCorrect).length,
      score: a.answers.reduce((sum, x) => sum + x.marksAwarded, 0),
    }));

    const recentTestAttempts = testAttempts.slice(0, 20).map((a) => ({
      attemptId: a.id,
      test: a.test,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      submitted: Boolean(a.submittedAt),
      score: a.score,
      totalMarks: a.test.totalQuestions * a.test.marksCorrect,
    }));

    return res.status(200).json({
      student: {
        id: user.id, name: user.name, email: user.email, phone: user.phone,
        avatarUrl: user.avatarUrl, status: user.status,
        isBlocked: user.status === 'blocked',
        isLoggedIn: user.sessions.length > 0,
        lastLoginAt: user.sessions[0]?.createdAt ?? null,
        currentDeviceId: user.sessions[0]?.deviceId ?? null,
        createdAt: user.createdAt,
      },
      selectedCourse: user.selectedCourse,
      selectedCourseType: user.selectedCourseType,
      subscriptions,
      hasActiveSubscription: paidPlanIds.size > 0,
      progress: studentProgress,
      recentQuizAttempts,
      recentTestAttempts,
      chapters: shapedChapters,
    });
  } catch (error) {
    console.error('getStudentById error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching the student' },
    });
  }
}

module.exports = { getStudentList, getStudentById, updateStudentStatus };