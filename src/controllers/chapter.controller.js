const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function validateChapterInput(body) {
  const { title, displayOrder } = body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return 'title is required';
  }
  if (displayOrder !== undefined && displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
    return 'displayOrder must be an integer';
  }
  return null;
}

// POST /api/course-types/:courseTypeId/chapters
async function createChapter(req, res) {
  try {
    const courseTypeId = Number(req.params.courseTypeId);
    if (isNaN(courseTypeId)) {
      return res.status(400).json({ error: { message: 'Invalid course type id' } });
    }

    const courseType = await prisma.courseType.findUnique({ where: { id: courseTypeId } });
    if (!courseType) {
      return res.status(404).json({ error: { message: 'Course type not found' } });
    }

    const err = validateChapterInput(req.body);
    if (err) {
      return res.status(400).json({ error: { message: err } });
    }

    const { title, displayOrder } = req.body;

    const chapter = await prisma.chapter.create({
      data: {
        courseTypeId,
        title: title.trim(),
        displayOrder: displayOrder !== undefined && displayOrder !== null ? Number(displayOrder) : 0,
      },
    });

    return res.status(201).json({ chapter });
  } catch (error) {
    console.error('Create chapter error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the chapter' } });
  }
}

// GET /api/chapters?courseId=&courseTypeId=&includeLessons=true
// Every chapter in the system, for the admin. The course-type-scoped list
// below can't see chapters attached straight to a course (Chapter.courseId),
// so this is the only view that shows all of them.
async function getAllChapters(req, res) {
  try {
    const where = {};

    if (req.query.courseId !== undefined) {
      const courseId = Number(req.query.courseId);
      if (!Number.isInteger(courseId)) {
        return res.status(400).json({ error: { message: 'courseId must be an integer' } });
      }
      where.courseId = courseId;
    }

    if (req.query.courseTypeId !== undefined) {
      const courseTypeId = Number(req.query.courseTypeId);
      if (!Number.isInteger(courseTypeId)) {
        return res.status(400).json({ error: { message: 'courseTypeId must be an integer' } });
      }
      where.courseTypeId = courseTypeId;
    }

    // Lessons are opt-in: a full tree is heavy once the syllabus grows, and a
    // list screen only needs the count.
    const includeLessons = req.query.includeLessons === 'true';

    const chapters = await prisma.chapter.findMany({
      where,
      orderBy: [{ courseTypeId: 'asc' }, { courseId: 'asc' }, { displayOrder: 'asc' }],
      select: {
        id: true,
        title: true,
        displayOrder: true,
        courseId: true,
        courseTypeId: true,
        course: { select: { id: true, title: true } },
        courseType: { select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true } } } },
        createdAt: true,
        updatedAt: true,
        ...(includeLessons
          ? { lessons: { select: { id: true, title: true, type: true, status: true, displayOrder: true }, orderBy: { displayOrder: 'asc' } } }
          : { _count: { select: { lessons: true } } }),
      },
    });

    // Flatten "which course does this belong to" so the client doesn't have to
    // care whether the chapter hangs off a course or a course type.
    const shaped = chapters.map((chapter) => {
      const { _count, courseType, course, ...rest } = chapter;
      return {
        ...rest,
        course: course ?? courseType?.course ?? null,
        courseType: courseType ? { id: courseType.id, title: courseType.title } : null,
        lessonCount: _count ? _count.lessons : (chapter.lessons ? chapter.lessons.length : 0),
      };
    });

    return res.status(200).json({ chapters: shaped, total: shaped.length });
  } catch (error) {
    console.error('Get all chapters error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching chapters' } });
  }
}

// GET /api/course-types/:courseTypeId/chapters
async function getChapters(req, res) {
  try {
    const courseTypeId = Number(req.params.courseTypeId);
    if (isNaN(courseTypeId)) {
      return res.status(400).json({ error: { message: 'Invalid course type id' } });
    }

    const chapters = await prisma.chapter.findMany({
      where: { courseTypeId },
      include: { lessons: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { displayOrder: 'asc' },
    });

    return res.status(200).json({ chapters });
  } catch (error) {
    console.error('Get chapters error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching chapters' } });
  }
}

// GET /api/course-types/:courseTypeId/chapters/:chapterId
async function getChapterById(req, res) {
  try {
    const courseTypeId = Number(req.params.courseTypeId);
    const chapterId = Number(req.params.chapterId);
    if (isNaN(courseTypeId) || isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid course type id or chapter id' } });
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { lessons: { orderBy: { displayOrder: 'asc' } } },
    });

    if (!chapter || chapter.courseTypeId !== courseTypeId) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    return res.status(200).json({ chapter });
  } catch (error) {
    console.error('Get chapter by id error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the chapter' } });
  }
}

// PUT /api/course-types/:courseTypeId/chapters/:chapterId
async function updateChapter(req, res) {
  try {
    const courseTypeId = Number(req.params.courseTypeId);
    const chapterId = Number(req.params.chapterId);
    if (isNaN(courseTypeId) || isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid course type id or chapter id' } });
    }

    const existing = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!existing || existing.courseTypeId !== courseTypeId) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    const { title, displayOrder } = req.body;
    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: { message: 'title must be a non-empty string' } });
      }
      data.title = title.trim();
    }

    if (displayOrder !== undefined) {
      if (displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
        return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
      }
      data.displayOrder = displayOrder === null ? 0 : Number(displayOrder);
    }

    const chapter = await prisma.chapter.update({ where: { id: chapterId }, data });
    return res.status(200).json({ chapter });
  } catch (error) {
    console.error('Update chapter error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the chapter' } });
  }
}

// DELETE /api/course-types/:courseTypeId/chapters/:chapterId
// Cascades: deleting a chapter deletes all its lessons (schema: onDelete: Cascade).
async function deleteChapter(req, res) {
  try {
    const courseTypeId = Number(req.params.courseTypeId);
    const chapterId = Number(req.params.chapterId);
    if (isNaN(courseTypeId) || isNaN(chapterId)) {
      return res.status(400).json({ error: { message: 'Invalid course type id or chapter id' } });
    }

    const existing = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!existing || existing.courseTypeId !== courseTypeId) {
      return res.status(404).json({ error: { message: 'Chapter not found' } });
    }

    await prisma.chapter.delete({ where: { id: chapterId } });
    return res.status(200).json({ message: 'Chapter deleted successfully', chapterId });
  } catch (error) {
    console.error('Delete chapter error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the chapter' } });
  }
}

module.exports = { createChapter, getAllChapters, getChapters, getChapterById, updateChapter, deleteChapter };