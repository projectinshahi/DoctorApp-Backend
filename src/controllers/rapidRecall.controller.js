// Rapid Recall — revision cards: an image, a note, or both, filed under a
// course and narrowed as far as the admin wants.
//
// Scoping is a funnel, not a path. Only courseId is required; courseType,
// subject and lesson each narrow further and each may be null. A set pinned to
// a subject serves every lesson of it, so an admin writing one deck of
// pharmacology cards does not have to paste it onto forty lessons.
const prisma = require('../db');

const VALID_STATUSES = ['draft', 'published'];

const CARD_SELECT = { id: true, imageUrl: true, note: true, displayOrder: true };

const RECALL_SELECT = {
  id: true, courseId: true, courseTypeId: true, subjectId: true, lessonId: true,
  title: true, description: true,
  noteUrl: true, notePublicId: true, noteFileType: true,
  status: true, displayOrder: true, createdAt: true, updatedAt: true,
  course: { select: { id: true, title: true } },
  courseType: { select: { id: true, title: true } },
  subject: { select: { id: true, name: true } },
  lesson: { select: { id: true, title: true } },
  _count: { select: { cards: true } },
};

function shapeRecall(recall) {
  const { _count, ...rest } = recall;
  return { ...rest, cardCount: _count.cards };
}


/**
 * Validates the scope chain and returns the ids to store.
 *
 * Each level is checked against its parent. A courseType from another course,
 * or a lesson from another course, would produce a set that is invisible to
 * everyone — the student query matches on the whole chain — and the admin
 * would have no way to tell why.
 */
async function readScope(body, current = {}) {
  const pick = (key) => (body[key] !== undefined ? body[key] : current[key] ?? null);

  const courseId = Number(pick('courseId'));
  if (!Number.isInteger(courseId)) return { error: 'courseId is required' };

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { error: 'Course not found' };

  const scope = { courseId, courseTypeId: null, subjectId: null, lessonId: null };

  const rawType = pick('courseTypeId');
  if (rawType !== null && rawType !== '') {
    const id = Number(rawType);
    if (!Number.isInteger(id)) return { error: 'courseTypeId must be an integer or null' };
    const ct = await prisma.courseType.findUnique({ where: { id }, select: { id: true, courseId: true } });
    if (!ct) return { error: 'Course type not found' };
    if (ct.courseId !== courseId) return { error: 'That course type belongs to a different course' };
    scope.courseTypeId = id;
  }

  const rawSubject = pick('subjectId');
  if (rawSubject !== null && rawSubject !== '') {
    const id = Number(rawSubject);
    if (!Number.isInteger(id)) return { error: 'subjectId must be an integer or null' };
    const subject = await prisma.subject.findUnique({ where: { id }, select: { id: true } });
    if (!subject) return { error: 'Subject not found' };
    scope.subjectId = id;
  }

  const rawLesson = pick('lessonId');
  if (rawLesson !== null && rawLesson !== '') {
    const id = Number(rawLesson);
    if (!Number.isInteger(id)) return { error: 'lessonId must be an integer or null' };
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, chapter: { select: { courseId: true, courseType: { select: { courseId: true } } } } },
    });
    if (!lesson) return { error: 'Lesson not found' };
    // A chapter hangs off a course directly or off a course type; both are in
    // use, so either path counts.
    const lessonCourseId = lesson.chapter.courseId ?? lesson.chapter.courseType?.courseId ?? null;
    if (lessonCourseId !== courseId) return { error: 'That lesson belongs to a different course' };
    scope.lessonId = id;
  }

  return { scope };
}


// POST /api/admin/rapid-recalls
async function createRapidRecall(req, res) {
  try {
    const body = req.body ?? {};

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title === '') return res.status(400).json({ error: { message: 'title is required' } });

    const { scope, error } = await readScope(body);
    if (error) return res.status(400).json({ error: { message: error } });

    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } });
    }

    const recall = await prisma.rapidRecall.create({
      data: {
        ...scope,
        title,
        description: typeof body.description === 'string' && body.description.trim() !== ''
          ? body.description.trim() : null,
        noteUrl: body.noteUrl || null,
        notePublicId: body.notePublicId || null,
        noteFileType: body.noteFileType || null,
        status: body.status ?? 'draft',
        displayOrder: Number.isInteger(Number(body.displayOrder)) ? Number(body.displayOrder) : 0,
      },
      select: RECALL_SELECT,
    });

    return res.status(201).json({ rapidRecall: shapeRecall(recall) });
  } catch (error) {
    console.error('createRapidRecall error:', error);
    return res.status(500).json({ error: { message: 'Failed to create the rapid recall' } });
  }
}


// GET /api/admin/rapid-recalls?courseId=&courseTypeId=&subjectId=&lessonId=&status=&search=
async function listRapidRecalls(req, res) {
  try {
    const where = {};
    for (const key of ['courseId', 'courseTypeId', 'subjectId', 'lessonId']) {
      if (req.query[key] === undefined) continue;
      // "null" filters for unscoped sets — the ones that apply broadly.
      if (req.query[key] === 'null') { where[key] = null; continue; }
      const id = Number(req.query[key]);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: { message: `${key} must be an integer` } });
      }
      where[key] = id;
    }

    if (req.query.status !== undefined) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } });
      }
      where.status = req.query.status;
    }

    const search = (req.query.search ?? '').trim();
    if (search !== '') where.title = { contains: search, mode: 'insensitive' };

    const recalls = await prisma.rapidRecall.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      select: RECALL_SELECT,
    });

    return res.status(200).json({ rapidRecalls: recalls.map(shapeRecall) });
  } catch (error) {
    console.error('listRapidRecalls error:', error);
    return res.status(500).json({ error: { message: 'Failed to load rapid recalls' } });
  }
}


// GET /api/admin/rapid-recalls/:id
async function getRapidRecall(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const recall = await prisma.rapidRecall.findUnique({
      where: { id },
      select: { ...RECALL_SELECT, cards: { select: CARD_SELECT, orderBy: { displayOrder: 'asc' } } },
    });
    if (!recall) return res.status(404).json({ error: { message: 'Rapid recall not found' } });

    const { cards, ...rest } = recall;
    return res.status(200).json({ rapidRecall: { ...shapeRecall(rest), cards } });
  } catch (error) {
    console.error('getRapidRecall error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the rapid recall' } });
  }
}


// PATCH /api/admin/rapid-recalls/:id
async function updateRapidRecall(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const existing = await prisma.rapidRecall.findUnique({
      where: { id },
      select: { id: true, courseId: true, courseTypeId: true, subjectId: true, lessonId: true },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Rapid recall not found' } });

    const body = req.body ?? {};
    const data = {};

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim() === '') {
        return res.status(400).json({ error: { message: 'title cannot be empty' } });
      }
      data.title = body.title.trim();
    }

    for (const field of ['description', 'noteUrl', 'notePublicId', 'noteFileType']) {
      if (body[field] === undefined) continue;
      const v = body[field];
      data[field] = v === null || (typeof v === 'string' && v.trim() === '') ? null : String(v).trim();
    }

    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } });
      }
      data.status = body.status;
    }

    if (body.displayOrder !== undefined) {
      const n = Number(body.displayOrder);
      if (!Number.isInteger(n)) return res.status(400).json({ error: { message: 'displayOrder must be an integer' } });
      data.displayOrder = n;
    }

    // Re-validated as a whole whenever any part of it moves, so a courseType
    // can never be left pointing outside a newly changed course.
    const touchesScope = ['courseId', 'courseTypeId', 'subjectId', 'lessonId']
      .some((k) => body[k] !== undefined);
    if (touchesScope) {
      const { scope, error } = await readScope(body, existing);
      if (error) return res.status(400).json({ error: { message: error } });
      Object.assign(data, scope);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    const updated = await prisma.rapidRecall.update({ where: { id }, data, select: RECALL_SELECT });
    return res.status(200).json({ rapidRecall: shapeRecall(updated) });
  } catch (error) {
    console.error('updateRapidRecall error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the rapid recall' } });
  }
}


/** A card must carry something. Shared by the whole-set write below. */
function cardProblems(cards) {
  if (!Array.isArray(cards)) return 'cards must be an array';
  for (let i = 0; i < cards.length; i += 1) {
    const c = cards[i];
    if (!c || typeof c !== 'object') return `Card ${i + 1} must be an object`;
    const hasImage = typeof c.imageUrl === 'string' && c.imageUrl.trim() !== '';
    const hasNote = typeof c.note === 'string' && c.note.trim() !== '';
    if (!hasImage && !hasNote) return `Card ${i + 1} needs an image or a note`;
    if (hasImage && !/^https?:\/\/\S+$/i.test(c.imageUrl.trim())) {
      return `Card ${i + 1}: imageUrl is not a valid URL`;
    }
  }
  return null;
}


// PUT /api/admin/rapid-recalls/:id/cards   { cards: [...] }
//
// The whole set at once, the way quiz questions are set. One call covers add,
// edit, remove and reorder, so the panel needs a single Save rather than four
// endpoints and a diffing algorithm.
async function setRapidRecallCards(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const recall = await prisma.rapidRecall.findUnique({ where: { id }, select: { id: true } });
    if (!recall) return res.status(404).json({ error: { message: 'Rapid recall not found' } });

    const cards = req.body?.cards;
    const problem = cardProblems(cards);
    if (problem) return res.status(400).json({ error: { message: problem } });

    // Replace wholesale in one transaction: a half-applied set would leave the
    // deck showing a mix of the old and new order.
    await prisma.$transaction([
      prisma.rapidRecallCard.deleteMany({ where: { recallId: id } }),
      prisma.rapidRecallCard.createMany({
        data: cards.map((c, index) => ({
          recallId: id,
          imageUrl: (c.imageUrl ?? '').trim() || null,
          note: (c.note ?? '').trim() || null,
          displayOrder: index,
        })),
      }),
    ]);

    const saved = await prisma.rapidRecallCard.findMany({
      where: { recallId: id }, orderBy: { displayOrder: 'asc' }, select: CARD_SELECT,
    });

    return res.status(200).json({ recallId: id, cardCount: saved.length, cards: saved });
  } catch (error) {
    console.error('setRapidRecallCards error:', error);
    return res.status(500).json({ error: { message: 'Failed to save the cards' } });
  }
}


// DELETE /api/admin/rapid-recalls/:id
async function deleteRapidRecall(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const recall = await prisma.rapidRecall.findUnique({
      where: { id }, select: { id: true, title: true, _count: { select: { cards: true } } },
    });
    if (!recall) return res.status(404).json({ error: { message: 'Rapid recall not found' } });

    await prisma.rapidRecall.delete({ where: { id } });

    return res.status(200).json({
      message: `Deleted "${recall.title}" and its ${recall._count.cards} card(s).`,
      id,
      deletedCards: recall._count.cards,
    });
  } catch (error) {
    console.error('deleteRapidRecall error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the rapid recall' } });
  }
}



// ── Student side ────────────────────────────────────────────────────────────

/** What a student sees. No draft sets, and no Cloudinary handles. */
const STUDENT_RECALL_SELECT = {
  id: true, title: true, description: true,
  noteUrl: true, noteFileType: true,
  courseTypeId: true, subjectId: true, lessonId: true, displayOrder: true,
  subject: { select: { id: true, name: true } },
  lesson: { select: { id: true, title: true } },
  _count: { select: { cards: true } },
};

/**
 * The sets visible to this student, narrowed by whatever the app asks for.
 *
 * A set with a null courseType applies to the whole course, so the filter has
 * to accept both it and the student's own type — the same OR the course tree
 * uses. Matching only the exact type would hide every course-wide deck.
 */
function studentWhere(user, query) {
  const where = {
    courseId: user.selectedCourseId,
    status: 'published',
    ...(user.selectedCourseTypeId
      ? { OR: [{ courseTypeId: null }, { courseTypeId: user.selectedCourseTypeId }] }
      : {}),
  };

  for (const key of ['subjectId', 'lessonId']) {
    if (query[key] === undefined) continue;
    const id = Number(query[key]);
    if (!Number.isInteger(id)) return { error: `${key} must be an integer` };
    // A lesson's own decks plus the ones that apply more broadly, so opening a
    // lesson shows its cards and its subject's cards together.
    where[key] = query.exact === 'true' ? id : { in: [id] };
  }

  return { where };
}


// GET /api/users/me/rapid-recalls?subjectId=&lessonId=
async function listStudentRapidRecalls(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { selectedCourseId: true, selectedCourseTypeId: true },
    });
    if (!user?.selectedCourseId) {
      return res.status(200).json({ rapidRecalls: [], reason: 'No course selected yet.' });
    }

    const { where, error } = studentWhere(user, req.query);
    if (error) return res.status(400).json({ error: { message: error } });

    const recalls = await prisma.rapidRecall.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      select: STUDENT_RECALL_SELECT,
    });

    return res.status(200).json({
      rapidRecalls: recalls.map(({ _count, ...r }) => ({ ...r, cardCount: _count.cards })),
    });
  } catch (error) {
    console.error('listStudentRapidRecalls error:', error);
    return res.status(500).json({ error: { message: 'Failed to load rapid recalls' } });
  }
}


// GET /api/users/me/rapid-recalls/:id
async function getStudentRapidRecall(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { selectedCourseId: true, selectedCourseTypeId: true },
    });

    const recall = await prisma.rapidRecall.findUnique({
      where: { id },
      select: { ...STUDENT_RECALL_SELECT, courseId: true, status: true,
        cards: { select: CARD_SELECT, orderBy: { displayOrder: 'asc' } } },
    });

    // One 404 for missing, unpublished and out-of-course alike. Telling a
    // student a draft exists but is not theirs is information they cannot use.
    const visible = recall
      && recall.status === 'published'
      && recall.courseId === user?.selectedCourseId
      && (recall.courseTypeId === null
        || recall.courseTypeId === user?.selectedCourseTypeId);
    if (!visible) return res.status(404).json({ error: { message: 'Rapid recall not found' } });

    const { _count, courseId, status, cards, ...rest } = recall;
    return res.status(200).json({ rapidRecall: { ...rest, cardCount: _count.cards, cards } });
  } catch (error) {
    console.error('getStudentRapidRecall error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the rapid recall' } });
  }
}


module.exports = {
  createRapidRecall, listRapidRecalls, getRapidRecall,
  updateRapidRecall, setRapidRecallCards, deleteRapidRecall,
  listStudentRapidRecalls, getStudentRapidRecall,
  // Exported for rapidRecall.test.js — pure, no DB.
  cardProblems,
};
