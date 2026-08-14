const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const cloudinary = require('../config/cloudinary');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_LESSON_TYPES = ['video', 'text', 'quiz'];
const VALID_ACCESS_TYPES = ['free', 'premium'];

// Explicit field list, reused across getLesson / getLessonsByChapter, so
// the response shape is guaranteed and self-documenting - always includes
// video (url + publicId), notes (url + publicId + fileType), and thumbnail.
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
  displayOrder: true,
  isFreePreview: true,
  accessType: true,
  createdAt: true,
  updatedAt: true,
};

// POST /api/chapters/:chapterId/lessons
async function createLesson(req, res) {
  try {
    const chapterId = Number(req.params.chapterId);
    const {
      title, description, type, videoUrl, videoPublicId,
      thumbnailUrl, thumbnailPublicId,
      noteUrl, notePublicId, noteFileType,
      content, displayOrder, isFreePreview, accessType,
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
        content: content ?? null,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
        isFreePreview: Boolean(isFreePreview) || false,
        accessType: accessType ?? 'free',
      },
      select: LESSON_SELECT,
    });

    return res.status(201).json({ lesson });
  } catch (error) {
    console.error('Create lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the lesson' } });
  }
}

// GET /api/lessons/:id
// Returns everything for a single lesson by its own id - video (url +
// publicId), notes (url + publicId + fileType), thumbnail, quiz content,
// and access settings, all in one response. Optionally includes the
// parent chapter (id, title, courseId/courseTypeId) via ?includeChapter=true,
// useful for breadcrumbs on a lesson detail screen.
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

    return res.status(200).json({ lesson });
  } catch (error) {
    console.error('Get lesson error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the lesson' } });
  }
}

// GET /api/chapters/:chapterId/lessons
// Lists every lesson under a chapter, ordered for display, each one
// carrying its own video/note/thumbnail fields via LESSON_SELECT.
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

    return res.status(200).json({ lessons });
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
      content, displayOrder, isFreePreview, accessType,
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
    if (content !== undefined) data.content = content;
    if (displayOrder !== undefined) data.displayOrder = Number(displayOrder);
    if (isFreePreview !== undefined) data.isFreePreview = Boolean(isFreePreview);

    const lesson = await prisma.lesson.update({
      where: { id: lessonId },
      data,
      select: LESSON_SELECT,
    });

    return res.status(200).json({ lesson });
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

module.exports = {
  createLesson,
  getLesson,
  getLessonsByChapter,
  updateLesson,
  deleteLesson,
};