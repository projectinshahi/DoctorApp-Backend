const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SUBJECT_SELECT = {
  id: true,
  name: true,
  isActive: true,
  displayOrder: true,
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

    const subjects = await prisma.subject.findMany({
      where: filter.value === undefined ? {} : { isActive: filter.value },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: SUBJECT_SELECT,
    });
    return res.status(200).json({ subjects });
  } catch (error) {
    console.error('List subjects error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching subjects' },
    });
  }
}

// POST /api/subjects
async function createSubject(req, res) {
  try {
    const { name, isActive, displayOrder } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Subject name is required' },
      });
    }

    if (displayOrder !== undefined && !Number.isInteger(Number(displayOrder))) {
      return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
    }

    const subject = await prisma.subject.create({
      data: {
        name: name.trim(),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
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

    const { name, isActive, displayOrder } = req.body;
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

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data,
      select: SUBJECT_SELECT,
    });

    return res.status(200).json({ subject });
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

    const { name, isActive, displayOrder } = req.body;

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

    const { name, isActive, displayOrder } = req.body;
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
