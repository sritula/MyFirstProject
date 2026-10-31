/**
 * Team Status Updates — Google Apps Script web app backed by a Google Sheet.
 *
 *   <web app URL>                 -> status update form (share with the team)
 *   <web app URL>?page=dashboard  -> responses table, charts, CSV export
 *
 * Data lives in this spreadsheet:
 *   "Updates" sheet — one row per submission
 *   "Team" sheet    — list of team member names (column A, header in row 1)
 */

const UPDATES_SHEET = 'Updates';
const TEAM_SHEET = 'Team';
const HEADERS = ['Timestamp', 'Name', 'Week Of', 'Done', 'Next', 'Blockers', 'Blocked', 'Confidence'];
const MAX_TEXT = 5000;

/** Serves the form or the dashboard. */
function doGet(e) {
  const page = e && e.parameter && e.parameter.page === 'dashboard' ? 'Dashboard' : 'Form';
  const template = HtmlService.createTemplateFromFile(page);
  template.appUrl = ScriptApp.getService().getUrl();
  template.dashKey = (e && e.parameter && e.parameter.key) || '';
  return template
    .evaluate()
    .setTitle(page === 'Dashboard' ? 'Team Status Dashboard' : 'Weekly Status Update')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Adds a menu to the spreadsheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Team Updates')
    .addItem('Set up sheets', 'setup')
    .addToUi();
}

/** Creates the Updates and Team sheets if they don't exist. Safe to run repeatedly. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let updates = ss.getSheetByName(UPDATES_SHEET);
  if (!updates) updates = ss.insertSheet(UPDATES_SHEET);
  if (updates.getLastRow() === 0) {
    updates.appendRow(HEADERS);
    updates.setFrozenRows(1);
    updates.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }

  let team = ss.getSheetByName(TEAM_SHEET);
  if (!team) team = ss.insertSheet(TEAM_SHEET);
  if (team.getLastRow() === 0) {
    team.appendRow(['Name']);
    team.getRange('A1').setFontWeight('bold');
    team.getRange('A2:A4').setValues([['Alex Example'], ['Sam Example'], ['Jordan Example']]);
    team.setFrozenRows(1);
  }
}

/** Returns the team member names from the Team sheet. */
function getTeam() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TEAM_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(String);
}

/** Validates and stores one status update. Called from Form.html. */
function submitUpdate(form) {
  const team = getTeam();
  const name = String(form.name || '').trim();
  if (!name) throw new Error('Please choose your name.');
  if (team.length && team.indexOf(name) === -1) throw new Error('Unknown team member: ' + name);

  const weekOf = String(form.weekOf || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) throw new Error('Please pick the week.');

  const done = clean_(form.done);
  const next = clean_(form.next);
  if (!done) throw new Error('Please fill in what you got done.');
  if (!next) throw new Error('Please fill in what you plan to do next.');
  const blockers = clean_(form.blockers);

  const confidence = Number(form.confidence);
  if (!(confidence >= 1 && confidence <= 5)) throw new Error('Please rate your confidence from 1 to 5.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss.getSheetByName(UPDATES_SHEET)) setup();
    ss.getSheetByName(UPDATES_SHEET).appendRow([
      new Date(), name, weekOf, done, next, blockers, blockers ? 'Yes' : 'No', confidence,
    ]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/**
 * Returns all updates plus the team list for the dashboard.
 * If the script property DASHBOARD_KEY is set, the caller must pass the same key.
 */
function getDashboardData(key) {
  const required = PropertiesService.getScriptProperties().getProperty('DASHBOARD_KEY');
  if (required && key !== required) throw new Error('This dashboard needs a valid ?key= in the link.');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UPDATES_SHEET);
  const rows = [];
  if (sheet && sheet.getLastRow() > 1) {
    const tz = Session.getScriptTimeZone();
    sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues().forEach(function (r) {
      if (!r[1]) return;
      rows.push({
        timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
        name: String(r[1]),
        weekOf: r[2] instanceof Date ? Utilities.formatDate(r[2], tz, 'yyyy-MM-dd') : String(r[2]),
        done: String(r[3]),
        next: String(r[4]),
        blockers: String(r[5]),
        blocked: String(r[6]) === 'Yes',
        confidence: Number(r[7]) || null,
      });
    });
  }
  return { rows: rows, team: getTeam() };
}

function clean_(v) {
  const s = String(v || '').trim().slice(0, MAX_TEXT);
  // Stop Sheets from treating free text as a formula.
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
