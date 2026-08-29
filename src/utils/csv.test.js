// Run: node src/utils/csv.test.js
const assert = require('assert');
const { parseCsv, toObject } = require('./csv');

// The case that makes splitting on "," wrong: a comma inside a quoted stem.
const withComma = parseCsv('a,b\n"A 60-year-old man, previously well",B\n');
assert.deepStrictEqual(withComma.header, ['a', 'b']);
assert.deepStrictEqual(withComma.rows[0].values, ['A 60-year-old man, previously well', 'B']);

// Escaped quotes.
assert.deepStrictEqual(parseCsv('a\n"He said ""no"""\n').rows[0].values, ['He said "no"']);

// A newline inside quotes belongs to the field, and must not end the record —
// but the NEXT row's reported line number has to account for it.
const multiline = parseCsv('a,b\n"line one\nline two",x\ny,z\n');
assert.strictEqual(multiline.rows.length, 2);
assert.deepStrictEqual(multiline.rows[0].values, ['line one\nline two', 'x']);
assert.strictEqual(multiline.rows[1].line, 4, 'row after a multiline field reports its real file line');

// CRLF from Windows/Excel must not leave \r on the last field of every row.
assert.deepStrictEqual(parseCsv('a,b\r\n1,2\r\n').rows[0].values, ['1', '2']);

// A BOM would otherwise make the first column name unmatchable.
assert.deepStrictEqual(parseCsv('﻿question_order,x\n1,2\n').header, ['question_order', 'x']);

// Header is lowercased and trimmed, so " Question_Order " still matches.
assert.deepStrictEqual(parseCsv(' Question_Order , X \n1,2\n').header, ['question_order', 'x']);

// A trailing newline is not an empty row; a file without one still yields its
// last row. Both are how real exports differ.
assert.strictEqual(parseCsv('a\n1\n').rows.length, 1);
assert.strictEqual(parseCsv('a\n1').rows.length, 1);
assert.strictEqual(parseCsv('').rows.length, 0);

// Short rows pad rather than throwing — the validator reports the empty field.
assert.strictEqual(toObject(['a', 'b', 'c'], ['1', '2']).c, '');

// Line numbers are 1-based and point at the physical line, so row 1 of data is
// line 2 of the file.
assert.strictEqual(parseCsv('a\n1\n2\n').rows[1].line, 3);

console.log('csv.test.js: all assertions passed');
