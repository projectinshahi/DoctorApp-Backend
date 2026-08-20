const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const VALID_QUESTION_STATUSES = ['active', 'inactive'];
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

const QUESTION_SELECT = {
  id: true,
  subjectId: true,
  topicId: true,
  questionText: true,
  questionImageUrl: true,
  difficulty: true,
  marksCorrect: true,
  marksIncorrect: true,
  explanation: true,
  status: true,
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  options: {
    select: { id: true, optionText: true, optionImageUrl: true, isCorrect: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' },
  },
  tags: { select: { tag: { select: { id: true, name: true } } } },
  createdAt: true,
  updatedAt: true,
};

// The join rows are a storage detail — every response flattens them to
// `tags` (full objects) + `tagNames`, the same way shapeLesson() flattens
// lessonPlans.
function shapeQuestion(question) {
  if (!question) return question;
  const { tags = [], ...rest } = question;
  const flat = tags.map((qt) => qt.tag);
  return {
    ...rest,
    tags: flat,
    tagIds: flat.map((t) => t.id),
    tagNames: flat.map((t) => t.name),
    correctOptionId: (rest.options || []).find((o) => o.isCorrect)?.id ?? null,
  };
}

// ─────────────────────────── validation helpers ───────────────────────────

// Options carry the two rules that make a question answerable: 2–6 of them,
// and exactly one correct. Returns { provided, options, error }; `provided`
// is false when the body says nothing about options, so an update leaves the
// existing ones alone.
function readOptions(body) {
  if (body.options === undefined) return { provided: false, options: [] };

  if (!Array.isArray(body.options)) {
    return { provided: true, options: [], error: 'options must be an array' };
  }

  const { options } = body;
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return {
      provided: true,
      options: [],
      error: `A question must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`,
    };
  }

  const parsed = [];
  for (let i = 0; i < options.length; i += 1) {
    const raw = options[i];
    if (!raw || typeof raw !== 'object') {
      return { provided: true, options: [], error: `Option ${i + 1} must be an object` };
    }
    if (typeof raw.optionText !== 'string' || raw.optionText.trim().length === 0) {
      return { provided: true, options: [], error: `Option ${i + 1} must have a non-empty optionText` };
    }
    if (raw.optionImageUrl !== undefined && raw.optionImageUrl !== null && typeof raw.optionImageUrl !== 'string') {
      return { provided: true, options: [], error: `Option ${i + 1} optionImageUrl must be a string` };
    }
    parsed.push({
      optionText: raw.optionText.trim(),
      optionImageUrl: raw.optionImageUrl ?? null,
      isCorrect: Boolean(raw.isCorrect),
      displayOrder: raw.displayOrder !== undefined ? Number(raw.displayOrder) : i,
    });
  }

  const correctCount = parsed.filter((o) => o.isCorrect).length;
  if (correctCount !== 1) {
    return {
      provided: true,
      options: [],
      error: `Exactly one option must be marked correct (got ${correctCount})`,
    };
  }

  return { provided: true, options: parsed };
}

// Tags come in as names. Unknown names are created on the fly, so the admin
// never has to pre-register a tag before using it.
function readTagNames(body) {
  if (body.tags === undefined) return { provided: false, names: [] };
  if (body.tags === null) return { provided: true, names: [] };
  if (!Array.isArray(body.tags)) {
    return { provided: true, names: [], error: 'tags must be an array of strings' };
  }

  const names = [];
  for (const raw of body.tags) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return { provided: true, names: [], error: 'tags must be an array of non-empty strings' };
    }
    const name = raw.trim();
    if (!names.includes(name)) names.push(name);
  }
  return { provided: true, names };
}

// A question belongs to exactly one subject and one topic, and the topic has
// to actually live under that subject.
async function validateSubjectAndTopic(subjectId, topicId) {
  if (!Number.isInteger(subjectId)) return 'subjectId must be an integer';
  if (!Number.isInteger(topicId)) return 'topicId must be an integer';

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, subjectId: true },
  });
  if (!topic) return `Topic ${topicId} not found`;
  if (topic.subjectId !== subjectId) {
    return `Topic ${topicId} belongs to subject ${topic.subjectId}, not subject ${subjectId}`;
  }
  return null;
}

function readMarks(value, field, { required }) {
  if (value === undefined) {
    return required ? { error: `${field} is required` } : { skip: true };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return { error: `${field} must be a number` };
  return { value: num };
}

// TODO(attempts-module): once the attempt-answers model exists, replace the
// body of this function with:
//   const answered = await prisma.attemptAnswer.count({
//     where: { questionId, attempt: { status: 'submitted' } },
//   });
//   return answered > 0;
// Right now no such table exists, so nothing can be locked and this always
// reports "editable". It is NOT a silent pass — the endpoints below still
// route through it, so flipping this one function switches the rule on.
async function isAnsweredInSubmittedAttempt(questionId) {
  void questionId;
  return false;
}

// A Quiz stores a *filter* (subject + topic + optional exam tag), not links to
// question rows, so deleting a question can never dangle a reference — the
// matching quizzes just serve one question fewer. This counts those quizzes so
// the delete response can report the blast radius; it does not block.
async function countQuizUsage(questionId) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      subjectId: true,
      topicId: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!question) return 0;

  return prisma.quiz.count({
    where: quizzesMatchingQuestionWhere({
      subjectId: question.subjectId,
      topicId: question.topicId,
      tagNames: question.tags.map((qt) => qt.tag.name),
    }),
  });
}

/**
 * The inverse of questionPoolWhere() in quiz.controller.js: that one asks
 * "which questions does this quiz serve", this asks "which quizzes serve this
 * question". They must stay in step — an untagged quiz takes the whole topic,
 * a tagged one takes only questions carrying that tag. Pure; locked by
 * questionBank.test.js.
 */
function quizzesMatchingQuestionWhere({ subjectId, topicId, tagNames }) {
  return {
    subjectId,
    topicId,
    OR: [{ examTag: null }, { examTag: { in: tagNames || [] } }],
  };
}

// Shared write payload for the tag join rows: connect the tag if it exists,
// create it if it does not.
function tagCreatePayload(names) {
  return names.map((name) => ({
    tag: { connectOrCreate: { where: { name }, create: { name } } },
  }));
}

// ─────────────────────────── questions ───────────────────────────

// POST /api/questions
async function createQuestion(req, res) {
  try {
    const {
      subjectId, topicId, questionText, questionImageUrl,
      difficulty, marksCorrect, marksIncorrect, explanation, status,
    } = req.body;

    if (!questionText || typeof questionText !== 'string' || questionText.trim().length === 0) {
      return res.status(400).json({ error: { message: 'questionText is required' } });
    }

    if (questionImageUrl !== undefined && questionImageUrl !== null && typeof questionImageUrl !== 'string') {
      return res.status(400).json({ error: { message: 'questionImageUrl must be a string' } });
    }

    if (!difficulty || !VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: { message: `difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}` } });
    }

    if (status !== undefined && !VALID_QUESTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUESTION_STATUSES.join(', ')}` } });
    }

    if (explanation !== undefined && explanation !== null && typeof explanation !== 'string') {
      return res.status(400).json({ error: { message: 'explanation must be a string' } });
    }

    const taxonomyError = await validateSubjectAndTopic(Number(subjectId), Number(topicId));
    if (taxonomyError) {
      return res.status(400).json({ error: { message: taxonomyError } });
    }

    const correct = readMarks(marksCorrect, 'marksCorrect', { required: true });
    if (correct.error) return res.status(400).json({ error: { message: correct.error } });

    const incorrect = readMarks(marksIncorrect, 'marksIncorrect', { required: false });
    if (incorrect.error) return res.status(400).json({ error: { message: incorrect.error } });

    const optionSelection = readOptions(req.body);
    if (optionSelection.error) {
      return res.status(400).json({ error: { message: optionSelection.error } });
    }
    if (!optionSelection.provided) {
      return res.status(400).json({ error: { message: 'options are required' } });
    }

    const tagSelection = readTagNames(req.body);
    if (tagSelection.error) {
      return res.status(400).json({ error: { message: tagSelection.error } });
    }

    const question = await prisma.question.create({
      data: {
        subjectId: Number(subjectId),
        topicId: Number(topicId),
        questionText: questionText.trim(),
        questionImageUrl: questionImageUrl ?? null,
        difficulty,
        marksCorrect: correct.value,
        marksIncorrect: incorrect.skip ? 0 : incorrect.value,
        explanation: explanation !== undefined ? explanation : null,
        status: status ?? 'active',
        options: { create: optionSelection.options },
        tags: { create: tagCreatePayload(tagSelection.names) },
      },
      select: QUESTION_SELECT,
    });

    return res.status(201).json({ question: shapeQuestion(question) });
  } catch (error) {
    console.error('Create question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while creating the question' } });
  }
}

// GET /api/questions
// Filters combine cumulatively (AND): every filter present narrows the set
// further, none of them widen it.
async function listQuestions(req, res) {
  try {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: { message: 'page must be a positive integer' } });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: { message: 'limit must be an integer between 1 and 100' } });
    }

    const where = {};

    if (req.query.subjectId !== undefined) {
      const subjectId = Number(req.query.subjectId);
      if (!Number.isInteger(subjectId)) {
        return res.status(400).json({ error: { message: 'subjectId must be an integer' } });
      }
      where.subjectId = subjectId;
    }

    if (req.query.topicId !== undefined) {
      const topicId = Number(req.query.topicId);
      if (!Number.isInteger(topicId)) {
        return res.status(400).json({ error: { message: 'topicId must be an integer' } });
      }
      where.topicId = topicId;
    }

    if (req.query.difficulty !== undefined) {
      if (!VALID_DIFFICULTIES.includes(req.query.difficulty)) {
        return res.status(400).json({ error: { message: `difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}` } });
      }
      where.difficulty = req.query.difficulty;
    }

    if (req.query.status !== undefined) {
      if (!VALID_QUESTION_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUESTION_STATUSES.join(', ')}` } });
      }
      where.status = req.query.status;
    }

    if (req.query.tag !== undefined) {
      const tag = String(req.query.tag).trim();
      if (tag.length === 0) {
        return res.status(400).json({ error: { message: 'tag must be a non-empty string' } });
      }
      where.tags = { some: { tag: { name: tag } } };
    }

    if (req.query.search !== undefined) {
      const search = String(req.query.search).trim();
      if (search.length > 0) {
        where.questionText = { contains: search, mode: 'insensitive' };
      }
    }

    // The Difficulty enum is declared easy → medium → hard, and Postgres sorts
    // native enums by declaration order, so asc/desc already means
    // easy→hard / hard→easy. No manual weight map needed.
    const SORTS = {
      newest: [{ createdAt: 'desc' }],
      oldest: [{ createdAt: 'asc' }],
      difficulty_asc: [{ difficulty: 'asc' }, { createdAt: 'desc' }],
      difficulty_desc: [{ difficulty: 'desc' }, { createdAt: 'desc' }],
    };
    const sort = req.query.sort !== undefined ? String(req.query.sort) : 'newest';
    if (!SORTS[sort]) {
      return res.status(400).json({ error: { message: `sort must be one of: ${Object.keys(SORTS).join(', ')}` } });
    }

    // Promise.all, not $transaction: a count + one page of rows needs no
    // transactional consistency, and wrapping them was timing out against a
    // remote Postgres ("Unable to start a transaction in the given time").
    // Matches the pagination in course.controller.js / adminStudent.controller.js.
    const [total, questions] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        orderBy: SORTS[sort],
        skip: (page - 1) * limit,
        take: limit,
        select: QUESTION_SELECT,
      }),
    ]);

    return res.status(200).json({
      questions: questions.map(shapeQuestion),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('List questions error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching questions' } });
  }
}

// GET /api/questions/:id
async function getQuestion(req, res) {
  try {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: QUESTION_SELECT,
    });
    if (!question) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    return res.status(200).json({ question: shapeQuestion(question) });
  } catch (error) {
    console.error('Get question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while fetching the question' } });
  }
}

// PUT /api/questions/:id
async function updateQuestion(req, res) {
  try {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const existing = await prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, subjectId: true, topicId: true },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    const {
      subjectId, topicId, questionText, questionImageUrl,
      difficulty, marksCorrect, marksIncorrect, explanation, status,
    } = req.body;

    const data = {};

    if (questionText !== undefined) {
      if (typeof questionText !== 'string' || questionText.trim().length === 0) {
        return res.status(400).json({ error: { message: 'questionText must be a non-empty string' } });
      }
      data.questionText = questionText.trim();
    }

    if (questionImageUrl !== undefined) {
      if (questionImageUrl !== null && typeof questionImageUrl !== 'string') {
        return res.status(400).json({ error: { message: 'questionImageUrl must be a string' } });
      }
      data.questionImageUrl = questionImageUrl;
    }

    if (difficulty !== undefined) {
      if (!VALID_DIFFICULTIES.includes(difficulty)) {
        return res.status(400).json({ error: { message: `difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}` } });
      }
      data.difficulty = difficulty;
    }

    if (status !== undefined) {
      if (!VALID_QUESTION_STATUSES.includes(status)) {
        return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUESTION_STATUSES.join(', ')}` } });
      }
      data.status = status;
    }

    if (explanation !== undefined) {
      if (explanation !== null && typeof explanation !== 'string') {
        return res.status(400).json({ error: { message: 'explanation must be a string' } });
      }
      data.explanation = explanation;
    }

    const correct = readMarks(marksCorrect, 'marksCorrect', { required: false });
    if (correct.error) return res.status(400).json({ error: { message: correct.error } });
    if (!correct.skip) data.marksCorrect = correct.value;

    const incorrect = readMarks(marksIncorrect, 'marksIncorrect', { required: false });
    if (incorrect.error) return res.status(400).json({ error: { message: incorrect.error } });
    if (!incorrect.skip) data.marksIncorrect = incorrect.value;

    // Subject and topic move together — validate against whatever the question
    // will look like *after* this update, not what it looks like now.
    if (subjectId !== undefined || topicId !== undefined) {
      const nextSubjectId = subjectId !== undefined ? Number(subjectId) : existing.subjectId;
      const nextTopicId = topicId !== undefined ? Number(topicId) : existing.topicId;
      const taxonomyError = await validateSubjectAndTopic(nextSubjectId, nextTopicId);
      if (taxonomyError) {
        return res.status(400).json({ error: { message: taxonomyError } });
      }
      data.subjectId = nextSubjectId;
      data.topicId = nextTopicId;
    }

    const optionSelection = readOptions(req.body);
    if (optionSelection.error) {
      return res.status(400).json({ error: { message: optionSelection.error } });
    }

    // Locking rule: once a question has been answered in a submitted attempt,
    // its options and correct answer are frozen — rescoring history is worse
    // than carrying a second question.
    if (optionSelection.provided && (await isAnsweredInSubmittedAttempt(questionId))) {
      return res.status(409).json({
        error: {
          message: 'This question has already been answered in a submitted attempt, so its options cannot be changed. Duplicate it and edit the copy instead.',
        },
      });
    }

    if (optionSelection.provided) {
      // Replace wholesale: the client always sends the full option set, so a
      // diff would only be more code for the same result.
      data.options = { deleteMany: {}, create: optionSelection.options };
    }

    const tagSelection = readTagNames(req.body);
    if (tagSelection.error) {
      return res.status(400).json({ error: { message: tagSelection.error } });
    }
    if (tagSelection.provided) {
      data.tags = { deleteMany: {}, create: tagCreatePayload(tagSelection.names) };
    }

    const question = await prisma.question.update({
      where: { id: questionId },
      data,
      select: QUESTION_SELECT,
    });

    return res.status(200).json({ question: shapeQuestion(question) });
  } catch (error) {
    console.error('Update question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the question' } });
  }
}

// DELETE /api/questions/:id
// Always deletable: quizzes match questions by filter, so nothing dangles.
// The response reports how many quiz pools shrank.
async function deleteQuestion(req, res) {
  try {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const existing = await prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    // Reported, not enforced: quizzes match by filter, so they survive this.
    const affectedQuizzes = await countQuizUsage(questionId);

    // Options and tag links cascade on delete via the schema.
    await prisma.question.delete({ where: { id: questionId } });

    return res.status(200).json({
      message: 'Question deleted successfully',
      questionId,
      affectedQuizzes,
    });
  } catch (error) {
    console.error('Delete question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the question' } });
  }
}

// PATCH /api/questions/:id/status
// Deactivating never touches quizzes that already contain the question — it
// only removes it from future automatic selection.
async function activateOrDeactivateQuestion(req, res) {
  try {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const { status } = req.body;
    if (!status || !VALID_QUESTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUESTION_STATUSES.join(', ')}` } });
    }

    const existing = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    const question = await prisma.question.update({
      where: { id: questionId },
      data: { status },
      select: QUESTION_SELECT,
    });

    return res.status(200).json({ question: shapeQuestion(question) });
  } catch (error) {
    console.error('Update question status error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the question status' } });
  }
}

// PATCH /api/questions/bulk-status   body: { questionIds: [...], status }
async function bulkActivateOrDeactivate(req, res) {
  try {
    const { questionIds, status } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: { message: 'questionIds must be a non-empty array' } });
    }

    const ids = questionIds.map(Number);
    if (ids.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ error: { message: 'questionIds must contain integers' } });
    }

    if (!status || !VALID_QUESTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${VALID_QUESTION_STATUSES.join(', ')}` } });
    }

    const found = await prisma.question.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((q) => q.id));

    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return res.status(404).json({ error: { message: `Questions not found: ${missing.join(', ')}` } });
    }

    const result = await prisma.question.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    return res.status(200).json({ updated: result.count, questionIds: ids, status });
  } catch (error) {
    console.error('Bulk question status error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while updating the questions' } });
  }
}

// POST /api/questions/:id/duplicate
// The escape hatch for the locking rule: copy everything, leave the copy
// inactive so it cannot leak into automatic selection before it is reviewed.
async function duplicateQuestion(req, res) {
  try {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid question id' } });
    }

    const source = await prisma.question.findUnique({
      where: { id: questionId },
      select: {
        subjectId: true, topicId: true, questionText: true, questionImageUrl: true,
        difficulty: true, marksCorrect: true, marksIncorrect: true, explanation: true,
        options: { select: { optionText: true, optionImageUrl: true, isCorrect: true, displayOrder: true } },
        tags: { select: { tagId: true } },
      },
    });
    if (!source) {
      return res.status(404).json({ error: { message: 'Question not found' } });
    }

    const { options, tags, ...fields } = source;

    const question = await prisma.question.create({
      data: {
        ...fields,
        questionText: `${fields.questionText} (Copy)`,
        status: 'inactive',
        options: { create: options },
        tags: { create: tags.map((t) => ({ tagId: t.tagId })) },
      },
      select: QUESTION_SELECT,
    });

    return res.status(201).json({ question: shapeQuestion(question), duplicatedFrom: questionId });
  } catch (error) {
    console.error('Duplicate question error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while duplicating the question' } });
  }
}

module.exports = {
  // Exported for questionBank.test.js — pure, no DB.
  quizzesMatchingQuestionWhere,
  createQuestion,
  listQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  activateOrDeactivateQuestion,
  bulkActivateOrDeactivate,
  duplicateQuestion,
  // Exported for questionBank.test.js — pure, no DB.
  readOptions,
  readTagNames,
  shapeQuestion,
  // Reused by quiz.controller.js — a quiz picks a subject+topic under the
  // same rule a question does. Endpoints above are unchanged.
  validateSubjectAndTopic,
};
