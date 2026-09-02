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
  id: true, courseId: true, courseTypeId: true, name: true, type: true,
  instructions: true,
  course: { select: { id: true, title: true } },
  courseType: { select: { id: true, title: true } },
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

    const { name, type, courseTypeId, totalQuestions, durationMinutes, marksCorrect, marksIncorrect, instructions } = req.body ?? {};

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

    // A course type from a different course would silently hide the paper from
    // everyone: the student query matches on both, so it would never appear.
    let typeId = null;
    if (courseTypeId !== undefined && courseTypeId !== null) {
      typeId = Number(courseTypeId);
      if (!Number.isInteger(typeId)) {
        return res.status(400).json({ error: { message: 'courseTypeId must be an integer' } });
      }
      const courseType = await prisma.courseType.findUnique({
        where: { id: typeId }, select: { id: true, courseId: true },
      });
      if (!courseType) {
        return res.status(404).json({ error: { message: 'Course type not found' } });
      }
      if (courseType.courseId !== courseId) {
        return res.status(400).json({ error: { message: 'That course type belongs to a different course' } });
      }
    }

    const test = await prisma.test.create({
      data: {
        courseId,
        courseTypeId: typeId,
        name: name.trim(),
        type: type ?? 'GRAND_TEST',
        totalQuestions: Number(totalQuestions),
        durationMinutes: Number(durationMinutes),
        marksCorrect: marksCorrect === undefined ? 1 : Number(marksCorrect),
        marksIncorrect: marksIncorrect === undefined ? 0 : Number(marksIncorrect),
        instructions: typeof instructions === 'string' && instructions.trim() !== ''
          ? instructions.trim() : null,
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
    if (req.query.courseTypeId !== undefined) {
      const courseTypeId = Number(req.query.courseTypeId);
      if (!Number.isInteger(courseTypeId)) {
        return res.status(400).json({ error: { message: 'courseTypeId must be an integer' } });
      }
      where.courseTypeId = courseTypeId;
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
 * The rules every question must satisfy, whichever door it came in through —
 * a CSV row or the question editor. One function so the two cannot drift: the
 * importer allows an image-only stem, and an editor that quietly did not would
 * be unable to edit the very questions the importer accepted.
 */
function questionProblems(q, rawCorrect) {
  const problems = [];
  if (!q.questionText && !q.questionImageUrl) {
    problems.push({ field: 'question_text', message: 'Question needs text or an image' });
  }
  for (const letter of VALID_OPTIONS) {
    if (!q[`option${letter}`] && !q[`option${letter}ImageUrl`]) {
      problems.push({ field: `option_${letter.toLowerCase()}`, message: `Option ${letter} needs text or an image` });
    }
  }
  if (!VALID_OPTIONS.includes(q.correctOption)) {
    problems.push({ field: 'correct_option', message: `"${rawCorrect ?? ''}" must be one of A, B, C, D` });
  }
  return problems;
}


/**
 * The paper's parts, read off its questions.
 *
 * A section exists exactly when questions carry its label, which is why there
 * is no sections table: nothing can fall out of step, and there is no such
 * thing as an empty part left behind by a deleted question.
 *
 * `questions` must already be in questionOrder — the order sections appear in
 * the paper is the order they are returned.
 */
function sectionsOf(questions) {
  const byName = new Map();
  let unsectioned = 0;
  for (const q of questions) {
    if (!q.section) { unsectioned += 1; continue; }
    const held = byName.get(q.section);
    if (held) {
      held.questionCount += 1;
      held.lastOrder = q.questionOrder;
    } else {
      byName.set(q.section, {
        name: q.section, questionCount: 1,
        firstOrder: q.questionOrder, lastOrder: q.questionOrder,
      });
    }
  }
  // A part whose questions are not consecutive means the paper runs Part A,
  // Part B, Part A again — almost always a reorder that went wrong, and
  // invisible in a list of questions. Cheap to spot here, painful to find on
  // exam day.
  const sections = [...byName.values()].map((x) => ({
    ...x,
    contiguous: x.questionCount === x.lastOrder - x.firstOrder + 1,
  }));

  return { sections, unsectionedCount: unsectioned };
}


/**
 * Validates a whole CSV before anything is written.
 *
 * Returns every problem at once rather than stopping at the first: an admin
 * fixing a 200-row file one error per upload would be here all day.
 *
 * `images` is what was uploaded for THIS test, as `{ url, originalFilename }`.
 * It does two jobs: it resolves a bare filename to its Cloudinary URL, and it
 * flags a URL from outside this test — a typo or a link to another test's
 * image imports cleanly and then fails months later, in front of a student, as
 * a broken image.
 */
function validateRows(header, rows, test, images = null, { allowMissingImages = false } = {}) {
  const errors = [];

  // Filenames are matched case-insensitively: a folder of q1.svg typed into a
  // spreadsheet as Q1.SVG is the same file to everyone except a computer.
  const byFilename = new Map();
  const ambiguous = new Set();
  if (images) {
    for (const image of images) {
      const key = (image.originalFilename ?? '').toLowerCase();
      if (key === '') continue;
      if (byFilename.has(key)) ambiguous.add(key);
      byFilename.set(key, image.url);
    }
  }
  const knownImageUrls = images ? new Set(images.map((i) => i.url)) : null;
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

    // Image columns are optional and independent: a paper can mix text-only
    // questions with image ones, and a question can have a picture while its
    // options do not.
    //
    // A URL from outside this test's uploads is a WARNING, not a block. It is
    // usually a typo, but it is also how an admin references an existing CDN
    // asset, and refusing the whole file for it made a legitimate import
    // impossible. The row still imports; the warning is what makes a typo
    // findable before a student meets a broken image.
    // A cell may hold either a full URL or the name of a file uploaded to this
    // test. The filename is what an admin actually has: they upload a folder of
    // q1.svg..q200.svg, and pasting 200 Cloudinary URLs into a spreadsheet by
    // hand is the step that produces the typos this function exists to catch.
    const resolveImage = (field, value) => {
      if (value === '') return '';

      if (/^https?:\/\/\S+$/i.test(value)) {
        if (knownImageUrls && !knownImageUrls.has(value)) {
          errors.push({
            row: row.line, field, severity: 'warning',
            message: `Not one of this test's uploaded images — check it loads: ${value}`,
          });
        }
        return value;
      }

      const key = value.toLowerCase();
      if (ambiguous.has(key)) {
        at(field, `Two uploaded images are both named "${value}" — rename one and upload it again, or use its full URL`);
        return '';
      }
      const resolved = byFilename.get(key);
      if (resolved) return resolved;

      // Neither a URL nor a file on this test. Blocking by default, because it
      // can never load: importing it only defers the failure to a student.
      const message = byFilename.size === 0
        ? `No images have been uploaded to this test yet, so "${value}" cannot be resolved. Upload the images first.`
        : `"${value}" is not a URL and no image with that name was uploaded to this test`;

      if (allowMissingImages) {
        // Imported with no picture, and named loudly enough that the admin can
        // go and attach it in the question editor.
        errors.push({
          row: row.line, field, severity: 'warning',
          message: `${message} Imported without an image — add it to question ${order} before publishing.`,
        });
        return '';
      }
      at(field, message);
      return '';
    };

    // `_filename` is an accepted alias for `_url`, because a column of file
    // names is what a spreadsheet naturally holds. Either column, either kind
    // of value.
    const imageCell = (base) => r[`${base}_url`] || r[`${base}_filename`] || '';

    const questionImageUrl = resolveImage('question_image_url', imageCell('question_image'));

    const optionValues = {};
    for (const letter of VALID_OPTIONS) {
      const lower = letter.toLowerCase();
      optionValues[letter] = {
        text: r[`option_${lower}`] ?? '',
        imageUrl: resolveImage(`option_${lower}_image_url`, imageCell(`option_${lower}_image`)),
      };
    }

    const correct = (r.correct_option ?? '').toUpperCase();

    // Text-or-image and the correct-option letter are checked by the same code
    // the question editor uses, so a row the importer accepts is always a row
    // the editor will let you edit.
    for (const problem of questionProblems({
      questionText: r.question_text || null,
      questionImageUrl: questionImageUrl || null,
      optionA: optionValues.A.text || null, optionAImageUrl: optionValues.A.imageUrl || null,
      optionB: optionValues.B.text || null, optionBImageUrl: optionValues.B.imageUrl || null,
      optionC: optionValues.C.text || null, optionCImageUrl: optionValues.C.imageUrl || null,
      optionD: optionValues.D.text || null, optionDImageUrl: optionValues.D.imageUrl || null,
      correctOption: correct,
    }, r.correct_option)) {
      at(problem.field, problem.message);
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
      // Optional. A paper with no section column is simply a paper with no
      // parts, which is what most of them are.
      section: r.section || null,
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

    const images = await prisma.testImage.findMany({
      where: { testId }, select: { url: true, originalFilename: true },
    });
    // Lets an admin build the paper text-first and attach pictures afterwards.
    // Off by default: a question whose diagram is missing is a broken question,
    // and importing one silently is how a student meets it in an exam.
    const allowMissingImages = req.query.allowMissingImages === 'true';

    const { errors, questions } = validateRows(header, rows, test, images, { allowMissingImages });
    const blocking = errors.filter((e) => e.severity !== 'warning');

    // A count mismatch is a WARNING, not a refusal.
    //
    // The declaration exists so a paper claiming 200 questions cannot quietly
    // serve 198 — and publish still enforces exactly that. Blocking the import
    // as well only forced an admin to go and edit the test before they were
    // allowed to look at their own file, while the real gate stayed where it
    // belongs.
    if (rows.length !== test.totalQuestions) {
      errors.push({
        row: 1, field: 'header', severity: 'warning',
        message: `This test expects ${test.totalQuestions} questions and the file has ${rows.length}. It will import, but the test cannot be published until the two match.`,
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

    const { sections, unsectionedCount } = sectionsOf(questions);

    return res.status(200).json({
      test: shapeTest(test),
      sections,
      // Above zero alongside a non-empty `sections` means the paper is half
      // labelled — worth saying, because those questions render outside every
      // part and an admin who split the paper did not mean to leave them there.
      unsectionedCount,
      questions,
    });
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


// DELETE /api/admin/tests/:testId
//
// Questions, images and attempts all cascade, which is exactly why an attempted
// paper cannot be deleted: it would erase results students have already sat
// for, and there is nothing to restore them from.
async function deleteTest(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true, name: true, isLocked: true,
        _count: { select: { attempts: true, questions: true } },
        images: { select: { id: true, publicId: true } },
      },
    });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    // Deleting a paper students have sat destroys their results, their ranks
    // and their review sheets, and nothing brings those back. So it takes a
    // second, explicit call rather than one click — and the refusal says how,
    // instead of leaving an admin to guess whether it is possible at all.
    const confirmed = req.query.deleteAttempts === 'true';

    if (test._count.attempts > 0 && !confirmed) {
      const submitted = await prisma.testAttempt.count({
        where: { testId, submittedAt: { not: null } },
      });
      return res.status(409).json({
        error: {
          message: `Cannot delete: ${test._count.attempts} student attempt(s) exist, ${submitted} of them completed. Unpublish it instead — deleting erases their results permanently.`,
        },
        attemptCount: test._count.attempts,
        submittedCount: submitted,
        // The panel turns this into a second, typed confirmation. It is not a
        // formality: unpublishing is what an admin wants nine times out of ten,
        // and this endpoint is the tenth.
        canForce: true,
        forceWith: `DELETE /api/admin/tests/${testId}?deleteAttempts=true`,
      });
    }

    // Counted before the cascade removes them, so the response can say what was
    // actually destroyed rather than what was asked for.
    const answerCount = test._count.attempts === 0 ? 0 : await prisma.testAttemptAnswer.count({
      where: { attempt: { testId } },
    });

    // Cloudinary first. Dropping the rows before the files would leave assets
    // nobody can find, let alone delete.
    for (const image of test.images) {
      try {
        await cloudinary.uploader.destroy(image.publicId);
      } catch (err) {
        console.error('cloudinary destroy failed for', image.publicId, err);
      }
    }

    await prisma.test.delete({ where: { id: testId } });

    const destroyed = test._count.attempts > 0
      ? ` This also erased ${test._count.attempts} student attempt(s) and ${answerCount} answer(s).`
      : '';

    return res.status(200).json({
      message: `Deleted "${test.name}" with ${test._count.questions} question(s) and ${test.images.length} image(s).${destroyed}`,
      testId,
      deletedQuestions: test._count.questions,
      deletedImages: test.images.length,
      deletedAttempts: test._count.attempts,
      deletedAnswers: answerCount,
    });
  } catch (error) {
    console.error('deleteTest error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the test' } });
  }
}

// PATCH /api/admin/tests/:testId
//
// One rule, so it is explainable in the UI: once a single student has started
// the paper, only the name may change.
//
// Everything else is baked into results that already exist. marksCorrect is
// stored per answer at answer time, so editing it would leave one attempt
// scored two different ways. durationMinutes is the deadline of an attempt
// running right now. totalQuestions is what the score is out of. courseTypeId
// decides who can see it — moving it would hide the paper from the very
// students who sat it.
const EDITABLE_WHEN_UNTOUCHED = [
  'type', 'courseTypeId', 'totalQuestions', 'durationMinutes',
  'marksCorrect', 'marksIncorrect',
];

async function updateTest(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const body = req.body ?? {};
    const data = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return res.status(400).json({ error: { message: 'name cannot be empty' } });
      }
      data.name = body.name.trim();
    }

    // Instructions sit with the name, not with the scoring fields. They change
    // nothing that has already been marked, and a typo in the rules of a live
    // paper should be fixable without building a second one.
    if (body.instructions !== undefined) {
      if (body.instructions === null || (typeof body.instructions === 'string' && body.instructions.trim() === '')) {
        data.instructions = null;
      } else if (typeof body.instructions !== 'string') {
        return res.status(400).json({ error: { message: 'instructions must be text' } });
      } else {
        data.instructions = body.instructions.trim();
      }
    }

    const touched = EDITABLE_WHEN_UNTOUCHED.filter((f) => body[f] !== undefined);
    if (touched.length > 0 && test._count.attempts > 0) {
      return res.status(409).json({
        error: {
          message: `${test._count.attempts} student(s) have already started this test, so only the name can be changed. Create a new test instead — editing this one would rewrite their results.`,
        },
        attemptCount: test._count.attempts,
        lockedFields: touched,
      });
    }

    if (body.type !== undefined) {
      if (!TEST_TYPES.includes(body.type)) {
        return res.status(400).json({ error: { message: `type must be one of: ${TEST_TYPES.join(', ')}` } });
      }
      data.type = body.type;
    }

    if (body.totalQuestions !== undefined) {
      const total = Number(body.totalQuestions);
      if (!Number.isInteger(total) || total < 1) {
        return res.status(400).json({ error: { message: 'totalQuestions must be a positive integer' } });
      }
      // Lowering it below what is already imported would leave rows the paper
      // does not admit to having, and publish would then never pass.
      if (total < test._count.questions) {
        return res.status(409).json({
          error: { message: `This test already holds ${test._count.questions} questions. Clear them first to shrink it to ${total}.` },
          questionCount: test._count.questions,
        });
      }
      data.totalQuestions = total;
    }

    if (body.durationMinutes !== undefined) {
      const minutes = Number(body.durationMinutes);
      if (!Number.isInteger(minutes) || minutes < 1) {
        return res.status(400).json({ error: { message: 'durationMinutes must be a positive integer' } });
      }
      data.durationMinutes = minutes;
    }

    if (body.marksCorrect !== undefined) {
      const marks = Number(body.marksCorrect);
      if (!Number.isFinite(marks) || marks <= 0) {
        return res.status(400).json({ error: { message: 'marksCorrect must be greater than zero' } });
      }
      data.marksCorrect = marks;
    }

    if (body.marksIncorrect !== undefined) {
      const marks = Number(body.marksIncorrect);
      if (!Number.isFinite(marks) || marks > 0) {
        return res.status(400).json({ error: { message: 'marksIncorrect must be zero or negative (e.g. -0.25)' } });
      }
      data.marksIncorrect = marks;
    }

    if (body.courseTypeId !== undefined) {
      if (body.courseTypeId === null) {
        data.courseTypeId = null;
      } else {
        const typeId = Number(body.courseTypeId);
        if (!Number.isInteger(typeId)) {
          return res.status(400).json({ error: { message: 'courseTypeId must be an integer or null' } });
        }
        const courseType = await prisma.courseType.findUnique({
          where: { id: typeId }, select: { id: true, courseId: true },
        });
        if (!courseType) return res.status(404).json({ error: { message: 'Course type not found' } });
        if (courseType.courseId !== test.courseId) {
          return res.status(400).json({ error: { message: 'That course type belongs to a different course' } });
        }
        data.courseTypeId = typeId;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    // Shrinking or re-scoping a live paper mid-flight is the same problem as
    // editing its questions, so it drops back to draft and has to be reviewed
    // and published again.
    const changesThePaper = ['totalQuestions', 'durationMinutes', 'marksCorrect', 'marksIncorrect', 'courseTypeId']
      .some((f) => data[f] !== undefined);
    if (test.isPublished && changesThePaper) data.isPublished = false;

    const updated = await prisma.test.update({
      where: { id: testId }, data, select: TEST_SELECT,
    });

    return res.status(200).json({
      test: shapeTest(updated),
      unpublished: data.isPublished === false,
    });
  } catch (error) {
    console.error('updateTest error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the test' } });
  }
}


// GET /api/admin/tests/:testId/leaderboard?limit=100
//
// The same ranking the students see, from the same code — an admin explaining
// a rank to a parent needs the number the student was shown, not a second
// ordering that happens to agree most of the time.
//
// Two differences: unpublished papers are visible, and rows carry the email.
async function getTestLeaderboard(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const test = await prisma.test.findUnique({ where: { id: testId }, select: TEST_SELECT });
    if (!test) return res.status(404).json({ error: { message: 'Test not found' } });

    const { buildLeaderboard } = require('./testAttempt.controller');
    const ranked = await buildLeaderboard(test, { includeEmail: true });

    const scores = ranked.map((r) => r.score);
    const sorted = [...scores].sort((a, b) => a - b);

    return res.status(200).json({
      test: shapeTest(test),
      totalMarks: test.totalQuestions * test.marksCorrect,
      totalParticipants: ranked.length,
      stats: ranked.length === 0 ? null : {
        highest: sorted[sorted.length - 1],
        lowest: sorted[0],
        average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
        // Median, not just the mean: one abandoned zero drags an average down
        // far enough to misread a cohort that mostly did fine.
        median: sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : Number(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2)),
        fastestSeconds: Math.min(...ranked.map((r) => r.timeTakenSeconds)),
      },
      entries: ranked.slice(0, limit),
    });
  } catch (error) {
    console.error('admin getTestLeaderboard error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the leaderboard' } });
  }
}


// GET /api/admin/test-attempts/in-progress?courseId=&testId=&page=1&limit=50
//
// Who is sitting an exam right now.
//
// An expired attempt is only closed when someone next touches it, so this list
// separates the two: `live` is a student actually writing, `expired` is one who
// walked away and whose paper will submit itself on their next request. Showing
// both as "in progress" would report a room full of candidates who left hours
// ago.
async function listInProgressAttempts(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const where = { submittedAt: null };
    if (req.query.testId !== undefined) {
      const testId = Number(req.query.testId);
      if (!Number.isInteger(testId)) {
        return res.status(400).json({ error: { message: 'testId must be an integer' } });
      }
      where.testId = testId;
    }
    if (req.query.courseId !== undefined) {
      const courseId = Number(req.query.courseId);
      if (!Number.isInteger(courseId)) {
        return res.status(400).json({ error: { message: 'courseId must be an integer' } });
      }
      where.test = { courseId };
    }

    const [attempts, total] = await Promise.all([
      prisma.testAttempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, startedAt: true,
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          test: { select: { id: true, name: true, totalQuestions: true, durationMinutes: true } },
          _count: { select: { answers: true } },
        },
      }),
      prisma.testAttempt.count({ where }),
    ]);

    const now = Date.now();
    const rows = attempts.map((a) => {
      const deadline = new Date(a.startedAt.getTime() + a.test.durationMinutes * 60_000);
      const remaining = Math.max(0, Math.round((deadline - now) / 1000));
      return {
        attemptId: a.id,
        student: a.user,
        test: a.test,
        startedAt: a.startedAt,
        deadlineAt: deadline,
        secondsRemaining: remaining,
        expired: remaining === 0,
        answeredCount: a._count.answers,
        remainingCount: a.test.totalQuestions - a._count.answers,
      };
    });

    return res.status(200).json({
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      liveCount: rows.filter((r) => !r.expired).length,
      expiredCount: rows.filter((r) => r.expired).length,
      attempts: rows,
    });
  } catch (error) {
    console.error('listInProgressAttempts error:', error);
    return res.status(500).json({ error: { message: 'Failed to load in-progress attempts' } });
  }
}


// ── One question at a time ──────────────────────────────────────────────────
//
// The CSV builds the paper; these fix it. A typo in question 87 of a
// 200-question import should not mean re-uploading the file, which is what
// clearing and re-importing actually costs once images are attached.

const QUESTION_TEXT_FIELDS = [
  'questionText', 'questionImageUrl',
  'optionA', 'optionAImageUrl', 'optionB', 'optionBImageUrl',
  'optionC', 'optionCImageUrl', 'optionD', 'optionDImageUrl',
  'explanation', 'subject', 'topic', 'section',
];

/** Merges a request body onto an existing question (or onto blanks, for a new one). */
function readQuestionBody(body, existing = {}) {
  const q = {};
  for (const field of QUESTION_TEXT_FIELDS) {
    const value = body[field] !== undefined ? body[field] : existing[field];
    if (value === undefined || value === null) { q[field] = null; continue; }
    if (typeof value !== 'string') return { error: `${field} must be text` };
    q[field] = value.trim() === '' ? null : value.trim();
  }
  const correct = body.correctOption !== undefined ? body.correctOption : existing.correctOption;
  q.correctOption = typeof correct === 'string' ? correct.toUpperCase() : correct;

  for (const field of ['questionImageUrl', 'optionAImageUrl', 'optionBImageUrl', 'optionCImageUrl', 'optionDImageUrl']) {
    if (q[field] && !/^https?:\/\/\S+$/i.test(q[field])) {
      return { error: `${field} is not a valid URL: ${q[field]}` };
    }
  }
  return { question: q };
}

/** The test, if it exists and its questions can still be changed. */
async function editableTest(testId, res) {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    select: { id: true, name: true, isLocked: true, totalQuestions: true },
  });
  if (!test) {
    res.status(404).json({ error: { message: 'Test not found' } });
    return null;
  }
  // The same freeze that stops a CSV re-import. Editing a question after
  // someone has answered it would rewrite a score that has already been shown.
  if (test.isLocked) {
    res.status(409).json({
      error: { message: 'This test is locked — students have already sat it. Its questions can no longer be changed.' },
    });
    return null;
  }
  return test;
}


/**
 * Shifts a run of questionOrder values by one, without tripping the
 * [testId, questionOrder] unique index.
 *
 * A plain `SET question_order = question_order + 1` fails: Postgres checks the
 * index row by row, so moving 2 to 3 collides with the 3 that is still there.
 * Negating first parks the whole run somewhere nothing else lives, and the
 * second statement brings it back to the value it should have.
 */
async function shiftOrders(tx, testId, where, delta) {
  await tx.$executeRawUnsafe(
    `UPDATE test_questions SET "questionOrder" = -"questionOrder" WHERE "testId" = $1 AND "questionOrder" ${where}`,
    testId,
  );
  await tx.$executeRawUnsafe(
    `UPDATE test_questions SET "questionOrder" = -"questionOrder" + $2 WHERE "testId" = $1 AND "questionOrder" < 0`,
    testId, delta,
  );
}


// POST /api/admin/tests/:testId/questions
async function createTestQuestion(req, res) {
  try {
    const testId = Number(req.params.testId);
    if (!Number.isInteger(testId)) {
      return res.status(400).json({ error: { message: 'Invalid test id' } });
    }
    const test = await editableTest(testId, res);
    if (!test) return;

    const { question, error } = readQuestionBody(req.body ?? {});
    if (error) return res.status(400).json({ error: { message: error } });

    const problems = questionProblems(question, req.body?.correctOption);
    if (problems.length > 0) {
      return res.status(400).json({ error: { message: problems[0].message }, problems });
    }

    const last = await prisma.testQuestion.findFirst({
      where: { testId }, orderBy: { questionOrder: 'desc' }, select: { questionOrder: true },
    });
    const lastOrder = last?.questionOrder ?? 0;

    let order = lastOrder + 1;
    if (req.body?.questionOrder !== undefined) {
      order = Number(req.body.questionOrder);
      if (!Number.isInteger(order) || order < 1 || order > lastOrder + 1) {
        return res.status(400).json({
          error: { message: `questionOrder must be between 1 and ${lastOrder + 1}` },
        });
      }
    }

    // Inserting in the middle pushes everything after it down, so an admin
    // adding a missed question does not have to renumber the rest by hand.
    const created = await prisma.$transaction(async (tx) => {
      if (order <= lastOrder) await shiftOrders(tx, testId, `>= ${order}`, 1);
      return tx.testQuestion.create({ data: { ...question, testId, questionOrder: order } });
    });

    const count = await prisma.testQuestion.count({ where: { testId } });
    return res.status(201).json({
      question: created,
      questionCount: count,
      readyToPublish: count === test.totalQuestions,
    });
  } catch (error) {
    console.error('createTestQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to add the question' } });
  }
}


// PATCH /api/admin/tests/:testId/questions/:questionId
async function updateTestQuestion(req, res) {
  try {
    const testId = Number(req.params.testId);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(testId) || !Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid id' } });
    }
    const test = await editableTest(testId, res);
    if (!test) return;

    const existing = await prisma.testQuestion.findUnique({ where: { id: questionId } });
    if (!existing || existing.testId !== testId) {
      return res.status(404).json({ error: { message: 'Question not found on this test' } });
    }

    const { question, error } = readQuestionBody(req.body ?? {}, existing);
    if (error) return res.status(400).json({ error: { message: error } });

    const problems = questionProblems(question, req.body?.correctOption ?? existing.correctOption);
    if (problems.length > 0) {
      return res.status(400).json({ error: { message: problems[0].message }, problems });
    }

    let order = existing.questionOrder;
    if (req.body?.questionOrder !== undefined) {
      order = Number(req.body.questionOrder);
      if (!Number.isInteger(order) || order < 1) {
        return res.status(400).json({ error: { message: 'questionOrder must be a positive integer' } });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (order !== existing.questionOrder) {
        // Move-up / move-down in the editor. The question already at that
        // position takes this one's place rather than the write failing on the
        // unique constraint, which is what an admin dragging a row means.
        const occupant = await tx.testQuestion.findFirst({ where: { testId, questionOrder: order } });
        if (occupant) {
          await tx.testQuestion.update({ where: { id: occupant.id }, data: { questionOrder: -1 } });
          await tx.testQuestion.update({ where: { id: questionId }, data: { questionOrder: order } });
          await tx.testQuestion.update({ where: { id: occupant.id }, data: { questionOrder: existing.questionOrder } });
        }
      }
      return tx.testQuestion.update({
        where: { id: questionId }, data: { ...question, questionOrder: order },
      });
    });

    return res.status(200).json({ question: updated, swapped: order !== existing.questionOrder });
  } catch (error) {
    console.error('updateTestQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the question' } });
  }
}


// DELETE /api/admin/tests/:testId/questions/:questionId
async function deleteTestQuestion(req, res) {
  try {
    const testId = Number(req.params.testId);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(testId) || !Number.isInteger(questionId)) {
      return res.status(400).json({ error: { message: 'Invalid id' } });
    }
    const test = await editableTest(testId, res);
    if (!test) return;

    const existing = await prisma.testQuestion.findUnique({ where: { id: questionId } });
    if (!existing || existing.testId !== testId) {
      return res.status(404).json({ error: { message: 'Question not found on this test' } });
    }

    // Closing the gap keeps the paper numbered 1..n. Postgres checks the
    // unique constraint once the statement finishes, so shifting the whole
    // tail down by one in a single update is safe here.
    await prisma.$transaction(async (tx) => {
      await tx.testQuestion.delete({ where: { id: questionId } });
      await shiftOrders(tx, testId, `> ${existing.questionOrder}`, -1);
    });

    const count = await prisma.testQuestion.count({ where: { testId } });
    return res.status(200).json({
      message: `Deleted question ${existing.questionOrder}. The rest have been renumbered.`,
      questionId,
      questionCount: count,
      // Below what the test declares, so publish will refuse until it is fixed.
      readyToPublish: count === test.totalQuestions,
      expectedQuestions: test.totalQuestions,
    });
  } catch (error) {
    console.error('deleteTestQuestion error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the question' } });
  }
}


module.exports = {
  createTest, updateTest, listTests, uploadTestQuestions,
  clearTestQuestions, publishTest, previewTest,
  uploadTestImages, listTestImages, deleteTestImage,
  listTestAttempts, getTestAnalytics, deleteTest,
  getTestLeaderboard, listInProgressAttempts,
  createTestQuestion, updateTestQuestion, deleteTestQuestion,
  // Exported for test.test.js — pure, no DB.
  validateRows, questionProblems, sectionsOf,
};
