// A small RFC 4180 parser.
//
// Hand-rolled rather than pulling in csv-parse: the import needs the physical
// line number of every problem so an admin can fix row 147 of their file, and
// splitting on commas would corrupt any question text containing one — which
// medical stems routinely do ("A 60-year-old man, previously well, ...").
//
// Handles quoted fields, escaped quotes (""), commas and newlines inside
// quotes, and both CRLF and LF line endings.

/**
 * @returns {{ header: string[], rows: Array<{ line: number, values: string[] }> }}
 */
function parseCsv(text) {
  // A BOM from Excel would otherwise become part of the first column's name,
  // so "question_order" silently stops matching.
  const input = text.replace(/^﻿/, '');

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => {
    endField();
    // A trailing newline produces one empty field, not a row.
    if (!(record.length === 1 && record[0].trim() === '')) {
      records.push({ line: recordStartLine, values: record });
    }
    record = [];
    recordStartLine = line + 1;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote, not the end of it.
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { endField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { endRecord(); line += 1; continue; }
    field += char;
  }

  // A file with no trailing newline still has one last record to flush.
  if (field !== '' || record.length > 0) endRecord();

  if (records.length === 0) return { header: [], rows: [] };

  const header = records[0].values.map((h) => h.trim().toLowerCase());
  return { header, rows: records.slice(1) };
}

/** Maps a row's values onto the header, so callers read by column name. */
function toObject(header, values) {
  const out = {};
  header.forEach((name, index) => {
    out[name] = values[index] === undefined ? '' : values[index].trim();
  });
  return out;
}

module.exports = { parseCsv, toObject };
