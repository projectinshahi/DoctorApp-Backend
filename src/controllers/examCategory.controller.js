const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// GET /api/exam-categories
// Returns every category with its exam types and each exam type's courses.
// This matches your screenshot: "Gulf license exam (GP)" header -> DHA/HAD/MOH/... rows.
async function getExamCategories(req, res) {
  try {
    const categories = await prisma.examCategory.findMany({
      include: {
        examTypes: {
          include: {
            courses: {
              select: {
                id: true,
                title: true,
                status: true,
                accessType: true,
                displayOrder: true,
              },
              orderBy: { displayOrder: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({ examCategories: categories });
  } catch (error) {
    console.error('Get exam categories error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching exam categories' },
    });
  }
}

// GET /api/exam-categories/:id
// Single category with its exam types + courses (detail screen for one group)
async function getExamCategoryDetails(req, res) {
  try {
    const categoryId = Number(req.params.id);

    if (isNaN(categoryId)) {
      return res.status(400).json({
        error: { message: 'Invalid exam category id' },
      });
    }

    const category = await prisma.examCategory.findUnique({
      where: { id: categoryId },
      include: {
        examTypes: {
          include: {
            courses: {
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                accessType: true,
                displayOrder: true,
              },
              orderBy: { displayOrder: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        error: { message: 'Exam category not found' },
      });
    }

    return res.status(200).json({ examCategory: category });
  } catch (error) {
    console.error('Get exam category details error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching exam category details' },
    });
  }
}

module.exports = { getExamCategories, getExamCategoryDetails };