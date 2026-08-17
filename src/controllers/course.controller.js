


const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_STATUSES = ['draft', 'published', 'archived'];
const VALID_ACCESS_TYPES = ['free', 'premium'];

function validateCourseTypeInput(ct, index) {
  if (!ct.title || typeof ct.title !== 'string' || ct.title.trim().length === 0) {
    return `courseTypes[${index}].title is required`;
  }
  if (ct.status !== undefined && !VALID_STATUSES.includes(ct.status)) {
    return `courseTypes[${index}].status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (ct.accessType !== undefined && !VALID_ACCESS_TYPES.includes(ct.accessType)) {
    return `courseTypes[${index}].accessType must be 'free' or 'premium'`;
  }
  if (ct.displayOrder !== undefined && ct.displayOrder !== null && !Number.isInteger(Number(ct.displayOrder))) {
    return `courseTypes[${index}].displayOrder must be an integer`;
  }
  return null;
}

async function createCourse(req, res) {
  try {
    const {
      title,
      description,
      thumbnail,
      classGrade,
      difficulty,
      accessType,
      displayOrder,
      status,
      courseTypes, // NEW: optional array, e.g. [{ title: "DHA Exam", ... }, { title: "HAD Exam", ... }]
    } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Title is required' },
      });
    }

    if (accessType !== undefined && !VALID_ACCESS_TYPES.includes(accessType)) {
      return res.status(400).json({
        error: { message: "accessType must be 'free' or 'premium'" },
      });
    }

    if (displayOrder !== undefined && !Number.isInteger(Number(displayOrder))) {
      return res.status(400).json({
        error: { message: 'displayOrder must be an integer' },
      });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      });
    }

    // NEW: validate courseTypes array if provided
    let courseTypeCreates = [];

    if (courseTypes !== undefined) {
      if (!Array.isArray(courseTypes)) {
        return res.status(400).json({
          error: { message: 'courseTypes must be an array' },
        });
      }

      for (let i = 0; i < courseTypes.length; i++) {
        const err = validateCourseTypeInput(courseTypes[i], i);
        if (err) {
          return res.status(400).json({ error: { message: err } });
        }
      }

      courseTypeCreates = courseTypes.map((ct) => ({
        title: ct.title.trim(),
        description: ct.description ?? null,
        status: ct.status ?? 'draft',
        accessType: ct.accessType ?? 'free',
        displayOrder: ct.displayOrder !== undefined && ct.displayOrder !== null
          ? Number(ct.displayOrder)
          : null, // optional — stays null if not given
      }));
    }

    const course = await prisma.course.create({
      data: {
        title: title.trim(),
        description: description ?? null,
        thumbnail: thumbnail ?? null,
        classGrade: classGrade ?? null,
        difficulty: difficulty ?? null,
        accessType: accessType ?? 'free',
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
        status: status ?? 'draft',
        courseTypes: {
          create: courseTypeCreates,
        },
      },
      include: {
        courseTypes: {
          orderBy: { displayOrder: 'asc' },
        },
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

// NEW: add a single courseType to an existing course later
// POST /api/courses/:id/course-types
async function addCourseType(req, res) {
  try {
    const courseId = Number(req.params.id);

    if (isNaN(courseId)) {
      return res.status(400).json({
        error: { message: 'Invalid course id' },
      });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });

    if (!course) {
      return res.status(404).json({
        error: { message: 'Course not found' },
      });
    }

    const err = validateCourseTypeInput(req.body, 0);
    if (err) {
      return res.status(400).json({ error: { message: err.replace('courseTypes[0]', 'body') } });
    }

    const { title, description, status, accessType, displayOrder } = req.body;

    const courseType = await prisma.courseType.create({
      data: {
        courseId,
        title: title.trim(),
        description: description ?? null,
        status: status ?? 'draft',
        accessType: accessType ?? 'free',
        displayOrder: displayOrder !== undefined && displayOrder !== null ? Number(displayOrder) : null,
      },
    });

    return res.status(201).json({ courseType });
  } catch (error) {
    console.error('Add course type error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while adding the course type' },
    });
  }
}

async function getCourses(req, res) {
  try {
    const { status, search, page, limit } = req.query;

    const where = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        });
      }
      where.status = status;
    }

    if (search !== undefined && search.trim().length > 0) {
      where.title = {
        contains: search.trim(),
        mode: 'insensitive',
      };
    }

    const pageNum = page !== undefined ? Number(page) : 1;
    const limitNum = limit !== undefined ? Number(limit) : 20;

    if (!Number.isInteger(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: { message: 'page must be a positive integer' },
      });
    }

    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: { message: 'limit must be an integer between 1 and 100' },
      });
    }

    const [courses, totalCount] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          courseTypes: {
            orderBy: { displayOrder: 'asc' },
          },
          chapters: {
            select: { id: true },
          },
        },
        orderBy: { displayOrder: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.course.count({ where }),
    ]);

    const coursesWithLessonCount = courses.map((course) => ({
      ...course,
      chapterCount: course.chapters.length,
      chapters: undefined,
    }));

    return res.status(200).json({
      courses: coursesWithLessonCount,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    console.error('Get courses error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching courses' },
    });
  }
}

async function getCourseDetails(req, res) {
  try {
    const courseId = Number(req.params.id);

    if (isNaN(courseId)) {
      return res.status(400).json({
        error: { message: "Invalid course id" },
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        admin: {
          select: { id: true, name: true, email: true },
        },
        courseTypes: {
          include: {
            chapters: {
              include: { lessons: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
        chapters: {
          include: { lessons: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        error: { message: "Course not found" },
      });
    }

    // count lessons across both standalone chapters and courseType chapters
    const standaloneLessons = course.chapters.reduce(
      (count, chapter) => count + chapter.lessons.length,
      0
    );
    const courseTypeLessons = course.courseTypes.reduce(
      (sum, ct) => sum + ct.chapters.reduce((c, ch) => c + ch.lessons.length, 0),
      0
    );

    return res.status(200).json({
      course: {
        ...course,
        chapterCount: course.chapters.length,
        lessonCount: standaloneLessons + courseTypeLessons,
      },
    });
  } catch (error) {
    console.error("Get Course Details Error:", error);
    return res.status(500).json({
      error: { message: "Something went wrong while fetching course details" },
    });
  }
}

// PUT /api/courses/:id — edit an existing course
async function updateCourse(req, res) {
  try {
    const courseId = Number(req.params.id);

    if (isNaN(courseId)) {
      return res.status(400).json({
        error: { message: 'Invalid course id' },
      });
    }

    const existingCourse = await prisma.course.findUnique({ where: { id: courseId } });

    if (!existingCourse) {
      return res.status(404).json({
        error: { message: 'Course not found' },
      });
    }

    const {
      title,
      description,
      thumbnail,
      classGrade,
      difficulty,
      accessType,
      displayOrder,
      status,
      subjectNames, // optional, array of strings
    } = req.body;

    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: { message: 'Title must be a non-empty string' },
        });
      }
      data.title = title.trim();
    }

    if (description !== undefined) {
      data.description = description === null ? null : String(description);
    }

    if (thumbnail !== undefined) {
      data.thumbnail = thumbnail === null ? null : String(thumbnail);
    }

    if (classGrade !== undefined) {
      data.classGrade = classGrade === null ? null : String(classGrade);
    }

    if (difficulty !== undefined) {
      data.difficulty = difficulty === null ? null : String(difficulty);
    }

    if (accessType !== undefined) {
      if (!VALID_ACCESS_TYPES.includes(accessType)) {
        return res.status(400).json({
          error: { message: "accessType must be 'free' or 'premium'" },
        });
      }
      data.accessType = accessType;
    }

    if (displayOrder !== undefined) {
      if (!Number.isInteger(Number(displayOrder))) {
        return res.status(400).json({
          error: { message: 'displayOrder must be an integer' },
        });
      }
      data.displayOrder = Number(displayOrder);
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        });
      }
      data.status = status;
    }

    if (subjectNames !== undefined) {
      if (!Array.isArray(subjectNames)) {
        return res.status(400).json({
          error: { message: 'subjectNames must be an array of strings' },
        });
      }

      const subjectConnections = [];
      for (const rawName of subjectNames) {
        if (typeof rawName !== 'string' || rawName.trim().length === 0) {
          return res.status(400).json({
            error: { message: 'Each subject name must be a non-empty string' },
          });
        }
        const trimmedName = rawName.trim();

        let subject = await prisma.subject.findUnique({ where: { name: trimmedName } });
        if (!subject) {
          subject = await prisma.subject.create({ data: { name: trimmedName } });
        }
        subjectConnections.push({ id: subject.id });
      }

      // "set" replaces the entire list of linked subjects with this new list
      data.subjects = { set: subjectConnections };
    }

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data,
      include: {
        subjects: true,
        courseTypes: { orderBy: { displayOrder: 'asc' } },
      },
    });

    return res.status(200).json({ course: updatedCourse });
  } catch (error) {
    console.error('Update course error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while updating the course' },
    });
  }
}

// DELETE /api/courses/:id — permanently delete a course (and its chapters/lessons/courseTypes via cascade)
async function deleteCourse(req, res) {
  try {
    const courseId = Number(req.params.id);

    if (isNaN(courseId)) {
      return res.status(400).json({
        error: { message: 'Invalid course id' },
      });
    }

    const existingCourse = await prisma.course.findUnique({ where: { id: courseId } });

    if (!existingCourse) {
      return res.status(404).json({
        error: { message: 'Course not found' },
      });
    }

    await prisma.course.delete({ where: { id: courseId } });

    return res.status(200).json({
      message: 'Course deleted successfully',
      courseId,
    });
  } catch (error) {
    console.error('Delete course error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while deleting the course' },
    });
  }
}


// PUT /api/courses/:courseId/course-types/:courseTypeId — edit an exam type
async function updateCourseType(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const courseTypeId = Number(req.params.courseTypeId);

    if (isNaN(courseId) || isNaN(courseTypeId)) {
      return res.status(400).json({
        error: { message: 'Invalid course id or course type id' },
      });
    }

    const existingCourseType = await prisma.courseType.findUnique({
      where: { id: courseTypeId },
    });

    if (!existingCourseType) {
      return res.status(404).json({
        error: { message: 'Course type not found' },
      });
    }

    if (existingCourseType.courseId !== courseId) {
      return res.status(400).json({
        error: { message: 'This course type does not belong to the given course' },
      });
    }

    const { title, description, status, accessType, displayOrder } = req.body;

    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: { message: 'Title must be a non-empty string' },
        });
      }
      data.title = title.trim();
    }

    if (description !== undefined) {
      data.description = description === null ? null : String(description);
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        });
      }
      data.status = status;
    }

    if (accessType !== undefined) {
      if (!VALID_ACCESS_TYPES.includes(accessType)) {
        return res.status(400).json({
          error: { message: "accessType must be 'free' or 'premium'" },
        });
      }
      data.accessType = accessType;
    }

    if (displayOrder !== undefined) {
      if (displayOrder !== null && !Number.isInteger(Number(displayOrder))) {
        return res.status(400).json({
          error: { message: 'displayOrder must be an integer or null' },
        });
      }
      data.displayOrder = displayOrder === null ? null : Number(displayOrder);
    }

    const updatedCourseType = await prisma.courseType.update({
      where: { id: courseTypeId },
      data,
    });

    return res.status(200).json({ courseType: updatedCourseType });
  } catch (error) {
    console.error('Update course type error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while updating the course type' },
    });
  }
}

// DELETE /api/courses/:courseId/course-types/:courseTypeId — delete an exam type
async function deleteCourseType(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const courseTypeId = Number(req.params.courseTypeId);

    if (isNaN(courseId) || isNaN(courseTypeId)) {
      return res.status(400).json({
        error: { message: 'Invalid course id or course type id' },
      });
    }

    const existingCourseType = await prisma.courseType.findUnique({
      where: { id: courseTypeId },
    });

    if (!existingCourseType) {
      return res.status(404).json({
        error: { message: 'Course type not found' },
      });
    }

    if (existingCourseType.courseId !== courseId) {
      return res.status(400).json({
        error: { message: 'This course type does not belong to the given course' },
      });
    }

    await prisma.courseType.delete({ where: { id: courseTypeId } });

    return res.status(200).json({
      message: 'Course type deleted successfully',
      courseTypeId,
    });
  } catch (error) {
    console.error('Delete course type error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while deleting the course type' },
    });
  }
}



// GET /api/courses/:id/course-types  (student-facing: pick your exam type)
// Published types only, no chapters/lessons — those come from
// /api/users/me/selection/content once the student saves the pick.
async function getPublicCourseTypes(req, res) {
  try {
    const courseId = Number(req.params.id);

    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });

    if (!course) {
      return res.status(404).json({ error: { message: 'Course not found' } });
    }

    const courseTypes = await prisma.courseType.findMany({
      where: { courseId, status: 'published' },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        accessType: true,
        displayOrder: true,
        _count: { select: { chapters: true } },
      },
    });

    return res.status(200).json({
      course,
      courseTypes: courseTypes.map(({ _count, ...ct }) => ({
        ...ct,
        chapterCount: _count.chapters,
      })),
    });
  } catch (error) {
    console.error('Get public course types error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching course types' },
    });
  }
}

module.exports = { createCourse, getCourses, getCourseDetails, getPublicCourseTypes, addCourseType , updateCourse, deleteCourse, updateCourseType, deleteCourseType,};