const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const { revokeActiveSessions } = require('../services/session.service');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// 'unverified' is the signup default, 'verified' is set on first Google login,
// 'blocked' is the admin kill switch enforced in authenticateStudent.
const VALID_STUDENT_STATUSES = ['unverified', 'verified', 'blocked'];

// GET /admin/students?page=1&limit=10&search=abc&status=blocked
async function getStudentList(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const search = (req.query.search || '').trim();
    const status = req.query.status;

    if (status !== undefined && !VALID_STUDENT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: { message: `status must be one of: ${VALID_STUDENT_STATUSES.join(', ')}` },
      });
    }

    const where = {
      role: 'student',
      ...(status !== undefined && { status }),
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
          // Logins are single-device, so at most one session is ever unrevoked.
          sessions: {
            where: { revokedAt: null },
            select: { deviceId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
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
      isBlocked: s.status === 'blocked',
      isLoggedIn: s.sessions.length > 0,
      lastLoginAt: s.sessions[0]?.createdAt ?? null,
      currentDeviceId: s.sessions[0]?.deviceId ?? null,
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

// PATCH /admin/students/:id/status
// Body: { "status": "blocked" }
// Blocking also revokes the live session, otherwise the student keeps working
// until their current access token expires.
async function updateStudentStatus(req, res) {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: { message: 'Invalid student id' } });
    }

    const { status } = req.body;
    if (!VALID_STUDENT_STATUSES.includes(status)) {
      return res.status(400).json({
        error: { message: `status must be one of: ${VALID_STUDENT_STATUSES.join(', ')}` },
      });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, role: true, status: true },
    });

    if (!student || student.role !== 'student') {
      return res.status(404).json({ error: { message: 'Student not found' } });
    }

    const updated = await prisma.user.update({
      where: { id: studentId },
      data: { status },
      select: { id: true, name: true, email: true, status: true },
    });

    let sessionsRevoked = 0;
    if (status === 'blocked') {
      const result = await revokeActiveSessions(studentId);
      sessionsRevoked = result.count;
    }

    return res.status(200).json({
      student: { ...updated, isBlocked: updated.status === 'blocked' },
      sessionsRevoked,
    });
  } catch (error) {
    console.error('updateStudentStatus error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while updating the student status' },
    });
  }
}

module.exports = { getStudentList, updateStudentStatus };