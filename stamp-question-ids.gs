/**
 * ONE-TIME BOOTSTRAP - stamp existing question ids into the sheet.
 *
 * Run this ONCE, then never again. It writes the "question_id" header into
 * column V of every question tab and fills in the id of each row that is
 * already in the database.
 *
 * It makes NO network calls, so it works even while the backend is not
 * deployed - unlike question-import.gs, which needs the API.
 *
 * HOW TO RUN
 *   Extensions > Apps Script > paste as a new file > pick "stampQuestionIds"
 *   in the Run dropdown (NOT another function) > Run > View > Logs.
 *
 * After this, question-import.gs matches rows on the id, so rewording a
 * question updates it instead of creating a duplicate.
 *
 * Generated 2026-08-20 from the live database - 26 row(s).
 */

var ID_COLUMN = 22;          // column V, 1-based
var ID_HEADER = 'question_id';

// tab name -> { sheet row number : question id }
var ID_MAP = {
  "Dermatology - General": { '2': 25 },
  "ENT - General": { '2': 26 },
  "Gen Surg - Breast & Endocrine": { '2': 20 },
  "Gen Surg - GI & Colorectal": { '2': 18 },
  "Gen Surg - GU Surgery": { '2': 22 },
  "Gen Surg - HPB Surgery": { '2': 19 },
  "Gen Surg - Trauma & Emergency": { '2': 23 },
  "Gen Surg - Vascular Surgery": { '2': 21 },
  "Internal Med - Cardiology": { '2': 2, '3': 3 },
  "Internal Med - Emergency Care": { '2': 14 },
  "Internal Med - Endocrinology": { '2': 10 },
  "Internal Med - GI & Hepatology": { '2': 6, '3': 7 },
  "Internal Med - Hematology": { '2': 13 },
  "Internal Med - Infectious Dis": { '2': 12 },
  "Internal Med - Nephrology": { '2': 8 },
  "Internal Med - Neurology": { '2': 9 },
  "Internal Med - Pulmonology": { '2': 5, '3': 28 },
  "Internal Med - Rheumatology": { '2': 11 },
  "OBGYN - Gynaecology": { '2': 17 },
  "OBGYN - Obstetrics": { '2': 15, '3': 16 },
  "Ophthalmology - General": { '2': 27 },
  "Pediatrics - General": { '2': 24 },
};

function stampQuestionIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stamped = 0, skipped = 0, missingTabs = [];

  Object.keys(ID_MAP).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) { missingTabs.push(tabName); return; }

    sheet.getRange(1, ID_COLUMN).setValue(ID_HEADER);

    var rowIds = ID_MAP[tabName];
    Object.keys(rowIds).forEach(function (rowNumber) {
      var cell = sheet.getRange(Number(rowNumber), ID_COLUMN);
      // Never overwrite an id that is already there - a re-run must be a no-op.
      if (String(cell.getValue()).trim()) { skipped++; return; }
      cell.setValue(rowIds[rowNumber]);
      stamped++;
    });
  });

  Logger.log('--------------------------------------------');
  Logger.log('Stamped : ' + stamped + ' row(s)');
  Logger.log('Skipped : ' + skipped + ' (already had an id)');
  if (missingTabs.length) {
    Logger.log('TABS NOT FOUND (renamed since this was generated?):');
    missingTabs.forEach(function (t) { Logger.log('   ' + t); });
  }
  Logger.log('Done. Do not run this again - question-import.gs maintains column V from now on.');
}
