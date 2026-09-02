// CSV import validation. Run: node src/controllers/test.test.js
const assert = require('assert');
const { parseCsv } = require('../utils/csv');
const { validateRows, questionProblems, sectionsOf } = require('./test.controller');

const TEST = { id: 1, totalQuestions: 2 };
const HEAD = 'question_order,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,subject,topic';

const KNOWN = [
  { url: 'https://cdn.test/a.jpg', originalFilename: 'a.jpg' },
  { url: 'https://cdn.test/b.jpg', originalFilename: 'b.jpg' },
];

function run(csv, known) {
  const { header, rows } = parseCsv(csv);
  return validateRows(header, rows, TEST, known);
}

// A clean file produces no blocking errors and rows ready to insert.
const ok = run(`${HEAD}\n1,Q one,A,B,C,D,A,Because,Cardio,MI\n2,Q two,A,B,C,D,c,,,\n`);
assert.deepStrictEqual(ok.errors.filter((e) => e.severity !== 'warning'), []);
assert.strictEqual(ok.questions.length, 2);
assert.strictEqual(ok.questions[0].correctOption, 'A');
assert.strictEqual(ok.questions[1].correctOption, 'C', 'lowercase c must be accepted and normalised');
assert.strictEqual(ok.questions[1].explanation, null, 'an empty optional column is null, not ""');

// A missing required column is one header error, not one error per row — a
// 200-row file with no correct_option column would otherwise return 200 errors.
const noCol = run('question_text,option_a,option_b,option_c,option_d\nQ,A,B,C,D\n');
assert.strictEqual(noCol.errors.length, 1);
assert.strictEqual(noCol.errors[0].field, 'header');
assert(noCol.errors[0].message.includes('correct_option'));

// correct_option outside A-D is the error most likely to reach production —
// "1", "Option A" and "" all have to be caught.
for (const bad of ['E', '1', 'Option A', '']) {
  const r = run(`${HEAD}\n1,Q,A,B,C,D,${bad},,,\n`);
  assert(r.errors.some((e) => e.field === 'correct_option'), `"${bad}" must be rejected`);
}

// An empty option is a broken question even though the row parses.
const blank = run(`${HEAD}\n1,Q,A,,C,D,A,,,\n`);
assert(blank.errors.some((e) => e.field === 'option_b'));

// Errors carry the FILE line, not the row index, so an admin can go straight
// to it. Data row 2 is line 3.
const late = run(`${HEAD}\n1,Q one,A,B,C,D,A,,,\n2,Q two,A,B,C,D,Z,,,\n`);
assert.strictEqual(late.errors[0].row, 3);

// A duplicate order would silently drop a question via the unique constraint.
const dupOrder = run(`${HEAD}\n1,Q one,A,B,C,D,A,,,\n1,Q two,A,B,C,D,B,,,\n`);
assert(dupOrder.errors.some((e) => e.field === 'question_order' && e.message.includes('Duplicate')));

// Duplicate text is a WARNING, not a block — a paper may legitimately repeat
// wording, so it must not stop the import.
const dupText = run(`${HEAD}\n1,Same,A,B,C,D,A,,,\n2,Same,A,B,C,D,B,,,\n`);
assert.strictEqual(dupText.errors.filter((e) => e.severity !== 'warning').length, 0,
  'duplicate text must not block');
assert(dupText.errors.some((e) => e.severity === 'warning'));

// Without a question_order column, file position supplies the order.
const noOrder = run('question_text,option_a,option_b,option_c,option_d,correct_option\nQ one,A,B,C,D,A\nQ two,A,B,C,D,B\n');
assert.deepStrictEqual(noOrder.questions.map((q) => q.questionOrder), [1, 2]);

// A comma inside a quoted stem must survive to the stored question.
const comma = run(`${HEAD}\n1,"A 60-year-old man, previously well",A,B,C,D,A,,,\n`);
assert.strictEqual(comma.questions[0].questionText, 'A 60-year-old man, previously well');

// ── images ─────────────────────────────────────────────────────────────────
const IHEAD = 'question_order,question_text,question_image_url,option_a,option_a_image_url,option_b,option_c,option_d,correct_option';

// An image-only question is valid: an ECG or a slide is often the whole stem.
const imgOnly = run(`${IHEAD}\n1,,https://cdn.test/a.jpg,A,,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(imgOnly.errors.filter((e) => e.severity !== 'warning'), []);
assert.strictEqual(imgOnly.questions[0].questionText, null);
assert.strictEqual(imgOnly.questions[0].questionImageUrl, 'https://cdn.test/a.jpg');

// An image-only OPTION is valid too — "which slide shows..." has picture answers.
const optImg = run(`${IHEAD}\n1,Which slide?,,,https://cdn.test/b.jpg,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(optImg.errors.filter((e) => e.severity !== 'warning'), []);
assert.strictEqual(optImg.questions[0].optionA, null);
assert.strictEqual(optImg.questions[0].optionAImageUrl, 'https://cdn.test/b.jpg');

// Neither text nor image is the actual error case.
const empty = run(`${IHEAD}\n1,,,A,,B,C,D,A\n`, KNOWN);
assert(empty.errors.some((e) => e.field === 'question_text' && e.message.includes('text or an image')));

const emptyOpt = run(`${IHEAD}\n1,Q,,,,B,C,D,A\n`, KNOWN);
assert(emptyOpt.errors.some((e) => e.field === 'option_a' && e.message.includes('text or an image')));

// A URL from outside this test's uploads WARNS but still imports. Blocking it
// made referencing an existing CDN asset impossible, and made every template
// with placeholder URLs unusable.
const foreign = run(`${IHEAD}\n1,Q,https://cdn.other/x.jpg,A,,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(foreign.errors.filter((e) => e.severity !== 'warning'), [],
  'an unknown URL must not block the import');
assert(foreign.errors.some((e) => e.severity === 'warning' && e.field === 'question_image_url'));

// Many rows on one external host collapse to ONE warning naming the lines. A
// wall of identical amber rows on a file that imported perfectly reads as
// failure, which is how a successful import gets mistaken for a broken one.
const manyForeign = run(
  `${IHEAD}\n` + [1, 2, 3, 4, 5].map((i) =>
    `${i},Q${i},https://placehold.co/600x400?text=${i},A,,B,C,D,A`).join('\n') + '\n',
  KNOWN);
const warns = manyForeign.errors.filter((e) => e.severity === 'warning');
assert.strictEqual(warns.length, 1, 'five foreign URLs on one host is one warning');
assert.deepStrictEqual(warns[0].rows, [2, 3, 4, 5, 6], 'and it names every line');
assert(warns[0].message.includes('placehold.co'));
assert(warns[0].message.includes('5 rows'));
assert.strictEqual(manyForeign.questions.length, 5, 'all five still import');

// Two hosts stay two warnings — they are different things to check.
const twoHosts = run(
  `${IHEAD}\n1,Q,https://a.example/x.jpg,A,,B,C,D,A\n2,Q2,https://b.example/y.jpg,A,,B,C,D,A\n`,
  KNOWN);
assert.strictEqual(twoHosts.errors.filter((e) => e.severity === 'warning').length, 2);

// A single stray URL still reads naturally, not as "1 rows".
const oneForeign = run(`${IHEAD}\n1,Q,https://placehold.co/x.png,A,,B,C,D,A\n`, KNOWN);
const single = oneForeign.errors.find((e) => e.severity === 'warning');
assert(single.message.startsWith('Line 2 uses an image'), single.message);
assert.strictEqual(foreign.questions[0].questionImageUrl, 'https://cdn.other/x.jpg',
  'the URL is kept — the admin was warned, not overruled');

// A typo in a known URL still warns, which is what makes it findable.
const typo = run(`${IHEAD}\n1,Q,https://cdn.test/a.jpeg,A,,B,C,D,A\n`, KNOWN);
assert(typo.errors.some((e) => e.severity === 'warning' && e.field === 'question_image_url'));

// A filename that matches nothing uploaded IS a blocking error — it can never
// load, so importing it only defers the failure to a student.
const notUrl = run(`${IHEAD}\n1,Q,q3_xray.jpg,A,,B,C,D,A\n`, KNOWN);
assert(notUrl.errors.some((e) => e.severity !== 'warning' && e.field === 'question_image_url'),
  'an unknown filename must be rejected');
assert.strictEqual(notUrl.questions[0].questionImageUrl, null);

// ── filenames resolve to the uploaded URL ─────────────────────────────────
// Pasting 200 Cloudinary URLs into a spreadsheet by hand is the step that
// produces typos, so the name of an uploaded file is accepted instead.
const byName = run(`${IHEAD}\n1,Q,a.jpg,A,,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(byName.errors, [], 'a known filename must not warn or block');
assert.strictEqual(byName.questions[0].questionImageUrl, 'https://cdn.test/a.jpg');

// Case must not matter: a folder of a.jpg typed as A.JPG is the same file to
// everyone except a computer.
const upper = run(`${IHEAD}\n1,Q,A.JPG,A,,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(upper.errors, []);
assert.strictEqual(upper.questions[0].questionImageUrl, 'https://cdn.test/a.jpg');

// Options resolve by filename too.
const optName = run(`${IHEAD}\n1,Q,,,b.jpg,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(optName.errors.filter((e) => e.severity !== 'warning'), []);
assert.strictEqual(optName.questions[0].optionAImageUrl, 'https://cdn.test/b.jpg');

// A _filename column is an alias for a _url column — a spreadsheet naturally
// holds file names, and that header is what an admin writes.
const FHEAD = 'question_order,question_text,question_image_filename,option_a,option_b,option_c,option_d,correct_option';
const aliased = run(`${FHEAD}\n1,Q,a.jpg,A,B,C,D,A\n`, KNOWN);
assert.deepStrictEqual(aliased.errors, [], 'question_image_filename must be read');
assert.strictEqual(aliased.questions[0].questionImageUrl, 'https://cdn.test/a.jpg');

// Two uploads sharing a name cannot be resolved — picking one silently would
// put the wrong picture on a question.
const DUPES = [
  { url: 'https://cdn.test/one.jpg', originalFilename: 'ecg.svg' },
  { url: 'https://cdn.test/two.jpg', originalFilename: 'ECG.svg' },
];
const dupName = run(`${IHEAD}\n1,Q,ecg.svg,A,,B,C,D,A\n`, DUPES);
assert(dupName.errors.some((e) => e.field === 'question_image_url' && e.message.includes('both named')),
  'an ambiguous filename must block rather than guess');

// With nothing uploaded, the message has to say so — "not a valid URL" would
// send an admin hunting for a typo that is not there.
const nothingUp = run(`${IHEAD}\n1,Q,a.jpg,A,,B,C,D,A\n`, []);
assert(nothingUp.errors.some((e) => e.message.includes('No images have been uploaded')));

// With no known-set supplied (nothing uploaded), URLs are not cross-checked but
// text-or-image still applies.
const noSet = run(`${IHEAD}\n1,Q,https://anything/x.jpg,A,,B,C,D,A\n`, null);
assert.deepStrictEqual(noSet.errors.filter((e) => e.severity !== 'warning'), []);

// Two image-only questions both have empty text; that must not trip the
// duplicate-text warning.
const twoImg = run(`${IHEAD}\n1,,https://cdn.test/a.jpg,A,,B,C,D,A\n2,,https://cdn.test/b.jpg,A,,B,C,D,B\n`, KNOWN);
assert.deepStrictEqual(twoImg.errors, [], 'empty text must not count as duplicate text');


// ── importing before the images are uploaded ──

// By default an unresolvable name blocks: a question whose diagram is missing
// is a broken question, and importing it only defers the failure to a student.
const noImagesYet = run(`${IHEAD}\n1,Q,sample_q1.svg,A,,B,C,D,A\n`, []);
assert(noImagesYet.errors.some((e) => e.severity !== 'warning'
  && e.message.includes('No images have been uploaded')));
assert.strictEqual(noImagesYet.questions[0].questionImageUrl, null);

// With allowMissingImages the same row imports, and the warning names the
// question so it can be fixed in the editor rather than lost.
const allowed = validateRows(
  ...(() => { const { header, rows } = parseCsv(`${IHEAD}\n1,Q,sample_q1.svg,A,,B,C,D,A\n`); return [header, rows]; })(),
  TEST, [], { allowMissingImages: true });
assert.deepStrictEqual(allowed.errors.filter((e) => e.severity !== 'warning'), [],
  'allowMissingImages must not block');
assert(allowed.errors.some((e) => e.severity === 'warning' && e.message.includes('question 1')),
  'the warning must name the question to fix');
assert.strictEqual(allowed.questions[0].questionImageUrl, null);
assert.strictEqual(allowed.questions[0].questionText, 'Q', 'the row still imports');

// A name that DOES resolve is unaffected by the flag.
const stillResolves = validateRows(
  ...(() => { const { header, rows } = parseCsv(`${IHEAD}\n1,Q,a.jpg,A,,B,C,D,A\n`); return [header, rows]; })(),
  TEST, KNOWN, { allowMissingImages: true });
assert.deepStrictEqual(stillResolves.errors, []);
assert.strictEqual(stillResolves.questions[0].questionImageUrl, 'https://cdn.test/a.jpg');

// The flag is about missing files, not broken input: something that is not a
// URL and not a filename shape is still whatever it was.
const flagIsNotABypass = validateRows(
  ...(() => { const { header, rows } = parseCsv(`${IHEAD}\n1,,,A,,B,C,D,A\n`); return [header, rows]; })(),
  TEST, KNOWN, { allowMissingImages: true });
assert(flagIsNotABypass.errors.some((e) => e.severity !== 'warning' && e.field === 'question_text'),
  'a question with neither text nor image is still an error');


// ── sections are read off the questions ──

const paper = [
  { questionOrder: 1, section: 'Part A' },
  { questionOrder: 2, section: 'Part A' },
  { questionOrder: 3, section: 'Part B' },
  { questionOrder: 4, section: null },
];
const derived = sectionsOf(paper);
assert.deepStrictEqual(derived.sections.map((x) => x.name), ['Part A', 'Part B'],
  'sections come back in the order they appear in the paper');
assert.strictEqual(derived.sections[0].questionCount, 2);
assert.deepStrictEqual([derived.sections[0].firstOrder, derived.sections[0].lastOrder], [1, 2]);
assert.strictEqual(derived.sections[0].contiguous, true);
assert.strictEqual(derived.unsectionedCount, 1, 'a question with no section is counted, not dropped');

// A paper with no sections at all is not half-sectioned — it simply has none.
const plain = sectionsOf([{ questionOrder: 1, section: null }, { questionOrder: 2, section: null }]);
assert.deepStrictEqual(plain.sections, []);
assert.strictEqual(plain.unsectionedCount, 2);

// A section interrupted and resumed stays one section, and lastOrder follows.
const split = sectionsOf([
  { questionOrder: 1, section: 'A' },
  { questionOrder: 2, section: 'B' },
  { questionOrder: 3, section: 'A' },
]);
assert.strictEqual(split.sections.length, 2);
assert.strictEqual(split.sections.find((x) => x.name === 'A').questionCount, 2);
assert.strictEqual(split.sections.find((x) => x.name === 'A').lastOrder, 3);
assert.strictEqual(split.sections.find((x) => x.name === 'A').contiguous, false,
  'A runs 1 and 3 with B between them — the paper jumps back to a finished part');
assert.strictEqual(split.sections.find((x) => x.name === 'B').contiguous, true);

assert.deepStrictEqual(sectionsOf([]), { sections: [], unsectionedCount: 0 });


// ── the editor and the importer must agree ──

const full = {
  questionText: 'Q', questionImageUrl: null,
  optionA: 'a', optionAImageUrl: null, optionB: 'b', optionBImageUrl: null,
  optionC: 'c', optionCImageUrl: null, optionD: 'd', optionDImageUrl: null,
  correctOption: 'A',
};
assert.deepStrictEqual(questionProblems(full, 'A'), []);

// Image-only is valid on both doors — this is the rule that must not drift.
assert.deepStrictEqual(
  questionProblems({ ...full, questionText: null, questionImageUrl: 'https://x/y.svg' }, 'A'), [],
  'an image-only stem is as valid in the editor as it is in the CSV');
assert.deepStrictEqual(
  questionProblems({ ...full, optionA: null, optionAImageUrl: 'https://x/y.png' }, 'A'), []);

// Neither text nor image is the one thing an option may not be.
assert.strictEqual(questionProblems({ ...full, optionA: null }, 'A')[0].field, 'option_a');
assert.strictEqual(questionProblems({ ...full, questionText: null }, 'A')[0].field, 'question_text');
assert.strictEqual(questionProblems({ ...full, correctOption: 'E' }, 'E')[0].field, 'correct_option');
assert.strictEqual(questionProblems({ ...full, correctOption: null }, '')[0].field, 'correct_option');

console.log('test.test.js: all assertions passed');
