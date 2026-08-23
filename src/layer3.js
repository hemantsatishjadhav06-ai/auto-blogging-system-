'use strict';
/**
 * LAYER 3 — Verify word count + every keyword's count, then HUMANISE, then re-verify.
 * Reads drafts from the Google Doc (source of truth), appends humanised revisions to it,
 * writes the full audit to L3_QA, and gates the topic's status for publishing.
 */

const CFG = require('./config');
const U = require('./util');
const GS = require('./gsheets');
const GD = require('./gdocs');
const W = require('./writer');

async function runLayer3() {
  await GS.ensureTabs();
  const l2 = await GS.readTab('L2_Topics');
  const targets = l2.rows.filter(r => String(r['Status']) === 'Drafted' && r['Doc Link']);
  const results = [];

  for (const row of targets) {
    try { results.push(await qaOne(row, l2.headers)); }
    catch (e) {
      console.error('[layer3] failed for "' + row['Topic'] + '": ' + e.message);
      results.push({ topic: row['Topic'], error: e.message });
    }
  }
  console.log('[layer3]', JSON.stringify(results));
  return results;
}

function parseKeywordPlan(cell) {
  // "kw one (min 4); kw two (min 3)" -> [{keyword, minCount}]
  return String(cell || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.*?)\s*\(min\s*(\d+)\)\s*$/i);
    return m ? { keyword: m[1].trim(), minCount: Number(m[2]) } : { keyword: s, minCount: 2 };
  });
}

function docIdFrom(url) {
  const m = String(url).match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function verify(markdown, targetWC, primary, plan) {
  const actualWC = U.wordCount(markdown.replace(/[#*|>`\-]/g, ' '));
  const wcPass = Math.abs(actualWC - targetWC) <= targetWC * CFG.WC_TOLERANCE;
  const checks = [];
  const allKws = [{ keyword: primary, minCount: Math.max(4, Math.round(targetWC / 400)) }, ...plan];
  let maxDensity = 0;
  for (const k of allKws) {
    const n = U.countOccurrences(markdown, k.keyword);
    const d = U.density(markdown, k.keyword, n);
    maxDensity = Math.max(maxDensity, d);
    checks.push({ keyword: k.keyword, minCount: k.minCount, actual: n, pass: n >= k.minCount, density: d });
  }
  const failed = checks.filter(c => !c.pass).map(c => ({ keyword: c.keyword, needed: c.minCount - c.actual }));
  const densityPass = maxDensity <= CFG.KEYWORD_DENSITY_CEILING;
  return { actualWC, wcPass, checks, failed, maxDensity, densityPass };
}

async function qaOne(row, headers) {
  const docId = docIdFrom(row['Doc Link']);
  if (!docId) throw new Error('No doc id in Doc Link');
  const targetWC = Number(row['Target WC']) || CFG.WORDCOUNT_FLOOR;
  const primary = String(row['Primary Keyword']);
  const plan = parseKeywordPlan(row['Supporting Keywords']);

  let { blog, linkedin } = await GD.readLatestContent(docId);
  if (!blog) throw new Error('Doc has no blog content');

  // ---- verify -> humanise -> re-verify loop ----
  let v = verify(blog, targetWC, primary, plan);
  let humanised = false;
  for (let i = 0; i < CFG.HUMANIZE_MAX_LOOPS; i++) {
    const out = await W.humanize({
      markdown: blog, targetWC, supportingKeywords: plan, primaryKeyword: primary, failedKeywords: v.failed
    });
    if (out && out.markdown_body) {
      blog = out.markdown_body;
      humanised = true;
      await GD.appendRevision(docId, 'HUMANISED v' + (i + 1), blog, i === 0 ? linkedin : '');
    }
    v = verify(blog, targetWC, primary, plan);
    if (v.wcPass && !v.failed.length && v.densityPass) break;
  }

  const overall = v.wcPass && !v.failed.length && v.densityPass ? 'PASS' : 'NEEDS REVIEW';

  // ---- Two-level tracking: per-blog keyword audit tab + Master_Blogs row ----
  try {
    await writeBlogAudit({ row, v, targetWC, humanised, overall });
  } catch (e) { console.warn('[layer3] master/audit tab write failed: ' + e.message); }

  await GS.appendRows('L3_QA', [[
    row['Topic'], targetWC, v.actualWC, v.wcPass ? 'PASS' : 'FAIL',
    1 + plan.length,
    v.checks.filter(c => c.pass).length + '/' + v.checks.length,
    v.failed.map(f => `${f.keyword} (short ${f.needed})`).join('; ') || '-',
    v.maxDensity, v.densityPass ? 'PASS' : 'FAIL (stuffing)',
    humanised ? 'Yes' : 'No',
    overall === 'PASS' ? 'All checks green' : 'See failed columns',
    overall, U.todayISO()
  ]]);

  await GS.updateRow('L2_Topics', headers, row._row, { 'Status': overall === 'PASS' ? 'QA Passed' : 'Needs Review' });

  return { topic: row['Topic'], overall, actualWC: v.actualWC, targetWC, keywordsVerified: v.checks.filter(c => c.pass).length + '/' + v.checks.length, humanised, maxDensity: v.maxDensity };
}

/**
 * Create/refresh the blog's own keyword-audit tab and its Master_Blogs row.
 * Master row links to the audit tab via a HYPERLINK to the tab's gid.
 */
async function writeBlogAudit({ row, v, targetWC, humanised, overall }) {
  const master = await GS.readTab('Master_Blogs');
  const existing = master.rows.find(r => String(r['Primary Keyword']).toLowerCase() === String(row['Primary Keyword']).toLowerCase());
  const si = existing ? existing['SI'] : master.rows.length + 1;

  // per-blog tab (idempotent by title)
  const tabTitle = ('Blog-' + String(si).padStart(2, '0') + '-' + U.slugify(row['Topic'])).slice(0, 90);
  const gid = await GS.createTab(tabTitle);

  const header = [
    ['KEYWORD AUDIT — ' + row['Topic']],
    ['Date', U.todayISO(), '', 'Primary Keyword', row['Primary Keyword']],
    ['Target WC', targetWC, '', 'Actual WC', v.actualWC],
    ['Word Alignment %', targetWC ? Math.round(100 * v.actualWC / targetWC) : '', '', 'Overall', overall],
    ['Humanised', humanised ? 'Yes' : 'No', '', 'Max Density %', v.maxDensity],
    [],
    ['Keyword', 'Role', 'Required Min', 'Repetitions (Actual)', 'Density %', 'Pass']
  ];
  const kwRows = v.checks.map((c, i) => [
    c.keyword, i === 0 ? 'PRIMARY' : 'supporting', c.minCount, c.actual, c.density, c.pass ? 'PASS' : 'FAIL'
  ]);
  const totals = [[], ['TOTALS', '', v.checks.reduce((a, b) => a + b.minCount, 0), v.checks.reduce((a, b) => a + b.actual, 0), '', v.checks.filter(c => c.pass).length + '/' + v.checks.length + ' pass']];
  const all = header.concat(kwRows, totals);
  const norm = all.map(r => { const c = r.slice(); while (c.length < 6) c.push(''); return c; });
  await GS.setRange(`'${tabTitle}'!A1:F${norm.length}`, norm);

  // master row (upsert)
  const masterValues = {
    'SI': si, 'Date': U.todayISO(), 'Blog Title': row['Topic'], 'Primary Keyword': row['Primary Keyword'],
    'Target WC': targetWC, 'Actual WC': v.actualWC,
    'Word Alignment %': targetWC ? Math.round(100 * v.actualWC / targetWC) : '',
    'WC Pass': v.wcPass ? 'PASS' : 'FAIL',
    'Keywords Planned': v.checks.length,
    'Keywords Verified': v.checks.filter(c => c.pass).length + '/' + v.checks.length,
    'Total Repetitions': v.checks.reduce((a, b) => a + b.actual, 0),
    'Max Density %': v.maxDensity,
    'Status': overall === 'PASS' ? 'QA Passed' : 'Needs Review',
    'Doc Link': row['Doc Link'] || '',
    'Images': String(row['Images'] || '').slice(0, 500)
  };
  let rowNumber;
  if (existing) {
    rowNumber = existing._row;
    await GS.updateRow('Master_Blogs', master.headers, rowNumber, masterValues);
  } else {
    const ordered = master.headers.map(h => masterValues[h] !== undefined ? masterValues[h] : '');
    await GS.appendRows('Master_Blogs', [ordered]);
    rowNumber = master.rows.length + 2; // header + existing rows + new
  }
  // hyperlinks (formulas we construct ourselves — safe for USER_ENTERED):
  // 1) this blog's keyword-audit tab; 2) the shared Keyword Research sheet (L1_Keywords)
  const safeTitle = tabTitle.replace(/"/g, '');
  const auditCol = GS.colLetter(master.headers.indexOf('Keyword Audit Tab') + 1);
  await GS.setFormulaCell(`Master_Blogs!${auditCol}${rowNumber}`, `=HYPERLINK("#gid=${gid}","${safeTitle}")`);
  const krIdx = master.headers.indexOf('Keyword Research');
  if (krIdx > -1) {
    try {
      const krGid = await GS.createTab('L1_Keywords'); // returns existing gid
      const krCol = GS.colLetter(krIdx + 1);
      await GS.setFormulaCell(`Master_Blogs!${krCol}${rowNumber}`, `=HYPERLINK("#gid=${krGid}","Keyword Research")`);
    } catch (e) { console.warn('[layer3] keyword-research link skipped: ' + e.message); }
  }
  return { tabTitle, gid };
}

module.exports = { runLayer3, verify, parseKeywordPlan, writeBlogAudit };
