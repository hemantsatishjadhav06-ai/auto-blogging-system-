'use strict';
/**
 * LAYER 1 — Keyword research + competitor discovery FROM those keywords.
 *  1. Harvest keywords per seed (Trends first-party; autocomplete fallback).
 *  2. Write new keywords to L1_Keywords with niche score.
 *  3. For the strongest keywords, read page-1 and aggregate DOMAINS -> L1_Competitors.
 */

const CFG = require('./config');
const U = require('./util');
const S = require('./sources');
const GS = require('./gsheets');

async function runLayer1({ serpKeywords = 6 } = {}) {
  await GS.ensureTabs();
  const date = U.todayISO();

  // ---- 1. harvest ----
  const existing = await GS.readTab('L1_Keywords');
  const known = new Set(existing.rows.map(r => String(r['Keyword']).toLowerCase()).filter(Boolean));
  const newRows = [];

  for (const seed of CFG.SEED_THEMES) {
    const rel = await S.trendsRelatedQueries(seed);
    const pool = [
      ...rel.top.map(x => ({ q: x.query, v: x.value, bucket: 'Top' })),
      ...rel.rising.map(x => ({ q: x.query, v: x.value, bucket: 'Rising' })),
      { q: seed, v: 0, bucket: 'Seed' }
    ];
    for (const item of pool) {
      const kw = String(item.q || '').trim().toLowerCase();
      if (!kw || known.has(kw)) continue;
      known.add(kw);
      newRows.push([
        date, seed, kw, U.classifyType(kw), rel.source, item.bucket, item.v || '',
        U.classifyIntent(kw), U.detectCorridor(kw), U.nicheScore(kw), ''
      ]);
    }
    await U.sleep(400);
  }
  await GS.appendRows('L1_Keywords', newRows);

  // ---- 2. competitor discovery from the keywords ----
  const all = await GS.readTab('L1_Keywords');
  const candidates = all.rows
    .filter(r => r['Keyword'])
    .sort((a, b) => (Number(b['Niche Score']) || 0) - (Number(a['Niche Score']) || 0))
    .slice(0, serpKeywords);

  const domains = {}; // domain -> {kwSet, urls}
  let serped = 0;
  for (const row of candidates) {
    if (S.serpBudgetRemaining() < 1) break;
    let serp;
    try { serp = await S.googleSerp(row['Keyword'], CFG.SERP_TOP_N); }
    catch (e) { console.warn('[layer1] serp skip: ' + e.message); break; }
    serped++;
    for (const url of serp.urls) {
      const d = S.hostOf(url);
      if (!d || d.includes('neopolis-infra')) continue;
      domains[d] = domains[d] || { kws: new Set(), urls: new Set() };
      domains[d].kws.add(row['Keyword']);
      if (domains[d].urls.size < 3) domains[d].urls.add(url);
    }
    await U.sleep(300);
  }

  // merge into L1_Competitors (upsert by domain)
  const compTab = await GS.readTab('L1_Competitors');
  const byDomain = {};
  compTab.rows.forEach(r => { if (r['Domain']) byDomain[r['Domain']] = r; });
  const newComp = [];
  for (const [domain, info] of Object.entries(domains)) {
    if (info.kws.size < 2 && Object.keys(domains).length > 8) continue; // real competitor = appears for 2+ kws
    const type = /99acres|magicbricks|housing|nobroker|squareyards|olx|makaan|roofandfloor/.test(domain) ? 'portal'
      : /godrej|prestige|myhome|aparna|ramky|klm|rajapushpa|casagrand/.test(domain) ? 'builder' : 'other';
    if (byDomain[domain]) {
      const merged = Math.max(Number(byDomain[domain]['# Keywords Ranked']) || 0, info.kws.size);
      await GS.updateRow('L1_Competitors', compTab.headers, byDomain[domain]._row, { '# Keywords Ranked': merged });
    } else {
      newComp.push([domain, date, info.kws.size, [...info.urls].join('\n'), '', type, '']);
    }
  }
  await GS.appendRows('L1_Competitors', newComp);

  const summary = { newKeywords: newRows.length, serpQueriesUsed: serped, competitorsFound: newComp.length };
  console.log('[layer1]', JSON.stringify(summary));
  return summary;
}

module.exports = { runLayer1 };
