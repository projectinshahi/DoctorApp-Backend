// CSV import validation. Run: node src/controllers/test.test.js
const assert = require('assert');
const { parseCsv } = require('../utils/csv');
const { validateRows } = require('./test.controller');

const TEST = { id: 1, totalQuestions: 2 };
const HEAD = 'question_order,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,subject,topic';

function run(csv) {
  const { header, rows } = parseCsv(csv);
  return validateRows(header, rows, TEST);
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

console.log('test.test.js: all assertions passed');
