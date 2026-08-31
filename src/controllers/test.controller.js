// Grand Test admin side: create the shell, upload a CSV, review, publish.
//
// Upload and publish are deliberately two steps. A paper that goes live the
// moment a file lands has no point at which anyone can look at it, and a bad
// import would be visible to students before anyone noticed.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const { parseCsv, toObject } = require('../utils/csv');
const cloudinary = require('../config/cloudinary');

const VALID_OPTIONS = ['A', 'B', 'C', 'D'];
const TEST_TYPES = ['GRAND_TEST'];
// Only correct_option is unconditionally required now. Every other field can
// be satisfied by text OR an image, which the row validator checks as a pair.
const REQUIRED_COLUMNS = ['correct_option'];

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Admin view of a test, with its question count. */
const TEST_SELECT = {
  id: true, courseId: true, name: true, type: true,
  totalQuestions: true, durationMinutes: true,
  marksCorrect: true, marksIncorrect: true,
  isPublished: true, isLocked: true, createdAt: true, updatedAt: true,
  _count: { select: { questions: true, attempts: true } },
};

function shapeTest(test) {
  const { _count, ...rest } = test;
  return {
    ...rest,
    questionCount: _count.questions,
    attemptCount: _count.attempts,
    // Publishing is blocked until the paper is the length it claims to be.
    readyToPublish: _count.questions === test.totalQuestions && test.totalQuestions > 0,
  };
}


// POST /api/admin/courses/:courseId/tests
async function createTest(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) return res.status(404).json({ error: { message: 'Course not found' } });

    const { name, type, totalQuestions, durationMinutes, marksCorrect, marksIncorrect } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: { message: 'name is required' } });
    }
    if (type !== undefined && !TEST_TYPES.includes(type)) {
      return res.status(400).json({ error: { message: `type must be one of: ${TEST_TYPES.join(', ')}` } });
    }
    if (!Number.isInteger(Number(totalQuestions)) || Number(totalQuestions) < 1) {
      return res.status(400).json({ error: { message: 'totalQuestions must be a positive integer' } });
    }
    if (!Number.isInteger(Number(durationMinutes)) || Number(durationMinutes) < 1) {
      return res.status(400).json({ error: { message: 'durationMinutes must be a positive integer' } });
    }
    // Negative marking is stored negative and added, never subtracted. A
    // positive value here would reward wrong answers.
    if (marksIncorrect !== undefined && Number(marksIncorrect) > 0) {
      return res.status(400).json({ error: { message: 'marksIncorrect must be zero or negative (e.g. -0.25)' } });
    }

    const test = await prisma.test.create({
      data: {
        courseId,
        name: name.trim(),
        type: type ?? 'GRAND_TEST',
        totalQuestions: Number(totalQuestions),
        durationMinutes: Number(durationMinutes),
        marksCorrect: marksCorrect === undefined ? 1 : Number(marksCorrect),
        marksIncorrect: marksIncorrect === undefined ? 0 : Number(marksIncorrect),
      },
      select: TEST_SELECT,
    });

    return res.status(201).json({ test: shapeTest(test) });
  } catch (error) {
    console.error('createTest error:', error);
    return res.status(500).json({ error: { message: 'Failed to create the test' } });
  }
}


// GET /api/admin/tests?courseId=&type=&isPublished=
async function listTests(req, res) {
  try {
    const where = {};
    if (req.query.courseId !== undefined) {
      const courseId = Number(req.query.courseId);
      if (!Number.isInteger(courseId)) {
        return res.status(400).json({ error: { message: 'courseId must be an integer' } });
      }
      where.courseId = courseId;
    }
    if (req.query.type !== undefined) {
      if (!TEST_TYPES.includes(req.query.type)) {
        return res.status(400).json({ error: { message: `type must be one of: ${TEST_TYPES.join(', ')}` } });
      }
      where.type = req.query.type;
    }
    if (req.query.isPublished !== undefined) {
      where.isPublished = req.query.isPublished === 'true';
    }

    const tests = await prisma.test.findMany({
      where, orderBy: { createdAt: 'desc' }, select: TEST_SELECT,
    });

    return res.status(200).json({ tests: tests.map(shapeTest) });
  } catch (error) {
    console.error('listTests error:', error);
    return res.status(500).json({ error: { message: 'Failed to load tests' } });
  }
}


/**
 * Validates a whole CSV before anything is written.
 *
 * Returns every problem at once rather than stopping at the first: an admin
 * fixing a 200-row file one error per upload would be here all day.
 *
 * `knownImageUrls` is the set uploaded for THIS test. Any other URL is
 * rejected: a typo or a link to another test's image imports cleanly and then
 * fails months later, in front of a student, as a broken image.
 */
function validateRows(header, rows, test, knownImageUrls = null) {
  const errors = [];
  const questions = [];
  const seenOrder = new Map();
  const seenText = new Map();

  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { errors: [{ row: 1, field: 'header', message: `Missing column(s): ${missing.join(', ')}` }], questions: [] };
  }

  rows.forEach((row, index) => {
    const r = toObject(header, row.values);
    const at = (field, message) => errors.push({ row: row.line, field, message });

    // question_order is optional: fall back to file position so a spreadsheet
    // without the column still imports in the order it was written.
    let order = index + 1;
    if (header.includes('question_order') && r.question_order !== '') {
      const parsed = Number(r.question_order);
      if (!Number.isInteger(parsed) || parsed < 1) {
        at('question_order', `"${r.question_order}" is not a positive integer`);
      } else {
        order = parsed;
      }
    }

    if (seenOrder.has(order)) {
      at('question_order', `Duplicate order ${order}, also on line ${seenOrder.get(order)}`);
    } else {
      seenOrder.set(order, row.line);
    }

    // An image URL is only usable if it was uploaded for this test.
    const checkUrl = (field, url) => {
      if (url === '') return '';
      if (knownImageUrls && !knownImageUrls.has(url)) {
        at(field, `Image URL is not one of this test's uploaded images: ${url}`);
        return '';
      }
      return url;
    };

    const questionImageUrl = checkUrl('question_image_url', r.question_image_url ?? '');

    // Text or image — either carries the question. Requiring text would rule
    // out an ECG or a slide, which is often the entire stem.
    if (r.question_text === '' && questionImageUrl === '') {
      at('question_text', 'Question needs text or an image');
    }

    const optionValues = {};
    for (const letter of VALID_OPTIONS) {
      const lower = letter.toLowerCase();
      const text = r[`option_${lower}`] ?? '';
      const imageUrl = checkUrl(`option_${lower}_image_url`, r[`option_${lower}_image_url`] ?? '');
      if (text === '' && imageUrl === '') {
        at(`option_${lower}`, `Option ${letter} needs text or an image`);
      }
      optionValues[letter] = { text, imageUrl };
    }

    const correct = r.correct_option.toUpperCase();
    if (!VALID_OPTIONS.includes(correct)) {
      at('correct_option', `"${r.correct_option}" must be one of A, B, C, D`);
    }

    // A repeated stem is usually a copy-paste slip, but a paper can legitimately
    // reuse wording, so this is a warning carried alongside the row, not a block.
    const key = (r.question_text ?? '').toLowerCase();
    if (key !== '' && seenText.has(key)) {
      errors.push({
        row: row.line, field: 'question_text', severity: 'warning',
        message: `Same text as line ${seenText.get(key)}`,
      });
    } else if (key !== '') {
      seenText.set(key, row.line);
    }

    questions.push({
      testId: test.id,
      questionOrder: order,
      questionText: r.question_text || null,
      questionImageUrl: questionImageUrl || null,
      optionA: optionValues.A.text || null,
      optionAImageUrl: optionValues.A.imageUrl || null,
      optionB: optionValues.B.text || null,
      optionBImageUrl: optionValues.B.imageUrl || null,
      optionC: optionValues.C.text || null,
      optionCImageUrl: optionValues.C.imageUrl || null,
      optionD: optionValues.D.text || null,
      optionDImageUrl: optionValues.D.imageUrl || null,
      correctOption: correct,
      explanation: r.explanation || null,
      subject: r.subject || null,
      topic: r.topic || null,
    });
  });

  return { errors, questions };
}


// POST /api/admin/tests/:testId/questions/upload   (multipart, field name "file")
async function uploadTestQuestions(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({
      where: { id: testId },
      select: { ...TEST_SELECT, id: true },
    });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    // Someone has already sat this paper. Changing it now would rewrite their
    // score, so the questions are frozen for good.
    if (test.isLocked) {
      return res.status(409).json({
        error: { message: 'This test is locked — students have already attempted it. Its questions can no longer be changed.' },
      });
    }

    // Replacing a live paper has to be deliberate: clear it first, so nobody
    // half-swaps the questions under students who are browsing it.
    if (test.isPublished && test._count.questions > 0) {
      return res.status(409).json({
        error: { message: 'This test is published and already has questions. Unpublish or clear its questions first, then re-upload.' },
      });
    }

    const csvText = req.file
      ? req.file.buffer.toString('utf8')
      : (typeof req.body?.csv === 'string' ? req.body.csv : null);

    if (!csvText || csvText.trim() === '') {
      return res.status(400).json({ error: { message: 'Upload a CSV file in the "file" field, or send its text as "csv"' } });
    }

    const { header, rows } = parseCsv(csvText);
    if (rows.length === 0) {
      return res.status(400).json({ error: { message: 'The file has a header but no rows' } });
    }

    const knownImageUrls = new Set(
      (await prisma.testImage.findMany({ where: { testId }, select: { url: true } })).map((i) => i.url)
    );
    const { errors, questions } = validateRows(header, rows, test, knownImageUrls);
    const blocking = errors.filter((e) => e.severity !== 'warning');

    // The count check is separate from row validation so the admin is told both
    // "your file is short" and "row 12 is broken" in one response.
    if (rows.length !== test.totalQuestions) {
      return res.status(400).json({
        error: { message: `This test expects ${test.totalQuestions} questions, the file has ${rows.length}. Fix the file, or change the test's totalQuestions.` },
        expected: test.totalQuestions,
        received: rows.length,
        validRows: rows.length - blocking.length,
        errors,
      });
    }

    if (blocking.length > 0) {
      return res.status(400).json({
        error: { message: `${blocking.length} row(s) are invalid. Nothing was saved.` },
        validRows: rows.length - blocking.length,
        errors,
      });
    }

    // All-or-nothing: a partial paper is worse than no paper, because it looks
    // complete until someone counts.
    await prisma.$transaction([
      prisma.testQuestion.deleteMany({ where: { testId } }),
      prisma.testQuestion.createMany({ data: questions }),
    ]);

    const saved = await prisma.testQuestion.findMany({
      where: { testId },
      orderBy: { questionOrder: 'asc' },
      take: 5,
    });

    return res.status(200).json({
      message: `Imported ${questions.length} question(s). The test is not published yet.`,
      validRows: questions.length,
      errors,
      preview: saved,
    });
  } catch (error) {
    console.error('uploadTestQuestions error:', error);
    return res.status(500).json({ error: { message: 'Failed to import the questions' } });
  }
}


// DELETE /api/admin/tests/:testId/questions
async function clearTestQuestions(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({
      where: { id: testId }, select: { id: true, isLocked: true },
    });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    if (test.isLocked) {
      return res.status(409).json({
        error: { message: 'This test is locked — students have already attempted it. Its questions can no longer be changed.' },
      });
    }

    // Unpublish alongside the wipe: a published test with no questions is a
    // broken row in the student's list.
    const [{ count }] = await prisma.$transaction([
      prisma.testQuestion.deleteMany({ where: { testId } }),
      prisma.test.update({ where: { id: testId }, data: { isPublished: false } }),
    ]);

    return res.status(200).json({ message: `Removed ${count} question(s). The test is now unpublished.`, removed: count });
  } catch (error) {
    console.error('clearTestQuestions error:', error);
    return res.status(500).json({ error: { message: 'Failed to clear the questions' } });
  }
}


// POST /api/admin/tests/:testId/publish     { "isPublished": true | false }
async function publishTest(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const isPublished = req.body?.isPublished === undefined ? true : req.body.isPublished === true;

    if (isPublished && test._count.questions !== test.totalQuestions) {
      return res.status(409).json({
        error: { message: `Cannot publish: this test expects ${test.totalQuestions} questions but has ${test._count.questions}.` },
        expected: test.totalQuestions,
        actual: test._count.questions,
      });
    }

    const updated = await prisma.test.update({
      where: { id: testId }, data: { isPublished }, select: TEST_SELECT,
    });

    return res.status(200).json({ test: shapeTest(updated) });
  } catch (error) {
    console.error('publishTest error:', error);
    return res.status(500).json({ error: { message: 'Failed to publish the test' } });
  }
}


// GET /api/admin/tests/:testId/preview
// The only place the paper is visible with its answers.
async function previewTest(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const questions = await prisma.testQuestion.findMany({
      where: { testId }, orderBy: { questionOrder: 'asc' },
    });

    return res.status(200).json({ test: shapeTest(test), questions });
  } catch (error) {
    console.error('previewTest error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the test' } });
  }
}


// ─────────────────────────── images ───────────────────────────

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// POST /api/admin/tests/:testId/images     (multipart, field "images", many)
//
// Images go up BEFORE the CSV, because a CSV can carry a URL but not binary
// data. The response returns originalFilename alongside each URL so the admin
// can match them back to their spreadsheet rows.
async function uploadTestImages(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({
      where: { id: testId }, select: { id: true, isLocked: true },
    });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    // Images are part of the paper, so they freeze with it.
    if (test.isLocked) {
      return res.status(409).json({
        error: { message: 'This test is locked — students have already attempted it. Its images can no longer be changed.' },
      });
    }

    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: { message: 'Attach one or more images in the "images" field' } });
    }

    const uploaded = [];
    const errors = [];

    // Sequential, not Promise.all: a folder of 200 images would otherwise open
    // 200 concurrent uploads and get throttled or time the request out.
    for (const file of files) {
      try {
        if (file.size > MAX_IMAGE_BYTES) {
          errors.push({ filename: file.originalname, message: `Larger than 2MB (${Math.round(file.size / 1024)}KB)` });
          continue;
        }

        const result = await uploadBuffer(file.buffer, {
          folder: `tests/${testId}`,
          resource_type: 'image',
        });

        // Cloudinary's secure_url is stable and unsigned, so a review screen
        // opened months later still renders. Access is controlled by the test
        // endpoints, not by making the image URL itself secret.
        const row = await prisma.testImage.upsert({
          where: { url: result.secure_url },
          create: {
            testId,
            url: result.secure_url,
            publicId: result.public_id,
            originalFilename: file.originalname,
            bytes: result.bytes ?? file.size,
          },
          update: {},
        });

        uploaded.push({ imageId: row.id, originalFilename: file.originalname, url: row.url });
      } catch (err) {
        console.error('image upload failed:', file.originalname, err);
        errors.push({ filename: file.originalname, message: 'Upload failed, try again' });
      }
    }

    return res.status(uploaded.length > 0 ? 200 : 400).json({ uploaded, errors });
  } catch (error) {
    console.error('uploadTestImages error:', error);
    return res.status(500).json({ error: { message: 'Failed to upload images' } });
  }
}


// GET /api/admin/tests/:testId/images
// The list an admin matches against their CSV.
async function listTestImages(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const images = await prisma.testImage.findMany({
      where: { testId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, url: true, originalFilename: true, bytes: true, createdAt: true },
    });

    return res.status(200).json({ count: images.length, images });
  } catch (error) {
    console.error('listTestImages error:', error);
    return res.status(500).json({ error: { message: 'Failed to load images' } });
  }
}


/** Every question row on this test that points at a given URL. */
function questionsUsingUrl(testId, url) {
  return prisma.testQuestion.findMany({
    where: {
      testId,
      OR: [
        { questionImageUrl: url }, { optionAImageUrl: url }, { optionBImageUrl: url },
        { optionCImageUrl: url }, { optionDImageUrl: url },
      ],
    },
    select: { questionOrder: true },
    orderBy: { questionOrder: 'asc' },
  });
}


// DELETE /api/admin/tests/:testId/images/:imageId
async function deleteTestImage(req, res) {
  try {
    const testId = Number(req.params.testId);
    const imageId = Number(req.params.imageId);
    if (!Number.isInteger(testId) || !Number.isInteger(imageId)) {
      return res.status(400).json({ error: { message: 'Invalid id' } });
    }

    const image = await prisma.testImage.findUnique({
      where: { id: imageId }, include: { test: { select: { isLocked: true } } },
    });
    if (!image || image.testId !== testId) {
      return res.status(404).json({ error: { message: 'Image not found' } });
    }
    if (image.test.isLocked) {
      return res.status(409).json({
        error: { message: 'This test is locked — students have already attempted it. Its images can no longer be changed.' },
      });
    }

    // Deleting an image a question points at would leave a broken picture on
    // the paper with nothing to say why, so name the questions instead.
    const used = await questionsUsingUrl(testId, image.url);
    if (used.length > 0) {
      const orders = used.map((q) => q.questionOrder).join(', ');
      return res.status(409).json({
        error: { message: `Used in question ${orders} — remove it from the question first.` },
        usedInQuestions: used.map((q) => q.questionOrder),
      });
    }

    // The row goes either way. A Cloudinary failure leaves one orphaned file,
    // which costs storage; keeping the row would keep a dead URL passing the
    // CSV cross-check, which costs a broken image in an exam.
    try {
      await cloudinary.uploader.destroy(image.publicId);
    } catch (err) {
      console.error('cloudinary destroy failed for', image.publicId, err);
    }
    await prisma.testImage.delete({ where: { id: imageId } });

    return res.status(200).json({ message: 'Image deleted', imageId });
  } catch (error) {
    console.error('deleteTestImage error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the image' } });
  }
}


// ─────────────────────────── results ───────────────────────────

// GET /api/admin/tests/:testId/attempts?page=1&limit=50
//
// Who sat the paper and how they did. The admin twin of the student
// leaderboard, but every attempt rather than each student's best — an admin
// investigating a score needs to see the retakes, not a tidied summary.
async function listTestAttempts(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const where = { testId };
    if (req.query.status === 'submitted') where.submittedAt = { not: null };
    if (req.query.status === 'in_progress') where.submittedAt = null;

    const [attempts, total] = await Promise.all([
      prisma.testAttempt.findMany({
        where,
        orderBy: [{ score: 'desc' }, { submittedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, userId: true, score: true, startedAt: true, submittedAt: true,
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
      prisma.testAttempt.count({ where }),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const [correctRows, answeredRows] = attemptIds.length === 0 ? [[], []] : await Promise.all([
      prisma.testAttemptAnswer.groupBy({
        by: ['attemptId'],
        where: { attemptId: { in: attemptIds }, isCorrect: true },
        _count: { testQuestionId: true },
      }),
      prisma.testAttemptAnswer.groupBy({
        by: ['attemptId'],
        where: { attemptId: { in: attemptIds } },
        _count: { testQuestionId: true },
      }),
    ]);
    const correctBy = new Map(correctRows.map((r) => [r.attemptId, r._count.testQuestionId]));
    const answeredBy = new Map(answeredRows.map((r) => [r.attemptId, r._count.testQuestionId]));

    return res.status(200).json({
      test: shapeTest(test),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      attempts: attempts.map((a) => {
        const answered = answeredBy.get(a.id) ?? 0;
        const correct = correctBy.get(a.id) ?? 0;
        return {
          attemptId: a.id,
          student: a.user,
          submitted: Boolean(a.submittedAt),
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
          timeTakenSeconds: a.submittedAt
            ? Math.max(0, Math.round((a.submittedAt - a.startedAt) / 1000))
            : null,
          score: a.score,
          totalMarks: test.totalQuestions * test.marksCorrect,
          answeredCount: answered,
          correctCount: correct,
          wrongCount: answered - correct,
          skippedCount: test.totalQuestions - answered,
        };
      }),
    });
  } catch (error) {
    console.error('listTestAttempts error:', error);
    return res.status(500).json({ error: { message: 'Failed to load attempts' } });
  }
}


// GET /api/admin/tests/:testId/analytics
//
// Which questions the cohort actually got wrong. A paper where everyone missed
// question 14 usually means question 14 is broken, not that 300 people are —
// so the per-question breakdown is the point of this endpoint.
async function getTestAnalytics(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const submitted = await prisma.testAttempt.findMany({
      where: { testId, submittedAt: { not: null } },
      select: { id: true, score: true, startedAt: true, submittedAt: true },
    });

    const questions = await prisma.testQuestion.findMany({
      where: { testId },
      orderBy: { questionOrder: 'asc' },
      select: { id: true, questionOrder: true, questionText: true, correctOption: true, subject: true, topic: true },
    });

    const attemptIds = submitted.map((a) => a.id);
    const answers = attemptIds.length === 0 ? [] : await prisma.testAttemptAnswer.groupBy({
      by: ['testQuestionId', 'selectedOption'],
      where: { attemptId: { in: attemptIds } },
      _count: { attemptId: true },
    });

    const byQuestion = new Map();
    for (const row of answers) {
      if (!byQuestion.has(row.testQuestionId)) byQuestion.set(row.testQuestionId, {});
      byQuestion.get(row.testQuestionId)[row.selectedOption] = row._count.attemptId;
    }

    const participants = submitted.length;
    const scores = submitted.map((a) => a.score ?? 0).sort((a, b) => a - b);
    const times = submitted
      .map((a) => Math.max(0, Math.round((a.submittedAt - a.startedAt) / 1000)))
      .sort((a, b) => a - b);
    const median = (list) => (list.length === 0 ? null
      : list.length % 2 ? list[(list.length - 1) / 2]
      : (list[list.length / 2 - 1] + list[list.length / 2]) / 2);

    return res.status(200).json({
      test: shapeTest(test),
      participants,
      // Median, not mean: one abandoned attempt scoring -40 drags an average
      // somewhere no actual student sat.
      scoreSummary: participants === 0 ? null : {
        highest: scores[scores.length - 1],
        lowest: scores[0],
        median: median(scores),
        totalMarks: test.totalQuestions * test.marksCorrect,
      },
      timeSummary: participants === 0 ? null : {
        fastestSeconds: times[0],
        slowestSeconds: times[times.length - 1],
        medianSeconds: median(times),
        durationSeconds: test.durationMinutes * 60,
      },
      questions: questions.map((q) => {
        const counts = byQuestion.get(q.id) ?? {};
        const answered = ['A', 'B', 'C', 'D'].reduce((sum, k) => sum + (counts[k] ?? 0), 0);
        const correct = counts[q.correctOption] ?? 0;
        return {
          testQuestionId: q.id,
          questionOrder: q.questionOrder,
          questionText: q.questionText,
          correctOption: q.correctOption,
          subject: q.subject,
          topic: q.topic,
          answeredCount: answered,
          correctCount: correct,
          skippedCount: participants - answered,
          // Out of everyone who sat the paper, so a question nobody dared
          // answer reads as hard rather than as a perfect score.
          correctPercent: participants === 0 ? 0 : Math.round((correct / participants) * 100),
          optionCounts: { A: counts.A ?? 0, B: counts.B ?? 0, C: counts.C ?? 0, D: counts.D ?? 0 },
        };
      }),
    });
  } catch (error) {
    console.error('getTestAnalytics error:', error);
    return res.status(500).json({ error: { message: 'Failed to load analytics' } });
  }
}

module.exports = {
  createTest, listTests, uploadTestQuestions,
  clearTestQuestions, publishTest, previewTest,
  uploadTestImages, listTestImages, deleteTestImage,
  listTestAttempts, getTestAnalytics,
  // Exported for test.test.js — pure, no DB.
  validateRows,
};
