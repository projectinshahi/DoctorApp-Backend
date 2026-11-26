// backend/src/controllers/selected-course.controller.js

const prisma = require('../db');
const { resolveQuizQuestions, fetchEligibleQuestions } = require('./quiz.controller');
const {
  LESSON_ENTITLEMENT, isLessonUnlocked, lessonAccess, stripLockedContent,
  accessFrom, courseAccessOf, hasCourseFeature, getCourseAccess,
  hasAnyPlan, FULL_ACCESS_SELECT,
} = require('../services/access.service');
// Required lazily: quizAttempt.controller requires this file back for its
// gates, and a top-level require here would resolve to a half-built module.
const attemptStatusByLesson = (...args) =>
  require('./quizAttempt.controller').attemptStatusByLesson(...args);
// Same lazy dance: home.controller requires this file for isLessonUnlocked.
// Reused rather than re-derived so a chapter bar and a home card can never
// disagree about what 99% means.
const percent = (...args) => require('./home.controller').percent(...args);
// Lazy for the same reason as `percent`: home.controller requires this file.
const watchedState = (...args) => require('./home.controller').watchedState(...args);

// Done comes from two places. A quiz lesson has no lesson_progress row — it is
// finished when its latest attempt is submitted. Everything else is finished
// when the student said so. Collapsed into one flag here so the app draws a
// checkmark without branching on type.
function lessonDone(lesson, progress, attempt) {
  return lesson.type === 'quiz' ? Boolean(attempt?.completed) : Boolean(progress?.completed);
}

// The access rules (LESSON_ENTITLEMENT, isLessonUnlocked, lessonAccess,
// stripLockedContent, accessFrom, courseAccessOf, hasCourseFeature) live in
// services/access.service.js, the one home for student access. Re-exported
// below so existing imports of this file keep working.

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
        // Read here so getCourseAccess needs no user query of its own.
        ...FULL_ACCESS_SELECT,
      },
    });

    if (!user?.selectedCourseId) {
      return res.status(200).json({ course: null, courseType: null, chapters: [] });
    }

    // Which plans has this student actually paid for and not yet outlived?
    // (Or full access, which opens everything.)
    const paidPlanIds = await getCourseAccess(userId, user.selectedCourseId, { user });

    // Course-level flag for the UI banner. A free course needs no purchase.
    const hasPaid =
      user.selectedCourse.accessType !== 'premium' || hasAnyPlan(paidPlanIds);

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
            durationSeconds: true,
            displayOrder: true,
            isFreePreview: true,
            accessType: true,
            // Per-video free / premium decides what opens, so the tree needs
            // the rows to draw a padlock that tells the truth.
            // Draft videos are the admin's work in progress, never a student's.
            videos: {
              where: { status: 'published' },
              select: {
                id: true, title: true, description: true, videoUrl: true, thumbnailUrl: true,
                durationSeconds: true, accessType: true, displayOrder: true, viewCount: true,
              },
              orderBy: { displayOrder: 'asc' },
            },
            quizId: true,
            quiz: { select: { id: true, title: true, questionCount: true, status: true } },
            lessonPlans: {
              select: { plan: { select: { id: true, title: true, price: true, durationDays: true } } },
            },
          },
        },
      },
    });

    // One batched lookup for every quiz lesson in the tree. The topic screen
    // used to ask per quiz, which is a query per pill on the page.
    const quizLessonIds = chapters.flatMap((ch) =>
      ch.lessons.filter((l) => l.type === 'quiz').map((l) => l.id));
    const allLessonIds = chapters.flatMap((ch) => ch.lessons.map((l) => l.id));

    const allVideoIds = chapters.flatMap((ch) => ch.lessons.flatMap((l) => l.videos.map((v) => v.id)));

    const [attemptByLesson, progressRows, savedRows, savedVideoRows] = await Promise.all([
      attemptStatusByLesson(userId, quizLessonIds),
      prisma.lessonProgress.findMany({
        where: { userId, lessonId: { in: allLessonIds } },
        select: { lessonId: true, completed: true, lastPositionSeconds: true },
      }),
      // One query for the whole tree. Without it a bookmark icon per row would
      // have to search the saved list, which the tree screen does not load.
      prisma.savedLesson.findMany({
        where: { userId, lessonId: { in: allLessonIds } },
        select: { lessonId: true },
      }),
      // Same for the per-video bookmark on each row of a lesson's video list.
      prisma.savedVideo.findMany({
        where: { userId, videoId: { in: allVideoIds } },
        select: { videoId: true },
      }),
    ]);
    const savedVideoIds = new Set(savedVideoRows.map((r) => r.videoId));
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
    const savedLessonIds = new Set(savedRows.map((r) => r.lessonId));

    const shaped = chapters.map((ch) => {
      const lessons = ch.lessons.map((l) => {
        const gate = lessonAccess(l, paidPlanIds, courseAccessOf(user));
        const { lessonPlans = [], ...rest } = l;
        const plans = lessonPlans.map((lp) => lp.plan);
        // null, not omitted: the app can tell "no attempt yet" from "not a
        // quiz" without checking type twice.
        const attempt = l.type === 'quiz' ? attemptByLesson.get(l.id) ?? null : null;
        const p = progressByLesson.get(l.id);
        const base = {
          ...rest,
          videos: rest.videos.map((v) => ({ ...v, isSaved: savedVideoIds.has(v.id) })),
          plans,
          planIds: plans.map((x) => x.id),
          attempt,
          completed: lessonDone(l, p, attempt),
          // Survives the lock strip: the resume point is not the media.
          lastPositionSeconds: p?.lastPositionSeconds ?? 0,
          // How far through, for a part-watched bar under the row. Null when
          // the video's length is not known yet — render the tick alone rather
          // than a bar stuck at zero.
          watchedPercent: l.type === 'video'
            ? watchedState(p?.lastPositionSeconds ?? 0, l.durationSeconds).watchedPercent
            : null,
          isSaved: savedLessonIds.has(l.id),
        };
        return stripLockedContent(base, gate);
      });

      // Locked lessons stay in the denominator. A free student seeing 2/10 is
      // the truth about the chapter; hiding them would show 2/2 = done.
      const completed = lessons.filter((l) => l.completed).length;
      return {
        ...ch,
        lessons,
        progress: { total: lessons.length, completed, percent: percent(completed, lessons.length) },
      };
    });

    // Course total is the chapter numbers added up, not a second query.
    const courseTotal = shaped.reduce((n, ch) => n + ch.progress.total, 0);
    const courseDone = shaped.reduce((n, ch) => n + ch.progress.completed, 0);

    return res.status(200).json({
      course: user.selectedCourse,
      courseType,
      hasPaid,
      progress: { total: courseTotal, completed: courseDone, percent: percent(courseDone, courseTotal) },
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
      select: {
        selectedCourseId: true,
        selectedCourseTypeId: true,
        // Needed by isLessonUnlocked: without it a premium course's free
        // lessons read as unlocked here and hand over videoUrl.
        selectedCourse: { select: { accessType: true } },
        ...FULL_ACCESS_SELECT,
      },
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
        durationSeconds: true,
        // A lesson holds its videos, its quiz and its revision decks. videoUrl
        // above is still video 1, so a client that only knows the old shape
        // keeps playing the same thing it always did.
        videos: {
          where: { status: 'published' },
          select: {
            id: true, title: true, description: true, videoUrl: true, thumbnailUrl: true,
            durationSeconds: true, displayOrder: true, accessType: true, viewCount: true,
          },
          orderBy: { displayOrder: 'asc' },
        },
        rapidRecalls: {
          where: { status: 'published' },
          select: { id: true, title: true, _count: { select: { cards: true } } },
          orderBy: { displayOrder: 'asc' },
        },
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

    const paidPlanIds = await getCourseAccess(userId, user.selectedCourseId, { user });

    const gate = lessonAccess(lesson, paidPlanIds, courseAccessOf(user));
    // "Unlocked" for the paywall below: everything inside opens. A lesson that
    // is part free still offers the plans for the part that is not.
    const unlocked = !gate.locked && gate.contentOpen && (lesson.videos ?? []).every(gate.videoOpen);
    const { status, lessonPlans = [], rapidRecalls = [], ...rest } = lesson;
    rest.rapidRecalls = rapidRecalls.map(({ _count, ...deck }) => ({
      ...deck,
      cardCount: _count.cards,
    }));
    const requiredPlans = lessonPlans.map((lp) => lp.plan);

    // The player seeks to this on open. The tree carries it too, but this is
    // the call made when a lesson is opened from a deep link or a bookmark,
    // where no tree was loaded — without it those routes always restart at 0.
    const [progress, saved, savedVideoRows] = await Promise.all([
      prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
        select: { completed: true, lastPositionSeconds: true, updatedAt: true },
      }),
      prisma.savedLesson.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
        select: { savedAt: true },
      }),
      prisma.savedVideo.findMany({
        where: { userId, videoId: { in: rest.videos.map((v) => v.id) } },
        select: { videoId: true },
      }),
    ]);
    const savedVideoIds = new Set(savedVideoRows.map((r) => r.videoId));

    const base = {
      ...rest,
      videos: rest.videos.map((v) => ({ ...v, isSaved: savedVideoIds.has(v.id) })),
      plans: requiredPlans,
      planIds: requiredPlans.map((p) => p.id),
      // Outside the lock strip below: a resume point is not media, and a
      // student who later subscribes should not have lost their place.
      completed: progress?.completed ?? false,
      lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
      watchedPercent: lesson.type === 'video'
        ? watchedState(progress?.lastPositionSeconds ?? 0, lesson.durationSeconds).watchedPercent
        : null,
      // So the bookmark button renders its own state without fetching the
      // whole saved list and searching it.
      isSaved: Boolean(saved),
      savedAt: saved?.savedAt ?? null,
    };

    return res.status(200).json({
      // Each video carries its own `locked`; a locked one keeps its title so
      // the list can show it behind a padlock. `contentLocked` covers the
      // quiz, notes and text.
      lesson: stripLockedContent(base, gate),
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


// POST /api/users/me/lesson-videos/:id/view
// Counts one play, for the "18.4k views" under a video. The app calls it once
// when a video starts. Only published videos in published lessons count.
//
// ponytail: not deduplicated — a student replaying a video counts again. A
// per-student-per-day table is the upgrade if the number needs to mean people.
async function recordVideoView(req, res) {
  try {
    const videoId = Number(req.params.id);
    if (!Number.isInteger(videoId)) {
      return res.status(400).json({ error: { message: 'Invalid video id' } });
    }

    const { count } = await prisma.lessonVideo.updateMany({
      where: { id: videoId, status: 'published', lesson: { status: 'published' } },
      data: { viewCount: { increment: 1 } },
    });
    if (count === 0) return res.status(404).json({ error: { message: 'Video not found' } });

    const video = await prisma.lessonVideo.findUnique({ where: { id: videoId }, select: { viewCount: true } });
    return res.status(200).json({ videoId, viewCount: video.viewCount });
  } catch (error) {
    console.error('recordVideoView error:', error);
    return res.status(500).json({ error: { message: 'Failed to record the view' } });
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
    select: {
      selectedCourseId: true, selectedCourseTypeId: true,
      // Needed for the lock: a premium course locks its lessons.
      selectedCourse: { select: { accessType: true } },
      ...FULL_ACCESS_SELECT,
    },
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

  const access = await getCourseAccess(userId, user.selectedCourseId, { user });

  if (!isLessonUnlocked(lesson, access, courseAccessOf(user))) {
    return deny(403, 'This lesson is locked. Subscribe to unlock it.', {
      requiredPlans: lesson.lessonPlans.map((lp) => lp.plan),
    });
  }

  if (!lesson.quiz) return deny(409, 'This lesson has no quiz linked');
  if (lesson.quiz.status !== 'active') return deny(409, 'The quiz linked to this lesson is inactive');

  // Handed back so callers do not repeat the subscription query to work out
  // whether premium questions may be served. A free lesson inside a paid
  // course can still hold premium questions.
  // planIds holds one entry per distinct plan, so it is non-empty exactly
  // when there is at least one live subscription row. Full access counts as
  // subscribed, so premium questions are served to it too.
  return { lesson, hasSubscription: hasAnyPlan(access) };
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
    const questions = await resolveQuizQuestions(lesson.quiz, { freeOnly: !gate.hasSubscription });

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

    const questions = await fetchEligibleQuestions(lesson.quiz, [...new Set(servedIds)], {
      freeOnly: !gate.hasSubscription,
    });

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
  // Re-exported from services/access.service.js for existing imports.
  courseAccessOf,
  accessFrom, LESSON_ENTITLEMENT, hasCourseFeature,
  lessonDone,
  getSelectedCourseContent,
  getStudentLesson,
  recordVideoView,
  getStudentQuizQuestions,
  submitStudentQuiz,
  // Reused by quizAttempt.controller.js so the attempt flow runs the same gates.
  loadStudentQuiz,
  isLessonUnlocked,
  lessonAccess,
  stripLockedContent,
  // Exported for quiz.test.js — pure, no DB.
  scoreSubmission,
};
