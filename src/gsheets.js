'use strict';
/** Google Sheets client (service account) + tab bootstrap. */

const { google } = require('googleapis');
const CFG = require('./config');

let _auth = null, _sheets = null;

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send'
];

function auth() {
  if (_auth) return _auth;
  // Option B: OAuth client + refresh token (acts as the owner's own Google account)
  if (CFG.GOOGLE_OAUTH_CLIENT_ID && CFG.GOOGLE_OAUTH_CLIENT_SECRET && CFG.GOOGLE_OAUTH_REFRESH_TOKEN) {
    const o = new google.auth.OAuth2(CFG.GOOGLE_OAUTH_CLIENT_ID, CFG.GOOGLE_OAUTH_CLIENT_SECRET);
    o.setCredentials({ refresh_token: CFG.GOOGLE_OAUTH_REFRESH_TOKEN });
    _auth = o;
    return _auth;
  }
  // Option A: service account
  if (!CFG.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Google auth not configured: set GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN or GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  const creds = JSON.parse(CFG.GOOGLE_SERVICE_ACCOUNT_JSON);
  _auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  return _auth;
}

function sheets() {
  if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: auth() });
  return _sheets;
}

// v2 tab schemas (added alongside v1 tabs; never touches existing ones)
const V2_TABS = {
  Master_Blogs: ['SI', 'Date', 'Blog Title', 'Primary Keyword', 'Target WC', 'Actual WC', 'Word Alignment %', 'WC Pass', 'Keywords Planned', 'Keywords Verified', 'Total Repetitions', 'Max Density %', 'Status', 'Blog URL', 'Doc Link', 'Images', 'Keyword Research', 'Keyword Audit Tab'],
  Projects: ['Project Name', 'Corridor', 'Configurations', 'Size Range', 'Price Band', 'USP / Details', 'Brochure/File Link', 'Status'],
  L1_Keywords: ['Date', 'Seed', 'Keyword', 'Type', 'Source', 'Trends Bucket', 'Interest', 'Intent', 'Corridor', 'Niche Score', 'Used In Topic'],
  L1_Competitors: ['Domain', 'First Seen', '# Keywords Ranked', 'Sample URLs', 'Avg Word Count', 'Type', 'Notes'],
  L2_Topics: ['SI', 'Topic', 'Primary Keyword', 'Supporting Keywords', 'Keyword Count', 'Repeated Words (competitors)', 'Target WC', 'Project', 'Project File Link', 'Doc Link', 'Images', 'LLM Queries', 'Risk', 'Approval', 'Status'],
  L3_QA: ['Topic', 'Target WC', 'Actual WC', 'WC Pass', 'Keywords Planned', 'Keywords Verified', 'Failed Keywords', 'Max Density %', 'Density Pass', 'Humanised', 'Notes', 'Overall', 'Date'],
  Published: ['Date', 'Topic', 'Blog URL', 'LinkedIn Status', 'LinkedIn URL/Note', 'Doc Link']
};

async function ensureTabs() {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: CFG.SHEET_ID });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  const requests = [];
  for (const [title] of Object.entries(V2_TABS)) {
    if (!existing.has(title)) requests.push({ addSheet: { properties: { title } } });
  }
  if (requests.length) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: CFG.SHEET_ID, requestBody: { requests } });
  }
  // write headers where row 1 is empty
  for (const [title, headers] of Object.entries(V2_TABS)) {
    const cur = await getRange(`${title}!A1:${colLetter(headers.length)}1`);
    const has = cur && cur[0] && cur[0].some(v => String(v).trim() !== '');
    if (!has) await setRange(`${title}!A1`, [headers]);
  }
  return Object.keys(V2_TABS);
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function getRange(a1) {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: CFG.SHEET_ID, range: a1 });
  return res.data.values || [];
}

async function setRange(a1, values) {
  await sheets().spreadsheets.values.update({
    spreadsheetId: CFG.SHEET_ID, range: a1, valueInputOption: 'RAW', requestBody: { values }
  });
}

async function appendRows(tab, rows) {
  if (!rows.length) return;
  await sheets().spreadsheets.values.append({
    spreadsheetId: CFG.SHEET_ID, range: `${tab}!A1`, valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS', requestBody: { values: rows }
  });
}

/** Read a tab into row objects keyed by header, with _row = sheet row number. */
async function readTab(tab) {
  const values = await getRange(`${tab}!A1:ZZ`);
  if (values.length < 2) return { headers: values[0] || [], rows: [] };
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, c) => { o[h] = r[c] !== undefined ? r[c] : ''; });
    return o;
  });
  return { headers, rows };
}

/** Update named columns on a specific row. */
async function updateRow(tab, headers, rowNumber, patch) {
  const data = [];
  for (const [key, val] of Object.entries(patch)) {
    const idx = headers.indexOf(key);
    if (idx === -1) continue;
    data.push({ range: `${tab}!${colLetter(idx + 1)}${rowNumber}`, values: [[val]] });
  }
  if (!data.length) return;
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: CFG.SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data }
  });
}


/**
 * Create a new tab (sheet) with the given title; returns its numeric sheetId (gid).
 * If a tab with that title already exists, returns its existing sheetId.
 */
async function createTab(title) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: CFG.SHEET_ID });
  const found = meta.data.sheets.find(s => s.properties.title === title);
  if (found) return found.properties.sheetId;
  const res = await api.spreadsheets.batchUpdate({
    spreadsheetId: CFG.SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

/**
 * Write a single formula cell (USER_ENTERED). Only for formulas WE construct —
 * never pass user/model content through this (data writes stay RAW).
 */
async function setFormulaCell(a1, formula) {
  await sheets().spreadsheets.values.update({
    spreadsheetId: CFG.SHEET_ID, range: a1, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[formula]] }
  });
}

/** Read a single value from the Config tab by key (col A = key, col B = value). */
async function getConfigValue(key) {
  const t = await readTab('Config').catch(() => null);
  if (!t) return null;
  const row = t.rows.find(r => String(r[t.headers[0]]).trim() === key);
  return row ? row[t.headers[1]] : null;
}

/** Upsert a key/value row on the Config tab. */
async function setConfigValue(key, value) {
  const t = await readTab('Config').catch(() => null);
  if (!t) return;
  const row = t.rows.find(r => String(r[t.headers[0]]).trim() === key);
  if (row) await updateRow('Config', t.headers, row._row, { [t.headers[1]]: value });
  else await appendRows('Config', [[key, value, 'auto: SERP quota tracking']]);
}

module.exports = { auth, sheets, ensureTabs, readTab, appendRows, updateRow, getRange, setRange, getConfigValue, setConfigValue, createTab, setFormulaCell, colLetter, V2_TABS };
