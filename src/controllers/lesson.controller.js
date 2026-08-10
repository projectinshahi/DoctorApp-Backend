const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_LESSON_TYPES = ['video', 'text', 'quiz'];

function validateLessonInput(body, { partial = false } = {}) {
  const { title, type, displayOrder, isFreePreview } = body;

  if (!partial || title !== undefined) {
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return 'title is required';
    }
  }

  if (!partial || type !== undefined) {
    if (!type || !VALID_LESSON_TYPES.includes(type)) {
      return `type must be one of: ${VALID_LESSON_TYPES.join(', ')}`;
    }
  }

  if (displayOrder !== undefined && displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
    return 'displayOrder must be an integer';
  }

  if (isFreePreview !== undefined && typeof isFreePreview !== 'boolean') {
    return 'isFreePreview must be a boolean';
  }

  return null;
}

// POST /api/chapters/:chapterId/lessons
async function createLesson(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    if (isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id' } });
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    const err = validateLessonInput(req.body);
    if (err) {
      return res.status(400).json({ error: { message: err } });
    }

    const { title, type, content, displayOrder, isFreePreview } = req.body;

    const lesson = await prisma.lesson.create({
      data: {
        chapterId,
        title: title.trim(),
        type,
        content: content ?? null,
        displayOrder: displayOrder !== undefined && displayOrder !== null ? Number(displayOrder) : 0,
        isFreePreview: isFreePreview ?? false,
      },
    });

    return res.status(201).json({ lesson });
  } catch (error) {
    console.error('Create lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the lesson' } });
  }
}

// GET /api/chapters/:chapterId/lessons
async function getLessons(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    if (isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id' } });
    }

    const lessons = await prisma.lesson.findMany({
      where: { chapterId },
      orderBy: { displayOrder: 'asc' },
    });

    return res.status(200).json({ lessons });
  } catch (error) {
    console.error('Get lessons error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching lessons' } });
  }
}

// GET /api/chapters/:chapterId/lessons/:lessonId
async function getLessonById(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    const lessonId = Number(req.params.lessonId);
    if (isNaN(chapterId) || isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson || lesson.chapterId !== chapterId) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    return res.status(200).json({ lesson });
  } catch (error) {
    console.error('Get lesson by id error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the lesson' } });
  }
}

// PUT /api/chapters/:chapterId/lessons/:lessonId
async function updateLesson(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    const lessonId = Number(req.params.lessonId);
    if (isNaN(chapterId) || isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
    }

    const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!existing || existing.chapterId !== chapterId) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    const err = validateLessonInput(req.body, { partial: true });
    if (err) {
      return res.status(400).json({ error: { message: err } });
    }

    const { title, type, content, displayOrder, isFreePreview } = req.body;
    const data = {};

    if (title !== undefined) data.title = title.trim();
    if (type !== undefined) data.type = type;
    if (content !== undefined) data.content = content === null ? null : String(content);
    if (displayOrder !== undefined) data.displayOrder = displayOrder === null ? 0 : Number(displayOrder);
    if (isFreePreview !== undefined) data.isFreePreview = isFreePreview;

    const lesson = await prisma.lesson.update({ where: { id: lessonId }, data });
    return res.status(200).json({ lesson });
  } catch (error) {
    console.error('Update lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the lesson' } });
  }
}

// DELETE /api/chapters/:chapterId/lessons/:lessonId
async function deleteLesson(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    const lessonId = Number(req.params.lessonId);
    if (isNaN(chapterId) || isNaN(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
    }

    const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!existing || existing.chapterId !== chapterId) {
      return res.status(404).json({ error: { message: 'Lesson not found' } });
    }

    await prisma.lesson.delete({ where: { id: lessonId } });
    return res.status(200).json({ message: 'Lesson deleted successfully', lessonId });
  } catch (error) {
    console.error('Delete lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the lesson' } });
  }
}

module.exports = { createLesson, getLessons, getLessonById, updateLesson, deleteLesson };