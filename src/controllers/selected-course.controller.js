// backend/src/controllers/selected-course.controller.js
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const { resolveQuizQuestions, fetchEligibleQuestions } = require('./quiz.controller');

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


// The three gates a student must pass to reach quiz content: the lesson is
// published, it belongs to their selected course, and it is unlocked. Shared
// so the serve and the submit can never disagree about who is allowed in —
// a submit that skipped a gate would hand the answer key to a locked lesson.
// Returns { error: {status, body} } or { lesson }.
async function loadStudentQuiz(userId, lessonId) {
  const deny = (status, message, extra) => ({ error: { status, body: { error: { message }, ...extra } } });

  if (!Number.isInteger(lessonId)) return deny(400, 'Invalid lesson id');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { selectedCourseId: true, selectedCourseTypeId: true },
  });

  if (!user?.selectedCourseId) return deny(409, 'Select a course before opening a lesson');

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

  if (!lesson || lesson.status !== 'published') return deny(404, 'Lesson not found');

  const belongs = user.selectedCourseTypeId
    ? lesson.chapter.courseTypeId === user.selectedCourseTypeId
    : lesson.chapter.courseId === user.selectedCourseId;

  if (!belongs) return deny(403, 'This lesson is not part of your selected course');

  const activeSubs = await prisma.subscription.findMany({
    where: { userId, courseId: user.selectedCourseId, isActive: true, endDate: { gte: new Date() } },
    select: { planId: true },
  });

  if (!isLessonUnlocked(lesson, new Set(activeSubs.map((sub) => sub.planId)))) {
    return deny(403, 'This lesson is locked. Subscribe to unlock it.', {
      requiredPlans: lesson.lessonPlans.map((lp) => lp.plan),
    });
  }

  if (!lesson.quiz) return deny(409, 'This lesson has no quiz linked');
  if (lesson.quiz.status !== 'active') return deny(409, 'The quiz linked to this lesson is inactive');

  return { lesson };
}


// GET /api/users/me/lessons/:id/quiz-questions
// The student-facing twin of the admin serve endpoint. Same three gates as
// getStudentLesson — published, belongs to the selected course, unlocked —
// because a quiz is lesson content and must not bypass the paywall.
async function getStudentQuizQuestions(req, res) {
  try {
    const gate = await loadStudentQuiz(req.user.userId, Number(req.params.id));
    if (gate.error) return res.status(gate.error.status).json(gate.error.body);
    const { lesson } = gate;

    // includeAnswers stays false — the answer key never reaches a student
    // before they submit. It comes back from the submit response instead.
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


// Marks one submission against the answer key. Pure, so quiz.test.js can
// check the arithmetic without a database.
//
// A skipped question scores 0 — negative marking punishes a wrong guess, not
// an honest blank, which is how every exam this app targets works.
function scoreSubmission(questions, answers) {
  const chosen = new Map(answers.map((a) => [Number(a.questionId), Number(a.optionId)]));

  const results = questions.map((question) => {
    const correctOption = question.options.find((opt) => opt.isCorrect);
    const selectedOptionId = chosen.has(question.id) ? chosen.get(question.id) : null;
    const answered = selectedOptionId !== null;
    const isCorrect = answered && correctOption?.id === selectedOptionId;
    const marksAwarded = !answered ? 0 : (isCorrect ? question.marksCorrect : question.marksIncorrect);

    return {
      questionId: question.id,
      questionText: question.questionText,
      questionImageUrl: question.questionImageUrl,
      selectedOptionId,
      correctOptionId: correctOption ? correctOption.id : null,
      isCorrect,
      answered,
      marksAwarded,
      explanation: question.explanation,
      options: question.options,
    };
  });

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


// POST /api/users/me/lessons/:id/quiz-submit
// Body: { answers: [{ questionId, optionId }] }
//
// This is the only route that gives a student the answer key, and it does so
// *after* they commit to their answers. Serving isCorrect up front would let
// anyone read the correct option out of the response in a proxy before
// picking, so scoring stays server-side and the key rides back in the result.
//
// Nothing is persisted — there is no attempt history yet. Re-submitting just
// re-scores. See the attempts module when history or resume is needed.
async function submitStudentQuiz(req, res) {
  try {
    const gate = await loadStudentQuiz(req.user.userId, Number(req.params.id));
    if (gate.error) return res.status(gate.error.status).json(gate.error.body);
    const { lesson } = gate;

    const answers = req.body?.answers;
    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: { message: 'answers must be an array of { questionId, optionId }' } });
    }

    // The set the student was actually shown. A filter quiz with a
    // questionCount samples randomly, so the server cannot re-derive it —
    // send back the ids from the serve response to get skipped questions
    // counted. Falls back to whatever was answered, which scores correctly
    // but reports no skips.
    const servedIds = Array.isArray(req.body?.questionIds) && req.body.questionIds.length > 0
      ? req.body.questionIds.map(Number)
      : answers.map((a) => Number(a?.questionId));

    if (servedIds.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ error: { message: 'questionIds must be integers' } });
    }

    const questions = await fetchEligibleQuestions(lesson.quiz, [...new Set(servedIds)]);

    // Anything dropped was not part of this quiz. Saying so beats silently
    // scoring it as zero and leaving the app to wonder why the total is short.
    const found = new Set(questions.map((q) => q.id));
    const unknown = [...new Set(servedIds)].filter((id) => !found.has(id));
    if (unknown.length > 0) {
      return res.status(400).json({
        error: { message: `Not part of this quiz: question ${unknown.join(', ')}` },
      });
    }

    const optionIds = new Map(questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]));
    for (const answer of answers) {
      const questionId = Number(answer?.questionId);
      const optionId = Number(answer?.optionId);
      if (!optionIds.has(questionId)) {
        return res.status(400).json({ error: { message: `Answered question ${answer?.questionId} was not in questionIds` } });
      }
      if (!optionIds.get(questionId).has(optionId)) {
        return res.status(400).json({ error: { message: `Option ${answer?.optionId} does not belong to question ${questionId}` } });
      }
    }

    return res.status(200).json({
      lessonId: lesson.id,
      quiz: { id: lesson.quiz.id, title: lesson.quiz.title },
      ...scoreSubmission(questions, answers),
    });
  } catch (error) {
    console.error('submitStudentQuiz error:', error);
    return res.status(500).json({ error: { message: 'Failed to submit quiz' } });
  }
}

module.exports = {
  getSelectedCourseContent,
  getStudentLesson,
  getStudentQuizQuestions,
  submitStudentQuiz,
  // Reused by quizAttempt.controller.js so the attempt flow runs the same gates.
  loadStudentQuiz,
  isLessonUnlocked,
  // Exported for quiz.test.js — pure, no DB.
  scoreSubmission,
};
