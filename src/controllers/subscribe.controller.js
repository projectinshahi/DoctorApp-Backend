// Add to a new file: src/controllers/subscribe.controller.js
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// POST /api/users/me/subscribe
// Body: { planId: 3 }
async function subscribeToplan(req, res) {
  try {
    const userId = req.user.userId;
    const { planId } = req.body;

    if (!planId || !Number.isInteger(Number(planId))) {
      return res.status(400).json({ error: { message: 'planId is required' } });
    }

    const plan = await prisma.plan.findUnique({ where: { id: Number(planId) } });

    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: { message: 'Plan not found or inactive' } });
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    // NOTE: in production, this would only run AFTER a real payment
    // gateway confirms the transaction succeeded.
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        courseId: plan.courseId,
        planId: plan.id,
        endDate,
      },
    });

    return res.status(201).json({ subscription });
  } catch (error) {
    console.error('Subscribe error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while subscribing' },
    });
  }
}

module.exports = { subscribeToplan };