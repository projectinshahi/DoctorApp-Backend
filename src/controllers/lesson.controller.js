// const { PrismaClient } = require('../generated/prisma');
// const { PrismaPg } = require('@prisma/adapter-pg');

// const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
// const prisma = new PrismaClient({ adapter });

// const VALID_LESSON_TYPES = ['video', 'text', 'quiz'];
// const VALID_ACCESS_TYPES = ['free', 'premium'];

// function validateLessonInput(body, { partial = false } = {}) {
//   const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = body;

//   if (!partial || title !== undefined) {
//     if (!title || typeof title !== 'string' || title.trim().length === 0) {
//       return 'title is required';
//     }
//   }

//   if (!partial || type !== undefined) {
//     if (!type || !VALID_LESSON_TYPES.includes(type)) {
//       return `type must be one of: ${VALID_LESSON_TYPES.join(', ')}`;
//     }
//   }

//   // videoUrl and noteUrl are both fully optional and independent - a
//   // lesson can have neither, either, or both. No "at least one required" rule.
//   if (videoUrl !== undefined && videoUrl !== null && typeof videoUrl !== 'string') {
//     return 'videoUrl must be a string';
//   }
//   if (noteUrl !== undefined && noteUrl !== null && typeof noteUrl !== 'string') {
//     return 'noteUrl must be a string';
//   }
//   if (content !== undefined && content !== null && typeof content !== 'string') {
//     return 'content must be a string';
//   }

//   if (displayOrder !== undefined && displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
//     return 'displayOrder must be an integer';
//   }

//   if (isFreePreview !== undefined && typeof isFreePreview !== 'boolean') {
//     return 'isFreePreview must be a boolean';
//   }

//   if (accessType !== undefined && accessType !== null && !VALID_ACCESS_TYPES.includes(accessType)) {
//     return `accessType must be one of: ${VALID_ACCESS_TYPES.join(', ')}`;
//   }

//   return null;
// }

// // POST /api/chapters/:chapterId/lessons
// async function createLesson(req, res) {
//   try {
//     const chapterId = Number(req.params.chapterId);
//     if (isNaN(chapterId)) {
//       return res.status(400).json({ error: { message: 'Invalid chapter id' } });
//     }

//     const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
//     if (!chapter) {
//       return res.status(404).json({ error: { message: 'Chapter not found' } });
//     }

//     const err = validateLessonInput(req.body);
//     if (err) {
//       return res.status(400).json({ error: { message: err } });
//     }

//     const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = req.body;

//     const lesson = await prisma.lesson.create({
//       data: {
//         chapterId,
//         title: title.trim(),
//         type,
//         videoUrl: videoUrl ? videoUrl.trim() : null,
//         noteUrl: noteUrl ? noteUrl.trim() : null,
//         content: content ? content.trim() : null,
//         displayOrder: displayOrder !== undefined && displayOrder !== null ? Number(displayOrder) : 0,
//         isFreePreview: isFreePreview ?? false,        // defaults false - requires subscription unless overridden
//         accessType: accessType ?? 'free',              // defaults free unless explicitly set to premium
//       },
//     });

//     return res.status(201).json({ lesson });
//   } catch (error) {
//     console.error('Create lesson error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while creating the lesson' } });
//   }
// }

// // GET /api/chapters/:chapterId/lessons
// async function getLessons(req, res) {
//   try {
//     const chapterId = Number(req.params.chapterId);
//     if (isNaN(chapterId)) {
//       return res.status(400).json({ error: { message: 'Invalid chapter id' } });
//     }

//     const lessons = await prisma.lesson.findMany({
//       where: { chapterId },
//       orderBy: { displayOrder: 'asc' },
//     });

//     return res.status(200).json({ lessons });
//   } catch (error) {
//     console.error('Get lessons error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while fetching lessons' } });
//   }
// }

// // GET /api/chapters/:chapterId/lessons/:lessonId
// async function getLessonById(req, res) {
//   try {
//     const chapterId = Number(req.params.chapterId);
//     const lessonId = Number(req.params.lessonId);
//     if (isNaN(chapterId) || isNaN(lessonId)) {
//       return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
//     }

//     const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
//     if (!lesson || lesson.chapterId !== chapterId) {
//       return res.status(404).json({ error: { message: 'Lesson not found' } });
//     }

//     return res.status(200).json({ lesson });
//   } catch (error) {
//     console.error('Get lesson by id error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while fetching the lesson' } });
//   }
// }

// // PUT /api/chapters/:chapterId/lessons/:lessonId
// async function updateLesson(req, res) {
//   try {
//     const chapterId = Number(req.params.chapterId);
//     const lessonId = Number(req.params.lessonId);
//     if (isNaN(chapterId) || isNaN(lessonId)) {
//       return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
//     }

//     const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
//     if (!existing || existing.chapterId !== chapterId) {
//       return res.status(404).json({ error: { message: 'Lesson not found' } });
//     }

//     const err = validateLessonInput(req.body, { partial: true });
//     if (err) {
//       return res.status(400).json({ error: { message: err } });
//     }

//     const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = req.body;
//     const data = {};

//     if (title !== undefined) data.title = title.trim();
//     if (type !== undefined) data.type = type;
//     if (videoUrl !== undefined) data.videoUrl = videoUrl === null ? null : String(videoUrl).trim();
//     if (noteUrl !== undefined) data.noteUrl = noteUrl === null ? null : String(noteUrl).trim();
//     if (content !== undefined) data.content = content === null ? null : String(content).trim();
//     if (displayOrder !== undefined) data.displayOrder = displayOrder === null ? 0 : Number(displayOrder);
//     if (isFreePreview !== undefined) data.isFreePreview = isFreePreview;
//     if (accessType !== undefined) data.accessType = accessType;

//     const lesson = await prisma.lesson.update({ where: { id: lessonId }, data });
//     return res.status(200).json({ lesson });
//   } catch (error) {
//     console.error('Update lesson error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while updating the lesson' } });
//   }
// }

// // DELETE /api/chapters/:chapterId/lessons/:lessonId
// async function deleteLesson(req, res) {
//   try {
//     const chapterId = Number(req.params.chapterId);
//     const lessonId = Number(req.params.lessonId);
//     if (isNaN(chapterId) || isNaN(lessonId)) {
//       return res.status(400).json({ error: { message: 'Invalid chapter id or lesson id' } });
//     }

//     const existing = await prisma.lesson.findUnique({ where: { id: lessonId } });
//     if (!existing || existing.chapterId !== chapterId) {
//       return res.status(404).json({ error: { message: 'Lesson not found' } });
//     }

//     await prisma.lesson.delete({ where: { id: lessonId } });
//     return res.status(200).json({ message: 'Lesson deleted successfully', lessonId });
//   } catch (error) {
//     console.error('Delete lesson error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while deleting the lesson' } });
//   }
// }

// module.exports = { createLesson, getLessons, getLessonById, updateLesson, deleteLesson };


const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_LESSON_TYPES = ['video', 'text', 'quiz'];
const VALID_ACCESS_TYPES = ['free', 'premium'];

function validateLessonInput(body, { partial = false } = {}) {
  const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = body;

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

  // videoUrl and noteUrl are both fully optional and independent - a
  // lesson can have neither, either, or both. No "at least one required" rule.
  if (videoUrl !== undefined && videoUrl !== null && typeof videoUrl !== 'string') {
    return 'videoUrl must be a string';
  }
  if (noteUrl !== undefined && noteUrl !== null && typeof noteUrl !== 'string') {
    return 'noteUrl must be a string';
  }
  if (content !== undefined && content !== null && typeof content !== 'string') {
    return 'content must be a string';
  }

  if (displayOrder !== undefined && displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
    return 'displayOrder must be an integer';
  }

  if (isFreePreview !== undefined && typeof isFreePreview !== 'boolean') {
    return 'isFreePreview must be a boolean';
  }

  if (accessType !== undefined && accessType !== null && !VALID_ACCESS_TYPES.includes(accessType)) {
    return `accessType must be one of: ${VALID_ACCESS_TYPES.join(', ')}`;
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

    const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = req.body;

    const lesson = await prisma.lesson.create({
      data: {
        chapterId,
        title: title.trim(),
        type,
        videoUrl: videoUrl ? videoUrl.trim() : null,
        noteUrl: noteUrl ? noteUrl.trim() : null,
        content: content ? content.trim() : null,
        displayOrder: displayOrder !== undefined && displayOrder !== null ? Number(displayOrder) : 0,
        isFreePreview: isFreePreview ?? false,        // defaults false - requires subscription unless overridden
        accessType: accessType ?? 'free',              // defaults free unless explicitly set to premium
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

    const { title, type, videoUrl, noteUrl, content, displayOrder, isFreePreview, accessType } = req.body;
    const data = {};

    if (title !== undefined) data.title = title.trim();
    if (type !== undefined) data.type = type;
    if (videoUrl !== undefined) data.videoUrl = videoUrl === null ? null : String(videoUrl).trim();
    if (noteUrl !== undefined) data.noteUrl = noteUrl === null ? null : String(noteUrl).trim();
    if (content !== undefined) data.content = content === null ? null : String(content).trim();
    if (displayOrder !== undefined) data.displayOrder = displayOrder === null ? 0 : Number(displayOrder);
    if (isFreePreview !== undefined) data.isFreePreview = isFreePreview;
    if (accessType !== undefined) data.accessType = accessType;

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