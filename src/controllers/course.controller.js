const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function createCourse(req, res) {
  try {
    const {
      title,
      description,
      thumbnail,
      subjectId,
      classGrade,
      difficulty,
      accessType,
      displayOrder,
    } = req.body;

    // ── Server-side validation (acceptance criteria #2) ──
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Title is required' },
      });
    }

    if (subjectId !== undefined && subjectId !== null) {
      const subjectIdNum = Number(subjectId);
      if (!Number.isInteger(subjectIdNum)) {
        return res.status(400).json({
          error: { message: 'subjectId must be a valid integer' },
        });
      }

      const subjectExists = await prisma.subject.findUnique({
        where: { id: subjectIdNum },
      });
      if (!subjectExists) {
        return res.status(400).json({
          error: { message: 'Subject not found' },
        });
      }
    }

    if (accessType !== undefined && !['free', 'premium'].includes(accessType)) {
      return res.status(400).json({
        error: { message: "accessType must be 'free' or 'premium'" },
      });
    }

    if (displayOrder !== undefined && !Number.isInteger(Number(displayOrder))) {
      return res.status(400).json({
        error: { message: 'displayOrder must be an integer' },
      });
    }

    // ── Create the course (acceptance criteria #1 & #3) ──
    const course = await prisma.course.create({
      data: {
        title: title.trim(),
        description: description ?? null,
        thumbnail: thumbnail ?? null, // Cloudinary URL reference stored as-is
        subjectId: subjectId !== undefined && subjectId !== null ? Number(subjectId) : null,
        classGrade: classGrade ?? null,
        difficulty: difficulty ?? null,
        accessType: accessType ?? 'free',
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
        status: 'draft', // always draft by default, regardless of what's sent
      },
    });

    return res.status(201).json({ course });
  } catch (error) {
    console.error('Create course error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while creating the course' },
    });
  }
}

module.exports = { createCourse };