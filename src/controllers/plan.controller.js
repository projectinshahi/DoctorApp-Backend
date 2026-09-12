
const prisma = require('../db');

// POST /api/courses/:courseId/plans
// The feature codes the server understands. Sales copy lives in `features`
// and can say anything; this list is what actually unlocks content, so a typo
// here would silently sell access to nothing.
const VALID_ENTITLEMENTS = [
  'mcq', 'mock', 'rapid_recall', 'video_lecture', 'live_class', 'ai_patient',
];

/** "3 months access" beats "90 days access" on a card. */
function derivedDurationLabel(days) {
  if (days % 365 === 0) { const y = days / 365; return `${y} year${y > 1 ? 's' : ''} access`; }
  if (days % 30 === 0 && days >= 60) { const m = days / 30; return `${m} months access`; }
  return `${days} days access`;
}

function shapePlan(plan) {
  return {
    ...plan,
    // Always present, so the card never has to decide how to word it.
    durationLabel: plan.durationLabel ?? derivedDurationLabel(plan.durationDays),
  };
}

/**
 * Reads the card fields off a request body.
 *
 * Shared by createPlan, updatePlan and the nested plans on course creation, so
 * a plan written during course setup cannot end up in a shape the plan editor
 * would reject.
 */
function readPlanFields(body, { partial = false } = {}) {
  const data = {};

  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return { error: 'title is required' };
    }
    data.title = body.title.trim();
  }

  if (body.price !== undefined || !partial) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { error: 'price must be a positive number' };
    }
    data.price = price;
  }

  if (body.durationDays !== undefined || !partial) {
    const days = Number(body.durationDays);
    if (!Number.isInteger(days) || days <= 0) {
      return { error: 'durationDays must be a positive integer' };
    }
    data.durationDays = days;
  }

  if (body.description !== undefined) {
    data.description = body.description === null || String(body.description).trim() === ''
      ? null : String(body.description).trim();
  }

  if (body.currency !== undefined) {
    const c = String(body.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return { error: 'currency must be a 3-letter code, e.g. USD' };
    data.currency = c;
  }

  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) return { error: 'features must be an array of strings' };
    const lines = body.features.map((f) => String(f).trim()).filter((f) => f !== '');
    if (lines.some((f) => f.length > 120)) return { error: 'a feature line is too long (120 characters max)' };
    data.features = lines;
  }

  if (body.entitlements !== undefined) {
    if (!Array.isArray(body.entitlements)) return { error: 'entitlements must be an array' };
    const codes = [...new Set(body.entitlements.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const bad = codes.filter((c) => !VALID_ENTITLEMENTS.includes(c));
    if (bad.length > 0) {
      return { error: `unknown entitlement(s): ${bad.join(', ')}. Valid: ${VALID_ENTITLEMENTS.join(', ')}` };
    }
    data.entitlements = codes;
  }

  if (body.durationLabel !== undefined) {
    data.durationLabel = body.durationLabel === null || String(body.durationLabel).trim() === ''
      ? null : String(body.durationLabel).trim();
  }

  if (body.accentColor !== undefined) {
    if (body.accentColor === null || String(body.accentColor).trim() === '') {
      data.accentColor = null;
    } else {
      const hex = String(body.accentColor).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { error: 'accentColor must be a hex colour like #E8EDF7' };
      data.accentColor = hex;
    }
  }

  if (body.displayOrder !== undefined) {
    const n = Number(body.displayOrder);
    if (!Number.isInteger(n)) return { error: 'displayOrder must be an integer' };
    data.displayOrder = n;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return { error: 'isActive must be true or false' };
    data.isActive = body.isActive;
  }

  return { data };
}


async function createPlan(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) return res.status(404).json({ error: { message: 'Course not found' } });

    const { data, error } = readPlanFields(req.body ?? {});
    if (error) return res.status(400).json({ error: { message: error } });

    const plan = await prisma.plan.create({ data: { ...data, courseId } });
    return res.status(201).json({ plan: shapePlan(plan) });
  } catch (error) {
    console.error('Create plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the plan' } });
  }
}

// GET /api/courses/:courseId/plans
async function getPlansForCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    // Public, so inactive plans are hidden: a price that has been retired must
    // not still be buyable from a stale tab.
    const plans = await prisma.plan.findMany({
      where: { courseId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { price: 'asc' }],
    });

    return res.status(200).json({ plans: plans.map(shapePlan) });
  } catch (error) {
    console.error('Get plans error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching plans' } });
  }
}

// GET /api/plans/:id
// Single plan, with how many lessons and subscribers hang off it — the admin
// panel needs those counts before offering a delete.
async function getPlanById(req, res) {
  try {
    const planId = Number(req.params.id);

    if (isNaN(planId)) {
      return res.status(400).json({ error: { message: 'Invalid plan id' } });
    }

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      include: {
        course: { select: { id: true, title: true } },
        _count: { select: { lessons: true, subscriptions: true } },
      },
    });

    if (!plan) {
      return res.status(404).json({ error: { message: 'Plan not found' } });
    }

    const { _count, ...rest } = plan;
    return res.status(200).json({
      plan: { ...rest, lessonCount: _count.lessons, subscriberCount: _count.subscriptions },
    });
  } catch (error) {
    console.error('Get plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the plan' } });
  }
}

// PUT /api/plans/:id
async function updatePlan(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid plan id' } });

    const existing = await prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: { message: 'Plan not found' } });

    // partial: only what was sent is validated, so editing a price does not
    // require resending the feature list.
    const { data, error } = readPlanFields(req.body ?? {}, { partial: true });
    if (error) return res.status(400).json({ error: { message: error } });

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    const plan = await prisma.plan.update({ where: { id }, data });
    return res.status(200).json({ plan: shapePlan(plan) });
  } catch (error) {
    console.error('Update plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the plan' } });
  }
}


// GET /api/courses/plans   — public, the whole pricing page in one call
//
// The page has a tab per course and a row of cards under it. Fetching courses
// and then a plan list per tab is one request per tab for a page that is
// entirely static between edits.
async function getPricing(req, res) {
  try {
    const courses = await prisma.course.findMany({
      where: { status: 'published', plans: { some: { isActive: true } } },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true, title: true, description: true, accessType: true,
        plans: {
          where: { isActive: true },
          orderBy: [{ displayOrder: 'asc' }, { price: 'asc' }],
        },
      },
    });

    return res.status(200).json({
      courses: courses.map((c) => ({ ...c, plans: c.plans.map(shapePlan) })),
    });
  } catch (error) {
    console.error('Get pricing error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching pricing' } });
  }
}

// DELETE /api/plans/:id
async function deletePlan(req, res) {
  try {
    const planId = Number(req.params.id);

    if (isNaN(planId)) {
      return res.status(400).json({ error: { message: 'Invalid plan id' } });
    }

    const existing = await prisma.plan.findUnique({
      where: { id: planId },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Plan not found' } });
    }

    // Deleting a plan people paid for would orphan their subscription rows and
    // lose the purchase history. Tell the admin to deactivate it instead.
    if (existing._count.subscriptions > 0) {
      return res.status(409).json({
        error: {
          message: `Cannot delete: ${existing._count.subscriptions} student(s) have subscribed to this plan. Set isActive: false instead to hide it from new buyers.`,
        },
      });
    }

    // The lesson_plans links are dropped by onDelete: Cascade. A lesson left
    // with no plans stays premium and falls back to "any active subscription
    // unlocks it"; one still tied to other plans keeps those.
    await prisma.plan.delete({ where: { id: planId } });

    return res.status(200).json({ message: 'Plan deleted successfully', planId });
  } catch (error) {
    console.error('Delete plan error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the plan' } });
  }
}

module.exports = {
  createPlan, getPlansForCourse, getPlanById, updatePlan, deletePlan, getPricing,
  // Shared with course.controller.js so plans written during course creation
  // land in the same shape the plan editor produces.
  readPlanFields, shapePlan, VALID_ENTITLEMENTS, derivedDurationLabel,
};