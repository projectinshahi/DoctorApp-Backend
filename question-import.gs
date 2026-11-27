/**
 * Question Bank importer — Google Sheet -> doctor-app backend.
 *
 * SETUP (once): Project Settings -> Script Properties
 *   API_BASE_URL    e.g. https://doctorapp-backend-30gd.onrender.com
 *   ADMIN_EMAIL     admin@yourapp.com
 *   ADMIN_PASSWORD  your admin password
 *
 * RUN ORDER
 *   1. checkBackendReady()      fails fast if the backend lacks the routes
 *   2. previewImport()          logs what would happen, writes no questions
 *   3. pushAllQuestionsToApi()  imports only rows that are not already there
 *
 * SAFE TO RE-RUN. Each row is matched in this order:
 *   1. the `question_id` column (V) the script writes back after every import
 *   2. failing that, (topicId + exact question_text)
 *   3. failing that, the row is created and its new id written to column V
 *
 * Because the id is the primary key, REWORDING a question now updates it
 * instead of creating a second copy. Do not hand-edit column V — a wrong id
 * overwrites the wrong question, and a blank one falls back to text matching.
 *
 * DELETING A ROW deactivates its question (status -> inactive) so it stops
 * being served. Set DEACTIVATE_ROWS_REMOVED_FROM_SHEET = false to disable.
 */

var AUTO_CREATE_TAXONOMY = true;   // create missing Subject/Topic from tab names
var SKIP_TABS = ['READ ME'];
var HEADER_ROWS = 1;
var PAUSE_MS = 150;

// Column positions (0-based), matching the sheet header row.
var COL = {
  questionText: 0, questionImageUrl: 1, difficulty: 2, marksCorrect: 3,
  marksIncorrect: 4, explanation: 5, tags: 6, status: 7,
  optionsStart: 8, optionCount: 6, correctOption: 20,
  questionId: 21,                  // column V — written by the script, do not edit
};

var ID_HEADER = 'question_id';

// A row removed from the sheet leaves its question behind in the bank, where it
// keeps being served. Deactivating rather than deleting keeps the answer key
// recoverable; set this to false to leave removed rows fully alone.
//
// WARNING: this treats the sheet as the single source of truth for every topic
// it touches. A question added straight in the admin panel has no sheet row, so
// the next import deactivates it. Add questions in the sheet, or set this false.
var DEACTIVATE_ROWS_REMOVED_FROM_SHEET = true;

var VALID_DIFFICULTY = ['easy', 'medium', 'hard'];
var VALID_STATUS = ['active', 'inactive'];

// ─────────────────────────── config / auth ───────────────────────────

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var cfg = {
    baseUrl: (props.getProperty('API_BASE_URL') || '').replace(/\/+$/, ''),
    email: props.getProperty('ADMIN_EMAIL'),
    password: props.getProperty('ADMIN_PASSWORD'),
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.password) {
    throw new Error('Missing Script Properties: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD.');
  }
  return cfg;
}

function getFreshAdminToken(cfg) {
  var res = fetchJson(cfg.baseUrl + '/api/auth/admin/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!res.token) throw new Error('Login returned no token: ' + JSON.stringify(res));
  return res.token;
}

/**
 * Retries ONLY on 5xx / network trouble (Render cold start). A 4xx is
 * permanent — fail immediately rather than waiting out a retry for the same
 * answer.
 */
function fetchJson(url, options) {
  options = options || {};
  options.muteHttpExceptions = true;

  var attempts = 0;
  var lastError = '';

  while (attempts < 2) {
    attempts++;
    var response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastError = 'Network error: ' + e;
      if (attempts < 2) { Utilities.sleep(1500); continue; }
      break;
    }

    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code >= 200 && code < 300) {
      try { return body ? JSON.parse(body) : {}; }
      catch (e) { throw new Error('Non-JSON success from ' + url + ': ' + body.slice(0, 300)); }
    }

    if (code >= 400 && code < 500) {
      // httpCode rides along so callers can branch — a PUT to a question_id
      // that was deleted server-side must fall back to creating, not abort.
      var clientError = new Error(url + ' failed (' + code + '): ' + extractError(body));
      clientError.httpCode = code;
      throw clientError;
    }

    lastError = url + ' failed (' + code + '): ' + extractError(body);
    if (attempts < 2) { Logger.log('Server error, retrying in 1.5s...'); Utilities.sleep(1500); }
  }
  throw new Error(lastError);
}

// The backend always shapes errors as { error: { message } }.
function extractError(body) {
  try {
    var parsed = JSON.parse(body);
    if (parsed && parsed.error && parsed.error.message) return parsed.error.message;
    return body.slice(0, 300);
  } catch (e) {
    return body.slice(0, 300);   // HTML 404 page etc.
  }
}

function authOptions(token, method, payload) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + token }, contentType: 'application/json' };
  if (payload !== undefined) opts.payload = JSON.stringify(payload);
  return opts;
}

function normalise(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

// ─────────────────────────── taxonomy ───────────────────────────

function fetchExistingTaxonomy(cfg, token) {
  var subjectsRes = fetchJson(cfg.baseUrl + '/api/subjects', authOptions(token, 'get'));
  var lookup = {};
  (subjectsRes.subjects || []).forEach(function (subject) {
    var topicsRes = fetchJson(cfg.baseUrl + '/api/subjects/' + subject.id + '/topics', authOptions(token, 'get'));
    var topics = {};
    (topicsRes.topics || []).forEach(function (t) { topics[normalise(t.name)] = t.id; });
    lookup[normalise(subject.name)] = { id: subject.id, name: subject.name, topics: topics };
  });
  return lookup;
}

function buildTaxonomyLookup(cfg, token, pairs) {
  var lookup = fetchExistingTaxonomy(cfg, token);

  pairs.forEach(function (pair) {
    var sKey = normalise(pair.subjectName);
    var tKey = normalise(pair.topicName);

    if (!lookup[sKey]) {
      if (!AUTO_CREATE_TAXONOMY) { Logger.log('WARNING: unresolved subject "' + pair.subjectName + '"'); return; }
      var created = fetchJson(cfg.baseUrl + '/api/subjects', authOptions(token, 'post', { name: pair.subjectName }));
      lookup[sKey] = { id: created.subject.id, name: created.subject.name, topics: {} };
      Logger.log('Created subject "' + pair.subjectName + '" -> ' + created.subject.id);
    }

    var subject = lookup[sKey];
    if (!subject.topics[tKey]) {
      if (!AUTO_CREATE_TAXONOMY) { Logger.log('WARNING: unresolved topic "' + pair.topicName + '"'); return; }
      var t = fetchJson(cfg.baseUrl + '/api/subjects/' + subject.id + '/topics', authOptions(token, 'post', { name: pair.topicName }));
      subject.topics[tKey] = t.topic.id;
      Logger.log('Created topic "' + pair.topicName + '" -> ' + t.topic.id);
    }
  });

  return lookup;
}

/**
 * Every question already in the bank, keyed "topicId::questionText".
 * This is what makes the import re-runnable — an already-imported row is
 * skipped instead of creating a second copy.
 */
function fetchExistingQuestionKeys(cfg, token) {
  var keys = {};
  var page = 1;
  for (;;) {
    var res = fetchJson(cfg.baseUrl + '/api/questions?page=' + page + '&limit=100', authOptions(token, 'get'));
    (res.questions || []).forEach(function (q) { keys[q.topicId + '::' + q.questionText] = q.id; });
    var pg = res.pagination;
    if (!pg || page >= pg.totalPages) break;
    page++;
  }
  return keys;
}

// ─────────────────────────── sheet -> payload ───────────────────────────

function parseTabName(tabName) {
  var parts = String(tabName).split(' - ');
  if (parts.length < 2) return null;
  return { subjectName: parts[0].trim(), topicName: parts.slice(1).join(' - ').trim() };
}

/**
 * The write-back column. Rows are matched on this id first, so rewording a
 * question updates it instead of creating a second copy. Created on demand at
 * column V, past the last option column, so it disturbs no existing formula.
 */
function ensureIdColumn(sheet) {
  var header = sheet.getRange(1, COL.questionId + 1).getValue();
  if (String(header).trim() !== ID_HEADER) {
    sheet.getRange(1, COL.questionId + 1).setValue(ID_HEADER);
  }
}

/** The id a row already claims, or null. Blank/garbage reads as "no id". */
function readRowId(row) {
  var raw = String(row[COL.questionId] == null ? '' : row[COL.questionId]).trim();
  var id = parseInt(raw, 10);
  return id > 0 ? id : null;
}

/** One batched write per tab — setValue per row would blow the 6-minute quota. */
function writeIdColumn(sheet, idsByRowIndex) {
  var rows = Object.keys(idsByRowIndex);
  if (!rows.length) return;

  var last = sheet.getLastRow();
  var current = sheet.getRange(1, COL.questionId + 1, last, 1).getValues();
  rows.forEach(function (r) { current[Number(r)][0] = idsByRowIndex[r]; });
  sheet.getRange(1, COL.questionId + 1, last, 1).setValues(current);
}

function dataSheets() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (sheet) {
    return SKIP_TABS.indexOf(sheet.getName()) === -1 && parseTabName(sheet.getName()) !== null;
  });
}

function buildAllQuestionPayloads(lookup) {
  var payloads = [];
  var problems = [];
  var topicIds = {};

  dataSheets().forEach(function (sheet) {
    var pair = parseTabName(sheet.getName());
    var subject = lookup[normalise(pair.subjectName)];
    var topicId = subject ? subject.topics[normalise(pair.topicName)] : null;

    if (!subject || !topicId) {
      problems.push(sheet.getName() + ': unresolved subject/topic');
      return;
    }
    topicIds[topicId] = true;
    ensureIdColumn(sheet);

    var values = sheet.getDataRange().getValues();
    for (var r = HEADER_ROWS; r < values.length; r++) {
      if (!String(values[r][COL.questionText] || '').trim()) continue;   // blank row
      var built = buildQuestionPayload(values[r], subject.id, topicId, sheet.getName() + ' row ' + (r + 1));
      if (built.error) problems.push(built.error);
      else payloads.push({
        where: sheet.getName() + ' row ' + (r + 1),
        body: built.body,
        sheet: sheet,
        rowIndex: r,
        sheetId: readRowId(values[r]),
      });
    }
  });

  return { payloads: payloads, problems: problems, topicIds: Object.keys(topicIds).map(Number) };
}

function buildQuestionPayload(row, subjectId, topicId, where) {
  var difficulty = normalise(row[COL.difficulty]);
  if (VALID_DIFFICULTY.indexOf(difficulty) === -1) {
    return { error: where + ': difficulty must be easy/medium/hard, got "' + row[COL.difficulty] + '"' };
  }

  var status = normalise(row[COL.status]) || 'active';
  if (VALID_STATUS.indexOf(status) === -1) {
    return { error: where + ': status must be active/inactive, got "' + row[COL.status] + '"' };
  }

  var marksCorrect = Number(row[COL.marksCorrect]);
  if (!isFinite(marksCorrect)) return { error: where + ': marks_correct must be a number' };

  var miRaw = String(row[COL.marksIncorrect] == null ? '' : row[COL.marksIncorrect]).trim();
  var marksIncorrect = miRaw === '' ? 0 : Number(miRaw);
  if (!isFinite(marksIncorrect)) return { error: where + ': marks_incorrect must be a number' };

  var correctIndex = Number(row[COL.correctOption]);
  if (!correctIndex || correctIndex < 1 || correctIndex > COL.optionCount) {
    return { error: where + ': correct_option must be 1..' + COL.optionCount + ', got "' + row[COL.correctOption] + '"' };
  }

  var options = [];
  for (var i = 0; i < COL.optionCount; i++) {
    var text = String(row[COL.optionsStart + i * 2] || '').trim();
    var image = String(row[COL.optionsStart + i * 2 + 1] || '').trim();
    if (!text) continue;
    options.push({
      optionText: text,
      optionImageUrl: image || null,
      isCorrect: (i + 1) === correctIndex,
      displayOrder: options.length,
    });
  }

  if (options.length < 2) return { error: where + ': needs at least 2 options, found ' + options.length };
  if (options.filter(function (o) { return o.isCorrect; }).length !== 1) {
    return { error: where + ': correct_option ' + correctIndex + ' points at an empty option column' };
  }

  var tags = [];
  String(row[COL.tags] || '').split(',').forEach(function (raw) {
    var tag = raw.trim();
    if (tag && tags.indexOf(tag) === -1) tags.push(tag);
  });

  return {
    body: {
      subjectId: subjectId,
      topicId: topicId,
      questionText: String(row[COL.questionText]).trim(),
      questionImageUrl: String(row[COL.questionImageUrl] || '').trim() || null,
      difficulty: difficulty,
      marksCorrect: marksCorrect,
      marksIncorrect: marksIncorrect,
      explanation: String(row[COL.explanation] || '').trim() || null,
      status: status,
      options: options,
      tags: tags,
    },
  };
}

// ─────────────────────────── entry points ───────────────────────────

/** Fails fast if the backend does not have the routes this script needs. */
function checkBackendReady() {
  var cfg = getConfig();
  var token = getFreshAdminToken(cfg);
  Logger.log('Login OK against ' + cfg.baseUrl);

  var subjects = fetchJson(cfg.baseUrl + '/api/subjects', authOptions(token, 'get'));
  Logger.log('GET /api/subjects OK — ' + (subjects.subjects || []).length + ' subject(s)');

  if ((subjects.subjects || []).length) {
    var id = subjects.subjects[0].id;
    fetchJson(cfg.baseUrl + '/api/subjects/' + id + '/topics', authOptions(token, 'get'));
    Logger.log('GET /api/subjects/:id/topics OK');
  }
  fetchJson(cfg.baseUrl + '/api/questions?limit=1', authOptions(token, 'get'));
  Logger.log('GET /api/questions OK — backend is ready.');
}

/** Safe: builds everything and logs it. Writes no questions. */
function previewImport() {
  var cfg = getConfig();
  var token = getFreshAdminToken(cfg);

  var pairs = dataSheets().map(function (s) { return parseTabName(s.getName()); });
  var lookup = buildTaxonomyLookup(cfg, token, pairs);
  var built = buildAllQuestionPayloads(lookup);
  var existing = fetchExistingQuestionKeys(cfg, token);

  var isNew = 0, byId = 0, byText = 0;
  var claimed = {};

  built.payloads.forEach(function (item) {
    var targetId = item.sheetId || existing[item.body.topicId + '::' + item.body.questionText] || null;
    if (!targetId) {
      isNew++;
      Logger.log('WOULD CREATE  ' + item.where + '  ' + item.body.questionText.slice(0, 60));
      return;
    }
    claimed[targetId] = true;
    if (item.sheetId) byId++; else byText++;
  });

  var stale = [];
  Object.keys(existing).forEach(function (key) {
    var id = existing[key];
    var topicId = Number(key.split('::')[0]);
    if (built.topicIds.indexOf(topicId) !== -1 && !claimed[id]) stale.push(key);
  });

  Logger.log('--------------------------------------------');
  Logger.log('Rows in sheet     : ' + built.payloads.length);
  Logger.log('Matched by id     : ' + byId + '   (survives rewording)');
  Logger.log('Matched by text   : ' + byText + '   (will gain an id on the next push)');
  Logger.log('Would create      : ' + isNew);
  if (stale.length) {
    Logger.log('NO LONGER IN SHEET (' + stale.length + ') — would be deactivated:');
    stale.forEach(function (k) { Logger.log('   #' + existing[k] + '  ' + k.split('::')[1].slice(0, 60)); });
  }
  if (built.problems.length) {
    Logger.log('PROBLEMS (' + built.problems.length + ') — these rows will be skipped:');
    built.problems.forEach(function (p) { Logger.log('   ' + p); });
  }
  return built;
}

/** Writes: creates new questions and updates ones already in the bank. */
function pushAllQuestionsToApi() {
  var cfg = getConfig();
  var token = getFreshAdminToken(cfg);

  var pairs = dataSheets().map(function (s) { return parseTabName(s.getName()); });
  var lookup = buildTaxonomyLookup(cfg, token, pairs);
  var built = buildAllQuestionPayloads(lookup);

  if (built.problems.length) {
    built.problems.forEach(function (p) { Logger.log('PROBLEM: ' + p); });
    throw new Error('Refusing to import: ' + built.problems.length + ' bad row(s). Fix them, then re-run.');
  }

  var existing = fetchExistingQuestionKeys(cfg, token);
  Logger.log('Already in the bank: ' + Object.keys(existing).length + ' question(s)');

  var created = 0, updated = 0;
  var failures = [];
  var claimed = {};                 // question ids the sheet still accounts for
  var pendingIdWrites = [];         // [sheet, {rowIndex: id}] batched per tab

  built.payloads.forEach(function (item) {
    var key = item.body.topicId + '::' + item.body.questionText;
    // Id first: it survives rewording, which the text key does not.
    var targetId = item.sheetId || existing[key] || null;

    try {
      var landedId = targetId
        ? putOrCreate(cfg, token, targetId, item)
        : createQuestion(cfg, token, item);

      if (landedId.created) created++; else updated++;
      Logger.log((landedId.created ? 'NEW  ' : 'UPD  ') + item.where + '  -> question id ' + landedId.id);

      existing[key] = landedId.id;
      claimed[landedId.id] = true;
      if (item.sheetId !== landedId.id) pendingIdWrites.push([item.sheet, item.rowIndex, landedId.id]);
    } catch (e) {
      var reason = item.where + ' threw: ' + e;
      Logger.log(reason);
      failures.push(reason);
    }
    Utilities.sleep(PAUSE_MS);
  });

  flushIdWrites(pendingIdWrites);

  var deactivated = DEACTIVATE_ROWS_REMOVED_FROM_SHEET
    ? deactivateUnclaimed(cfg, token, built.topicIds, claimed)
    : [];

  Logger.log('--------------------------------------------');
  Logger.log('New: ' + created + '   Updated: ' + updated + '   Failed: ' + failures.length);
  Logger.log('Ids written back: ' + pendingIdWrites.length);
  if (deactivated.length) {
    Logger.log('Deactivated (row no longer in the sheet): ' + deactivated.length);
    deactivated.forEach(function (d) { Logger.log('   #' + d.id + '  ' + d.questionText.slice(0, 60)); });
  }
  failures.forEach(function (f) { Logger.log('   ' + f); });
}

/** PUT, falling back to POST when the id points at a question since deleted. */
function putOrCreate(cfg, token, id, item) {
  try {
    fetchJson(cfg.baseUrl + '/api/questions/' + id, authOptions(token, 'put', item.body));
    return { id: id, created: false };
  } catch (e) {
    if (e.httpCode !== 404) throw e;
    Logger.log('   id ' + id + ' no longer exists — creating a replacement');
    return createQuestion(cfg, token, item);
  }
}

function createQuestion(cfg, token, item) {
  var res = fetchJson(cfg.baseUrl + '/api/questions', authOptions(token, 'post', item.body));
  return { id: res.question.id, created: true };
}

/** Group the writes by tab so each sheet takes one setValues call. */
function flushIdWrites(pending) {
  var bySheet = [];
  pending.forEach(function (entry) {
    var match = null;
    for (var i = 0; i < bySheet.length; i++) {
      if (bySheet[i].sheet.getSheetId() === entry[0].getSheetId()) { match = bySheet[i]; break; }
    }
    if (!match) { match = { sheet: entry[0], ids: {} }; bySheet.push(match); }
    match.ids[entry[1]] = entry[2];
  });
  bySheet.forEach(function (group) { writeIdColumn(group.sheet, group.ids); });
}

/**
 * Questions in the imported topics that no sheet row claims any more — i.e. the
 * row was deleted. Left alone they keep being served to students, which is the
 * bug this whole id column exists to close.
 */
function deactivateUnclaimed(cfg, token, topicIds, claimed) {
  if (!topicIds.length) return [];

  var stale = [];
  var page = 1;
  for (;;) {
    var res = fetchJson(cfg.baseUrl + '/api/questions?page=' + page + '&limit=100', authOptions(token, 'get'));
    (res.questions || []).forEach(function (q) {
      if (topicIds.indexOf(q.topicId) !== -1 && !claimed[q.id] && q.status === 'active') stale.push(q);
    });
    var pg = res.pagination;
    if (!pg || page >= pg.totalPages) break;
    page++;
  }

  stale.forEach(function (q) {
    fetchJson(cfg.baseUrl + '/api/questions/' + q.id + '/status',
      authOptions(token, 'patch', { status: 'inactive' }));
    Utilities.sleep(PAUSE_MS);
  });
  return stale;
}
