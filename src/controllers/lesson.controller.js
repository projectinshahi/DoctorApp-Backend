const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const cloudinary = require('../config/cloudinary');
const { questionPoolWhere } = require('./quiz.controller');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_LESSON_TYPES = ['video', 'text', 'quiz'];
const VALID_ACCESS_TYPES = ['free', 'premium'];
const VALID_STATUSES = ['draft', 'published', 'archived'];


const LESSON_SELECT = {
  id: true,
  chapterId: true,
  title: true,
  description: true,
  type: true,
  videoUrl: true,
  videoPublicId: true,
  thumbnailUrl: true,
  thumbnailPublicId: true,
  noteUrl: true,
  notePublicId: true,
  noteFileType: true,
  content: true,
  quizId: true,
  quiz: {
    select: { id: true, title: true, subjectId: true, topicId: true, examTag: true, questionCount: true, status: true },
  },
  displayOrder: true,
  isFreePreview: true,
  accessType: true,
  status: true,
  lessonPlans: {
    select: {
      plan: { select: { id: true, title: true, description: true, price: true, durationDays: true, isActive: true } },
    },
  },
  createdAt: true,
  updatedAt: true,
};

// The join rows are a storage detail. Every response flattens them to
// `plans` (full objects) + `planIds`, and keeps `planId` as the first id so
// clients written against the single-plan API keep working.
function shapeLesson(lesson) {
  if (!lesson) return lesson;
  const { lessonPlans = [], ...rest } = lesson;
  const plans = lessonPlans.map((lp) => lp.plan);
  return {
    ...rest,
    // Quiz lessons carry a Quiz ref; `content` stays in the schema for older
    // rows but is no longer written for them.
    quiz: rest.quiz ?? null,
    plans,
    planIds: plans.map((p) => p.id),
    planId: plans.length ? plans[0].id : null,
    plan: plans.length ? plans[0] : null,
  };
}


// A chapter hangs off either the course or a course type — resolve either way.
async function resolveCourseIdForChapter(chapterId) {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { courseId: true, courseType: { select: { courseId: true } } },
  });
  return chapter?.courseId ?? chapter?.courseType?.courseId ?? null;
}

// Reads the plan selection off a request body.
//   planIds: [2, 5]  -> the multi-plan shape
//   planId: 2        -> legacy single plan, treated as a one-item list
//   planId: null     -> explicit "any active subscription"
// Returns { provided, ids, error }. `provided` is false when the body says
// nothing about plans, so an update leaves the existing links alone.
function readPlanIds(body) {
  if (body.planIds !== undefined) {
    if (body.planIds === null) return { provided: true, ids: [] };
    if (!Array.isArray(body.planIds)) {
      return { provided: true, ids: [], error: 'planIds must be an array of integers' };
    }
    const ids = [];
    for (const raw of body.planIds) {
      const id = Number(raw);
      if (!Number.isInteger(id)) {
        return { provided: true, ids: [], error: 'planIds must be an array of integers' };
      }
      if (!ids.includes(id)) ids.push(id);
    }
    return { provided: true, ids };
  }

  if (body.planId !== undefined) {
    if (body.planId === null) return { provided: true, ids: [] };
    const id = Number(body.planId);
    if (!Number.isInteger(id)) {
      return { provided: true, ids: [], error: 'planId must be an integer' };
    }
    return { provided: true, ids: [id] };
  }

  return { provided: false, ids: [] };
}

// Every selected plan must exist and belong to the lesson's own course, and
// plans only mean anything on a premium lesson.
async function validatePlansForLesson(planIds, effectiveAccessType, chapterId) {
  if (planIds.length === 0) return null;

  if (effectiveAccessType !== 'premium') {
    return 'plans can only be set when accessType is premium';
  }

  const courseId = await resolveCourseIdForChapter(chapterId);
  if (courseId === null) return 'Cannot resolve the course for this lesson';

  const plans = await prisma.plan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, courseId: true },
  });

  const found = new Map(plans.map((p) => [p.id, p]));
  for (const id of planIds) {
    const plan = found.get(id);
    if (!plan) return `Plan ${id} not found`;
    if (plan.courseId !== courseId) {
      return `Plan ${id} belongs to course ${plan.courseId}, but this lesson is in course ${courseId}`;
    }
  }

  return null;
}

// Reads the quiz selection off a request body, matching readPlanIds' shape.
//   quizId: 7    -> link this quiz
//   quizId: null -> unlink
// `provided` is false when the body says nothing, so an update leaves the
// existing link alone.
function readQuizId(body) {
  if (body.quizId === undefined) return { provided: false, id: null };
  if (body.quizId === null) return { provided: true, id: null };
  const id = Number(body.quizId);
  if (!Number.isInteger(id)) {
    return { provided: true, id: null, error: 'quizId must be an integer or null' };
  }
  return { provided: true, id };
}

// A quiz only belongs on a quiz-type lesson, has to exist, has to be active,
// and can only be served by one lesson (the column is unique — catch it here
// rather than letting Prisma throw a raw constraint error).
async function validateQuizForLesson(quizId, effectiveType, lessonId) {
  if (quizId === null) return null;

  if (effectiveType !== 'quiz') {
    return "quizId can only be set when type is 'quiz'";
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, status: true, lesson: { select: { id: true } } },
  });
  if (!quiz) return `Quiz ${quizId} not found`;
  if (quiz.status !== 'active') return `Quiz ${quizId} is inactive`;
  if (quiz.lesson && quiz.lesson.id !== lessonId) {
    return `Quiz ${quizId} is already linked to lesson ${quiz.lesson.id}`;
  }

  return null;
}

// POST /api/chapters/:chapterId/lessons
async function createLesson(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    const {
      title, description, type, videoUrl, videoPublicId,
      thumbnailUrl, thumbnailPublicId,
      noteUrl, notePublicId, noteFileType,
      content, displayOrder, isFreePreview, accessType, status,
    } = req.body;

    if (isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id' } });
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: { message: 'Title is required' } });
    }

    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: { message: 'Description must be a string' } });
    }

    if (!type || !VALID_LESSON_TYPES.includes(type)) {
      return res.status(400).json({ error: { message: `type must be one of: ${VALID_LESSON_TYPES.join(', ')}` } });
    }

    if (accessType !== undefined && !VALID_ACCESS_TYPES.includes(accessType)) {
      return res.status(400).json({ error: { message: "accessType must be 'free' or 'premium'" } });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } });
    }

    const selection = readPlanIds(req.body);
    if (selection.error) {
      return res.status(400).json({ error: { message: selection.error } });
    }
    const planError = await validatePlansForLesson(selection.ids, accessType ?? 'free', chapterId);
    if (planError) {
      return res.status(400).json({ error: { message: planError } });
    }

    const quizSelection = readQuizId(req.body);
    if (quizSelection.error) {
      return res.status(400).json({ error: { message: quizSelection.error } });
    }
    const quizError = await validateQuizForLesson(quizSelection.id, type, null);
    if (quizError) {
      return res.status(400).json({ error: { message: quizError } });
    }

    const lesson = await prisma.lesson.create({
      data: {
        chapterId,
        title: title.trim(),
        description: description !== undefined ? description : null,
        type,
        videoUrl: videoUrl ?? null,
        videoPublicId: videoPublicId ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        thumbnailPublicId: thumbnailPublicId ?? null,
        noteUrl: noteUrl ?? null,
        notePublicId: notePublicId ?? null,
        noteFileType: noteFileType ?? null,
        // A quiz lesson's questions come from its Quiz, never from `content`.
        content: type === 'quiz' ? null : (content ?? null),
        quizId: quizSelection.id,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
        isFreePreview: Boolean(isFreePreview) || false,
        accessType: accessType ?? 'free',
        status: status ?? 'draft',
        lessonPlans: { create: selection.ids.map((id) => ({ planId: id })) },
      },
      select: LESSON_SELECT,
    });

    return res.status(201).json({ lesson: shapeLesson(lesson) });
  } catch (error) {
    console.error('Create lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the lesson' } });
  }
}



async function getLesson(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const includeChapter = req.query.includeChapter === 'true';

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: includeChapter
        ? {
            ...LESSON_SELECT,
            chapter: {
              select: {
                id: true,
                title: true,
                courseId: true,
                courseTypeId: true,
              },
            },
          }
        : LESSON_SELECT,
    });

    if (!lesson) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const shaped = shapeLesson(lesson);

    // A quiz lesson's screen needs to know how many questions the filter
    // actually matches — otherwise the admin has to guess whether the quiz is
    // servable. Only costs a count, and only when there is a quiz.
    if (shaped.quiz) {
      const availableQuestions = await prisma.question.count({
        where: questionPoolWhere(shaped.quiz),
      });
      shaped.quiz = {
        ...shaped.quiz,
        availableQuestions,
        servedQuestions: shaped.quiz.questionCount
          ? Math.min(shaped.quiz.questionCount, availableQuestions)
          : availableQuestions,
        isUnderfilled:
          shaped.quiz.questionCount != null && availableQuestions < shaped.quiz.questionCount,
      };
    }

    return res.status(200).json({ lesson: shaped });
  } catch (error) {
    console.error('Get lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the lesson' } });
  }
}




async function getLessonsByChapter(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    if (isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id' } });
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    const lessons = await prisma.lesson.findMany({
      where: { chapterId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: LESSON_SELECT,
    });

    return res.status(200).json({ lessons: lessons.map(shapeLesson) });
  } catch (error) {
    console.error('Get lessons by chapter error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching lessons' } });
  }
}

// PUT /api/lessons/:id
async function updateLesson(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const {
      title, description, type, videoUrl, videoPublicId,
      thumbnailUrl, thumbnailPublicId,
      noteUrl, notePublicId, noteFileType,
      content, displayOrder, isFreePreview, accessType, status,
    } = req.body;

    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: { message: 'Title must be a non-empty string' } });
      }
      data.title = title.trim();
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        return res.status(400).json({ error: { message: 'Description must be a string' } });
      }
      data.description = description;
    }

    if (type !== undefined) {
      if (!VALID_LESSON_TYPES.includes(type)) {
        return res.status(400).json({ error: { message: `type must be one of: ${VALID_LESSON_TYPES.join(', ')}` } });
      }
      data.type = type;
    }

    if (accessType !== undefined) {
      if (!VALID_ACCESS_TYPES.includes(accessType)) {
        return res.status(400).json({ error: { message: "accessType must be 'free' or 'premium'" } });
      }
      data.accessType = accessType;
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } });
      }
      data.status = status;
    }

    // Plans and accessType interact, so resolve them together against whatever
    // the lesson will look like *after* this update, not what it looks like now.
    const effectiveAccessType = accessType !== undefined ? accessType : existing.accessType;

    const selection = readPlanIds(req.body);
    if (selection.error) {
      return res.status(400).json({ error: { message: selection.error } });
    }

    let nextPlanIds = null; // null = leave the existing links untouched
    if (selection.provided) {
      const planError = await validatePlansForLesson(selection.ids, effectiveAccessType, existing.chapterId);
      if (planError) {
        return res.status(400).json({ error: { message: planError } });
      }
      nextPlanIds = selection.ids;
    } else if (effectiveAccessType !== 'premium') {
      // Demoted to free while still carrying plans — drop the now-meaningless links.
      nextPlanIds = [];
    }

    // Same deal as plans: resolve the quiz against the post-update type.
    const effectiveType = type !== undefined ? type : existing.type;

    const quizSelection = readQuizId(req.body);
    if (quizSelection.error) {
      return res.status(400).json({ error: { message: quizSelection.error } });
    }

    if (quizSelection.provided) {
      const quizError = await validateQuizForLesson(quizSelection.id, effectiveType, lessonId);
      if (quizError) {
        return res.status(400).json({ error: { message: quizError } });
      }
      data.quizId = quizSelection.id;
    } else if (effectiveType !== 'quiz' && existing.quizId !== null) {
      // Retyped away from quiz while still linked — drop the dangling link.
      data.quizId = null;
    }

    if (nextPlanIds !== null) {
      // Replace wholesale: the client always sends the full selection, so a
      // diff would only be more code for the same result.
      data.lessonPlans = {
        deleteMany: {},
        create: nextPlanIds.map((id) => ({ planId: id })),
      };
    }

    // Cleanup old Cloudinary files when they're being replaced or removed
    if (notePublicId !== undefined && existing.notePublicId && existing.notePublicId !== notePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.notePublicId, { resource_type: 'raw' });
      } catch (cleanupErr) {
        console.error('Failed to delete old note from Cloudinary:', cleanupErr);
      }
    }

    if (videoPublicId !== undefined && existing.videoPublicId && existing.videoPublicId !== videoPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.videoPublicId, { resource_type: 'video' });
      } catch (cleanupErr) {
        console.error('Failed to delete old video from Cloudinary:', cleanupErr);
      }
    }

    if (thumbnailPublicId !== undefined && existing.thumbnailPublicId && existing.thumbnailPublicId !== thumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.thumbnailPublicId, { resource_type: 'image' });
      } catch (cleanupErr) {
        console.error('Failed to delete old thumbnail from Cloudinary:', cleanupErr);
      }
    }

    if (videoUrl !== undefined) data.videoUrl = videoUrl;
    if (videoPublicId !== undefined) data.videoPublicId = videoPublicId;
    if (thumbnailUrl !== undefined) data.thumbnailUrl = thumbnailUrl;
    if (thumbnailPublicId !== undefined) data.thumbnailPublicId = thumbnailPublicId;
    if (noteUrl !== undefined) data.noteUrl = noteUrl;
    if (notePublicId !== undefined) data.notePublicId = notePublicId;
    if (noteFileType !== undefined) data.noteFileType = noteFileType;
    // `content` is kept in the schema for older rows, but a quiz lesson's
    // questions live on its Quiz, so stop writing content for that type.
    if (content !== undefined && effectiveType !== 'quiz') data.content = content;
    if (displayOrder !== undefined) data.displayOrder = Number(displayOrder);
    if (isFreePreview !== undefined) data.isFreePreview = Boolean(isFreePreview);

    const lesson = await prisma.lesson.update({
      where: { id: lessonId },
      data,
      select: LESSON_SELECT,
    });

    return res.status(200).json({ lesson: shapeLesson(lesson) });
  } catch (error) {
    console.error('Update lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the lesson' } });
  }
}

// DELETE /api/lessons/:id
async function deleteLesson(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    if (existing.notePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.notePublicId, { resource_type: 'raw' });
      } catch (err) {
        console.error('Failed to delete note from Cloudinary:', err);
      }
    }

    if (existing.videoPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.videoPublicId, { resource_type: 'video' });
      } catch (err) {
        console.error('Failed to delete video from Cloudinary:', err);
      }
    }

    if (existing.thumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.thumbnailPublicId, { resource_type: 'image' });
      } catch (err) {
        console.error('Failed to delete thumbnail from Cloudinary:', err);
      }
    }

    await prisma.lesson.delete({ where: { id: lessonId } });

    return res.status(200).json({ message: 'Lesson deleted successfully', lessonId });
  } catch (error) {
    console.error('Delete lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the lesson' } });
  }
}



// GET /api/lessons/:id/plans
// Everything the admin panel's plan picker needs in one call: the plans that
// belong to this lesson's course, and which ones are currently attached.
// Inactive plans are still listed, flagged, so an already-attached plan that
// was later deactivated doesn't silently vanish from the picker.
async function getLessonPlans(req, res) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        chapterId: true,
        accessType: true,
        lessonPlans: { select: { planId: true } },
      },
    });
    if (!lesson) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const courseId = await resolveCourseIdForChapter(lesson.chapterId);
    if (courseId === null) {
      return res.status(409).json({
        error: { message: "This lesson's chapter is not linked to a course or course type" },
      });
    }

    const plans = await prisma.plan.findMany({
      where: { courseId },
      orderBy: { price: 'asc' },
      select: { id: true, title: true, description: true, price: true, durationDays: true, isActive: true },
    });

    return res.status(200).json({
      lessonId: lesson.id,
      courseId,
      accessType: lesson.accessType,
      planSelectable: lesson.accessType === 'premium', // show the picker only when true
      selectedPlanIds: lesson.lessonPlans.map((lp) => lp.planId),
      // Legacy single-plan field, kept for older clients.
      selectedPlanId: lesson.lessonPlans.length ? lesson.lessonPlans[0].planId : null,
      plans,
    });
  } catch (error) {
    console.error('Get lesson plans error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching plans for this lesson' } });
  }
}

async function reorderLessons(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    if (isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id' } });
    }

    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
      return res.status(400).json({ error: { message: 'lessonIds must be a non-empty array' } });
    }

    const ids = lessonIds.map(Number);
    if (ids.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ error: { message: 'lessonIds must contain integers' } });
    }

    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: { message: 'lessonIds contains duplicates' } });
    }


    
    const owned = await prisma.lesson.findMany({
      where: { chapterId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((l) => l.id));

    const strays = ids.filter((id) => !ownedIds.has(id));
    if (strays.length > 0) {
      return res.status(400).json({
        error: { message: `These lessons do not belong to chapter ${chapterId}: ${strays.join(', ')}` },
      });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.lesson.update({ where: { id }, data: { displayOrder: index } })
      )
    );

    const lessons = await prisma.lesson.findMany({
      where: { chapterId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: LESSON_SELECT,
    });

    return res.status(200).json({ lessons: lessons.map(shapeLesson) });
  } catch (error) {
    console.error('Reorder lessons error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while reordering lessons' } });
  }
}

module.exports = {
  createLesson,
  getLesson,
  getLessonsByChapter,
  updateLesson,
  deleteLesson,
  reorderLessons,
  getLessonPlans,
};