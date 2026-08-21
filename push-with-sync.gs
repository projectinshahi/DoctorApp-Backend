/**
 * DROP-IN REPLACEMENT for pushAllQuestionsToApi() in your Code.gs.
 *
 * Keeps everything else in your file as-is: getConfig, fetchJson,
 * getFreshAdminToken, buildTaxonomyLookup, COLS, buildAllQuestionPayloads.
 * Delete your existing pushAllQuestionsToApi and paste this whole file in.
 *
 * WHAT CHANGES
 *   Column V used to hold the word "IMPORTED". It now holds the question's
 *   id. That one change is what makes edits and deletions work:
 *
 *     "IMPORTED"  =  "this row is done"        -> an edited row is skipped
 *     12          =  "this row IS question 12" -> an edited row is updated
 *
 *   Rows still in the sheet  -> updated in place (PUT), never duplicated
 *   Rows removed from the sheet -> deactivated, so they stop being served
 *
 * Old "IMPORTED" markers are handled: a row with one falls back to matching
 * on question text, then gets its real id written over the top. You do not
 * need to clear column V by hand.
 */

// Deleting is not recoverable, so removed rows are deactivated instead.
// Set to true only if you want them gone permanently.
const DELETE_REMOVED_ROWS = false;

/** Every question already in the bank, keyed "topicId::questionText" -> id. */
function fetchExistingQuestionIds(config, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const byText = {};
  const byId = {};

  let page = 1;
  for (;;) {
    const { body } = fetchJson(
      `${config.apiBaseUrl}/api/questions?page=${page}&limit=100`,
      { method: 'get', headers, muteHttpExceptions: true }
    );
    (body.questions || []).forEach(q => {
      byText[`${q.topicId}::${q.questionText}`] = q.id;
      byId[q.id] = { topicId: q.topicId, status: q.status, questionText: q.questionText };
    });
    const pg = body.pagination;
    if (!pg || page >= pg.totalPages) break;
    page++;
  }
  return { byText, byId };
}

/** Builds the request body for one sheet row. Same field mapping you had. */
function buildBodyFromRow(row, ids) {
  const options = [];
  for (let optIndex = 0; optIndex < 6; optIndex++) {
    const textCol = COLS.tags + 2 + optIndex * 2;
    const text = row[textCol];
    const imageUrl = row[textCol + 1];
    if (text) {
      options.push({
        optionText: String(text),
        optionImageUrl: imageUrl || null,
        isCorrect: (optIndex + 1) === Number(row[COLS.correctOption]),
      });
    }
  }

  const tagsRaw = row[COLS.tags];
  const tags = tagsRaw ? String(tagsRaw).split(',').map(t => t.trim()).filter(Boolean) : [];

  return {
    subjectId: ids.subjectId,
    topicId: ids.topicId,
    questionText: String(row[COLS.questionText]),
    questionImageUrl: row[COLS.questionImageUrl] || null,
    difficulty: String(row[COLS.difficulty] || 'easy'),
    marksCorrect: Number(row[COLS.marksCorrect]) || 0,
    marksIncorrect: Number(row[COLS.marksIncorrect]) || 0,
    explanation: row[COLS.explanation] || null,
    tags,
    status: String(row[COLS.status] || 'active'),
    options,
  };
}

/**
 * Sends every sheet row, then removes anything the sheet no longer has.
 * Safe to run as often as you like.
 */
function pushAllQuestionsToApi() {
  const config = getConfig();
  const token = getFreshAdminToken(config);
  const lookup = buildTaxonomyLookup(config, token);
  const existing = fetchExistingQuestionIds(config, token);

  const headers = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { Authorization: `Bearer ${token}` };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().filter(s => s.getName() !== 'READ ME');

  const ID_COL = COLS.correctOption + 1;   // column V, 0-based
  let created = 0, updated = 0, failCount = 0;
  const failures = [];
  const claimedIds = {};      // question ids the sheet still accounts for
  const touchedTopics = {};   // only prune topics this run actually covered

  sheets.forEach(sheet => {
    const tabName = sheet.getName();
    const [subjectName, topicName] = tabName.split(' - ').map(s => (s || '').trim());
    if (!subjectName || !topicName) return;

    const ids = lookup[`${subjectName}|${topicName}`];
    if (!ids) return;
    touchedTopics[ids.topicId] = true;

    // Make sure the header says what the column is, now that it holds ids.
    sheet.getRange(1, ID_COL + 1).setValue('question_id');

    const data = sheet.getDataRange().getValues();

    for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      if (!row[COLS.questionText]) continue;

      const body = buildBodyFromRow(row, ids);
      const where = `Tab "${tabName}" row ${rowIndex + 1}`;

      // Column V may hold a real id, the legacy word "IMPORTED", or nothing.
      // Only a number is trusted; anything else falls back to text matching.
      const marker = Number(row[ID_COL]);
      let targetId = marker > 0 ? marker : (existing.byText[`${ids.topicId}::${body.questionText}`] || null);

      try {
        let landedId = null;

        if (targetId) {
          const res = fetchJson(`${config.apiBaseUrl}/api/questions/${targetId}`, {
            method: 'put', contentType: 'application/json', headers: jsonHeaders,
            payload: JSON.stringify(body), muteHttpExceptions: true,
          });
          if (res.code === 200) {
            landedId = targetId;
            updated++;
          } else if (res.code === 404) {
            targetId = null;          // id is stale, fall through and create
          } else {
            throw new Error(`PUT ${res.code}: ${JSON.stringify(res.body)}`);
          }
        }

        if (!landedId && !targetId) {
          const res = fetchJson(`${config.apiBaseUrl}/api/questions`, {
            method: 'post', contentType: 'application/json', headers: jsonHeaders,
            payload: JSON.stringify(body), muteHttpExceptions: true,
          });
          if (res.code !== 200 && res.code !== 201) {
            throw new Error(`POST ${res.code}: ${JSON.stringify(res.body)}`);
          }
          landedId = res.body.question.id;
          created++;
        }

        claimedIds[landedId] = true;
        // Write the id back so the next run recognises this row instantly.
        if (Number(row[ID_COL]) !== landedId) {
          sheet.getRange(rowIndex + 1, ID_COL + 1).setValue(landedId);
        }
      } catch (e) {
        failCount++;
        failures.push(`${where} — ${e}`);
        Logger.log(`FAIL ${where} — ${e}`);
      }

      Utilities.sleep(150);
    }
  });

  // ── Anything in these topics the sheet no longer claims was deleted ──
  const removed = [];
  Object.keys(existing.byId).forEach(idStr => {
    const id = Number(idStr);
    const q = existing.byId[id];
    if (!touchedTopics[q.topicId]) return;   // topic not in this run, leave alone
    if (claimedIds[id]) return;              // still in the sheet
    if (!DELETE_REMOVED_ROWS && q.status === 'inactive') return;  // already hidden
    removed.push({ id, questionText: q.questionText });
  });

  // One bulk call, not one per question. Apps Script kills a run at 6 minutes
  // and each round trip to a free-tier backend costs seconds — deactivating 30
  // questions one at a time is what makes a run die half-finished, leaving the
  // sheet's rows imported but the stale ones still live.
  if (removed.length && !DELETE_REMOVED_ROWS) {
    const res = fetchJson(`${config.apiBaseUrl}/api/questions/bulk-status`, {
      method: 'patch', contentType: 'application/json', headers,
      payload: JSON.stringify({ questionIds: removed.map(q => q.id), status: 'inactive' }),
      muteHttpExceptions: true,
    });
    Logger.log(`HIDDEN ${res.code === 200 ? res.body.updated : 0} question(s) (${res.code})`);
    removed.forEach(q => Logger.log(`   #${q.id}  ${String(q.questionText).slice(0, 50)}`));
  } else if (removed.length) {
    // Delete has no bulk endpoint, so this path stays one-by-one and can run long.
    removed.forEach(q => {
      const res = fetchJson(`${config.apiBaseUrl}/api/questions/${q.id}`, {
        method: 'delete', headers, muteHttpExceptions: true,
      });
      Logger.log(`DELETED #${q.id} (${res.code}) ${String(q.questionText).slice(0, 50)}`);
      Utilities.sleep(150);
    });
  }

  Logger.log('--------------------------------------------');
  Logger.log(`Created: ${created}   Updated: ${updated}   Failed: ${failCount}`);
  Logger.log(`No longer in the sheet: ${removed.length}`);
  if (failures.length) {
    Logger.log('--- Failures ---');
    failures.forEach(f => Logger.log(f));
  }
}

/**
 * SAFE: reports exactly what pushAllQuestionsToApi would do. Writes nothing,
 * neither to the sheet nor to the database. Run this first.
 */
function previewSync() {
  const config = getConfig();
  const token = getFreshAdminToken(config);
  const lookup = buildTaxonomyLookup(config, token);
  const existing = fetchExistingQuestionIds(config, token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().filter(s => s.getName() !== 'READ ME');
  const ID_COL = COLS.correctOption + 1;

  let willCreate = 0, willUpdate = 0;
  const claimedIds = {}, touchedTopics = {};

  sheets.forEach(sheet => {
    const [subjectName, topicName] = sheet.getName().split(' - ').map(s => (s || '').trim());
    if (!subjectName || !topicName) return;
    const ids = lookup[`${subjectName}|${topicName}`];
    if (!ids) return;
    touchedTopics[ids.topicId] = true;

    const data = sheet.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row[COLS.questionText]) continue;

      const marker = Number(row[ID_COL]);
      const targetId = marker > 0
        ? marker
        : (existing.byText[`${ids.topicId}::${String(row[COLS.questionText])}`] || null);

      if (targetId) { claimedIds[targetId] = true; willUpdate++; }
      else { willCreate++; Logger.log(`WOULD CREATE  ${sheet.getName()} row ${r + 1}`); }
    }
  });

  const removed = Object.keys(existing.byId)
    .map(Number)
    .filter(id => touchedTopics[existing.byId[id].topicId]
               && !claimedIds[id]
               && existing.byId[id].status === 'active');

  Logger.log('--------------------------------------------');
  Logger.log(`Would update : ${willUpdate}`);
  Logger.log(`Would create : ${willCreate}`);
  Logger.log(`Would hide   : ${removed.length}   (in the database, not in the sheet)`);
  removed.forEach(id => Logger.log(`   #${id}  ${String(existing.byId[id].questionText).slice(0, 60)}`));
}
