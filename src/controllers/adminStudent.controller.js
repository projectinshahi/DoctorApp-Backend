const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// GET /admin/students?page=1&limit=10&search=abc
async function getStudentList(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const search = (req.query.search || '').trim();

    const where = {
      role: 'student',
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

module.exports = { getStudentList };