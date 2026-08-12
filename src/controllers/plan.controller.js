const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// POST /api/courses/:courseId/plans
async function createPlan(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const { title, description, price, durationDays } = req.body;

    if (isNaN(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return res.status(404).json({ error: { message: 'Course not found' } });
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: { message: 'Title is required' } });
    }

    if (typeof price !== 'number' || price <= 0) {
      return res.status(400).json({ error: { message: 'price must be a positive number' } });
    }

    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      return res.status(400).json({ error: { message: 'durationDays must be a positive integer' } });
    }

    const plan = await prisma.plan.create({
      data: {
        courseId,
        title: title.trim(),
        description: description ?? null,
        price,
        durationDays,
      },
    });

    return res.status(201).json({ plan });
  } catch (error) {
    console.error('Create plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the plan' } });
  }
}

// GET /api/courses/:courseId/plans
async function getPlansForCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);

    if (isNaN(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const plans = await prisma.plan.findMany({
      where: { courseId },
      orderBy: { price: 'asc' },
    });

    return res.status(200).json({ plans });
  } catch (error) {
    console.error('Get plans error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching plans' } });
  }
}

// PUT /api/plans/:id
async function updatePlan(req, res) {
  try {
    const planId = Number(req.params.id);

    if (isNaN(planId)) {
      return res.status(400).json({ error: { message: 'Invalid plan id' } });
    }

    const existing = await prisma.plan.findUnique({ where: { id: planId } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Plan not found' } });
    }

    const { title, description, price, durationDays, isActive } = req.body;
    const data = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: { message: 'Title must be a non-empty string' } });
      }
      data.title = title.trim();
    }

    if (description !== undefined) {
      data.description = description === null ? null : String(description);
    }

    if (price !== undefined) {
      if (typeof price !== 'number' || price <= 0) {
        return res.status(400).json({ error: { message: 'price must be a positive number' } });
      }
      data.price = price;
    }

    if (durationDays !== undefined) {
      if (!Number.isInteger(durationDays) || durationDays <= 0) {
        return res.status(400).json({ error: { message: 'durationDays must be a positive integer' } });
      }
      data.durationDays = durationDays;
    }

    if (isActive !== undefined) {
      data.isActive = Boolean(isActive);
    }

    const plan = await prisma.plan.update({ where: { id: planId }, data });

    return res.status(200).json({ plan });
  } catch (error) {
    console.error('Update plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the plan' } });
  }
}

// DELETE /api/plans/:id
async function deletePlan(req, res) {
  try {
    const planId = Number(req.params.id);

    if (isNaN(planId)) {
      return res.status(400).json({ error: { message: 'Invalid plan id' } });
    }

    const existing = await prisma.plan.findUnique({ where: { id: planId } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Plan not found' } });
    }

    await prisma.plan.delete({ where: { id: planId } });

    return res.status(200).json({ message: 'Plan deleted successfully', planId });
  } catch (error) {
    console.error('Delete plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the plan' } });
  }
}

module.exports = { createPlan, getPlansForCourse, updatePlan, deletePlan };