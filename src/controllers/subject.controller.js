
const prisma = require('../db');

const SUBJECT_SELECT = {
  id: true,
  name: true,
  isActive: true,
  displayOrder: true,
  // Which courses this subject belongs to. Empty means shared — it shows
  // under every course, which is what every subject written before this was.
  courses: { select: { id: true, title: true } },
  createdAt: true,
  updatedAt: true,
};

const TOPIC_SELECT = {
  id: true,
  subjectId: true,
  name: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
};

// `?isActive=true|false` narrows the list; without it everything comes back,
// so existing callers that expect the full list keep working.
function readIsActiveFilter(query) {
  if (query.isActive === undefined) return { value: undefined };
  if (query.isActive === 'true') return { value: true };
  if (query.isActive === 'false') return { value: false };
  return { error: "isActive must be 'true' or 'false'" };
}

// GET /api/subjects
async function listSubjects(req, res) {
  try {
    const filter = readIsActiveFilter(req.query);
    if (filter.error) {
      return res.status(400).json({ error: { message: filter.error } });
    }

    const where = filter.value === undefined ? {} : { isActive: filter.value };

    // ?courseId= narrows to that course's subjects plus the shared ones. A
    // subject with no course attached belongs to everybody — filtering it out
    // would empty every screen, since that is what every subject is until an
    // admin attaches it.
    if (req.query.courseId !== undefined) {
      const courseId = Number(req.query.courseId);
      if (!Number.isInteger(courseId)) {
        return res.status(400).json({ error: { message: 'courseId must be an integer' } });
      }
      where.OR = [
        { courses: { some: { id: courseId } } },
        { courses: { none: {} } },
      ];
    }

    const subjects = await prisma.subject.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: SUBJECT_SELECT,
    });

    return res.status(200).json({
      subjects: subjects.map((s) => ({
        ...s,
        // So the panel can show "shared" rather than an empty course list.
        isShared: s.courses.length === 0,
      })),
    });
  } catch (error) {
    console.error('List subjects error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching subjects' },
    });
  }
}

// POST /api/subjects
/**
 * Resolves and validates a `courseIds` body field.
 *
 * A subject with no course attached is treated as shared — it shows under
 * every course. That is what every existing subject is, so filtering can ship
 * without emptying a single screen; an admin narrows a subject by attaching
 * it, rather than having to attach all of them before anything works again.
 */
async function readCourseIds(raw) {
  if (raw === undefined) return { ids: null };
  if (raw === null) return { ids: [] };
  if (!Array.isArray(raw)) return { error: 'courseIds must be an array of course ids' };

  const ids = [...new Set(raw.map(Number))];
  if (ids.some((id) => !Number.isInteger(id))) {
    return { error: 'courseIds must contain integers' };
  }
  if (ids.length === 0) return { ids: [] };

  const found = await prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((c) => c.id === id));
  if (missing.length > 0) {
    return { error: `Course not found: ${missing.join(', ')}` };
  }
  return { ids };
}


async function createSubject(req, res) {
  try {
    const { name, isActive, displayOrder, courseIds } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Subject name is required' },
      });
    }

    if (displayOrder !== undefined && !Number.isInteger(Number(displayOrder))) {
      return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
    }

    const courses = await readCourseIds(courseIds);
    if (courses.error) return res.status(400).json({ error: { message: courses.error } });

    const subject = await prisma.subject.create({
      data: {
        name: name.trim(),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
        ...(courses.ids?.length ? { courses: { connect: courses.ids.map((id) => ({ id })) } } : {}),
      },
      select: SUBJECT_SELECT,
    });

    return res.status(201).json({ subject });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: { message: 'A subject with this name already exists' },
      });
    }
    console.error('Create subject error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while creating the subject' },
    });
  }
}

// PATCH /api/subjects/:id  — rename / reorder / deactivate
async function updateSubject(req, res) {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isInteger(subjectId)) {
      return res.status(400).json({ error: { message: 'Invalid subject id' } });
    }

    const existing = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Subject not found' } });
    }

    const { name, isActive, displayOrder, courseIds } = req.body;
    const data = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: { message: 'name must be a non-empty string' } });
      }
      data.name = name.trim();
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: { message: 'isActive must be a boolean' } });
      }
      data.isActive = isActive;
    }

    if (displayOrder !== undefined) {
      if (!Number.isInteger(Number(displayOrder))) {
        return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
      }
      data.displayOrder = Number(displayOrder);
    }

    // `set` rather than `connect`: sending the list replaces it, so removing a
    // course is the same call as adding one. [] detaches everything, which
    // makes the subject shared again.
    const courses = await readCourseIds(courseIds);
    if (courses.error) return res.status(400).json({ error: { message: courses.error } });
    if (courses.ids !== null) {
      data.courses = { set: courses.ids.map((id) => ({ id })) };
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data,
      select: SUBJECT_SELECT,
    });

    return res.status(200).json({
      subject: { ...subject, isShared: subject.courses.length === 0 },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: { message: 'A subject with this name already exists' } });
    }
    console.error('Update subject error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the subject' } });
  }
}

// GET /api/subjects/:subjectId/topics
async function listTopicsForSubject(req, res) {
  try {
    const subjectId = Number(req.params.subjectId);
    if (!Number.isInteger(subjectId)) {
      return res.status(400).json({ error: { message: 'Invalid subject id' } });
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
    if (!subject) {
      return res.status(404).json({ error: { message: 'Subject not found' } });
    }

    const filter = readIsActiveFilter(req.query);
    if (filter.error) {
      return res.status(400).json({ error: { message: filter.error } });
    }

    const topics = await prisma.topic.findMany({
      where: filter.value === undefined ? { subjectId } : { subjectId, isActive: filter.value },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: TOPIC_SELECT,
    });

    return res.status(200).json({ topics });
  } catch (error) {
    console.error('List topics error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching topics' } });
  }
}

// POST /api/subjects/:subjectId/topics
async function createTopic(req, res) {
  try {
    const subjectId = Number(req.params.subjectId);
    if (!Number.isInteger(subjectId)) {
      return res.status(400).json({ error: { message: 'Invalid subject id' } });
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
    if (!subject) {
      return res.status(404).json({ error: { message: 'Subject not found' } });
    }

    const { name, isActive, displayOrder, courseIds } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: { message: 'Topic name is required' } });
    }

    if (displayOrder !== undefined && !Number.isInteger(Number(displayOrder))) {
      return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
    }

    const topic = await prisma.topic.create({
      data: {
        subjectId,
        name: name.trim(),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
      },
      select: TOPIC_SELECT,
    });

    return res.status(201).json({ topic });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: { message: 'This subject already has a topic with that name' } });
    }
    console.error('Create topic error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the topic' } });
  }
}

// PATCH /api/topics/:id  — rename / reorder / deactivate
async function updateTopic(req, res) {
  try {
    const topicId = Number(req.params.id);
    if (!Number.isInteger(topicId)) {
      return res.status(400).json({ error: { message: 'Invalid topic id' } });
    }

    const existing = await prisma.topic.findUnique({ where: { id: topicId }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Topic not found' } });
    }

    const { name, isActive, displayOrder, courseIds } = req.body;
    const data = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: { message: 'name must be a non-empty string' } });
      }
      data.name = name.trim();
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: { message: 'isActive must be a boolean' } });
      }
      data.isActive = isActive;
    }

    if (displayOrder !== undefined) {
      if (!Number.isInteger(Number(displayOrder))) {
        return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
      }
      data.displayOrder = Number(displayOrder);
    }

    const topic = await prisma.topic.update({
      where: { id: topicId },
      data,
      select: TOPIC_SELECT,
    });

    return res.status(200).json({ topic });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: { message: 'This subject already has a topic with that name' } });
    }
    console.error('Update topic error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the topic' } });
  }
}

module.exports = {
  listSubjects,
  createSubject,
  updateSubject,
  listTopicsForSubject,
  createTopic,
  updateTopic,
};
