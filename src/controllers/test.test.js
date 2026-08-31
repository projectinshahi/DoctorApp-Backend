// CSV import validation. Run: node src/controllers/test.test.js
const assert = require('assert');
const { parseCsv } = require('../utils/csv');
const { validateRows } = require('./test.controller');

const TEST = { id: 1, totalQuestions: 2 };
const HEAD = 'question_order,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,subject,topic';

const KNOWN = new Set(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg']);

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
assert.strictEqual(foreign.questions[0].questionImageUrl, 'https://cdn.other/x.jpg',
  'the URL is kept — the admin was warned, not overruled');

// A typo in a known URL still warns, which is what makes it findable.
const typo = run(`${IHEAD}\n1,Q,https://cdn.test/a.jpeg,A,,B,C,D,A\n`, KNOWN);
assert(typo.errors.some((e) => e.severity === 'warning' && e.field === 'question_image_url'));

// Something that is not a URL at all IS a blocking error — it can never load,
// so importing it only defers the failure to a student.
const notUrl = run(`${IHEAD}\n1,Q,q3_xray.jpg,A,,B,C,D,A\n`, KNOWN);
assert(notUrl.errors.some((e) => e.severity !== 'warning' && e.field === 'question_image_url'),
  'a bare filename must be rejected');
assert.strictEqual(notUrl.questions[0].questionImageUrl, null);

// With no known-set supplied (nothing uploaded), URLs are not cross-checked but
// text-or-image still applies.
const noSet = run(`${IHEAD}\n1,Q,https://anything/x.jpg,A,,B,C,D,A\n`, null);
assert.deepStrictEqual(noSet.errors.filter((e) => e.severity !== 'warning'), []);

// Two image-only questions both have empty text; that must not trip the
// duplicate-text warning.
const twoImg = run(`${IHEAD}\n1,,https://cdn.test/a.jpg,A,,B,C,D,A\n2,,https://cdn.test/b.jpg,A,,B,C,D,B\n`, KNOWN);
assert.deepStrictEqual(twoImg.errors, [], 'empty text must not count as duplicate text');

console.log('test.test.js: all assertions passed');
