'use strict';
/** First-party data sources: Google Trends (unofficial endpoints), autocomplete, Custom Search SERP. */

const CFG = require('./config');
const U = require('./util');

const TRENDS_BASE = 'https://trends.google.com/trends/api';
let _serpUsed = { date: '', n: 0 };

// ---------- Trends ----------
async function trendsRelatedQueries(seed) {
  try {
    const hl = CFG.LANG + '-' + CFG.COUNTRY.toUpperCase();
    const exploreReq = { comparisonItem: [{ keyword: seed, geo: CFG.TRENDS_GEO, time: 'today 12-m' }], category: 0, property: '' };
    const exploreUrl = `${TRENDS_BASE}/explore?hl=${encodeURIComponent(hl)}&tz=-330&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
    const er = await U.httpFetch(exploreUrl, {}, 2);
    if (er.code !== 200) throw new Error('explore HTTP ' + er.code);
    const ej = JSON.parse(U.stripJsonPrefix(er.text));
    const widget = (ej.widgets || []).find(w => w.id === 'RELATED_QUERIES');
    if (!widget) throw new Error('no RELATED_QUERIES widget');
    await U.sleep(500);
    const dataUrl = `${TRENDS_BASE}/widgetdata/relatedsearches?hl=${encodeURIComponent(hl)}&tz=-330&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
    const dr = await U.httpFetch(dataUrl, {}, 2);
    if (dr.code !== 200) throw new Error('relatedsearches HTTP ' + dr.code);
    const dj = JSON.parse(U.stripJsonPrefix(dr.text));
    const ranked = ((dj.default || {}).rankedList) || [];
    const pick = (node) => (node && node.rankedKeyword || []).map(k => ({ query: k.query, value: k.value != null ? k.value : (k.extractedValue || 0) }));
    return { top: pick(ranked[0]), rising: pick(ranked[1]), source: 'trends' };
  } catch (e) {
    console.warn('[trends] fallback for "' + seed + '": ' + e.message);
    const sug = await autocomplete(seed);
    return { top: sug.map(q => ({ query: q, value: 0 })), rising: [], source: 'autocomplete' };
  }
}

async function autocomplete(seed) {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${CFG.LANG}&gl=${CFG.COUNTRY}&q=${encodeURIComponent(seed)}`;
    const res = await U.httpFetch(url, {}, 2);
    const arr = JSON.parse(res.text);
    return (arr[1] || []).slice(0, 10);
  } catch (e) {
    console.warn('[autocomplete] failed for "' + seed + '": ' + e.message);
    return [];
  }
}

// ---------- SERP ----------
function serpBudgetRemaining() {
  const today = U.todayISO();
  if (_serpUsed.date !== today) _serpUsed = { date: today, n: 0 };
  return Math.max(0, CFG.SERP_DAILY_BUDGET - _serpUsed.n);
}

async function googleSerp(query, topN = 10) {
  if (!CFG.SEARCH_API_KEY || !CFG.SEARCH_ENGINE_ID) throw new Error('SEARCH_API_KEY / SEARCH_ENGINE_ID not set');
  if (serpBudgetRemaining() < 1) throw new Error('SERP daily budget exhausted');
  const today = U.todayISO();
  if (_serpUsed.date !== today) _serpUsed = { date: today, n: 0 };
  _serpUsed.n++;
  const url = 'https://www.googleapis.com/customsearch/v1'
    + `?key=${encodeURIComponent(CFG.SEARCH_API_KEY)}&cx=${encodeURIComponent(CFG.SEARCH_ENGINE_ID)}`
    + `&q=${encodeURIComponent(query)}&gl=${CFG.COUNTRY}&hl=${CFG.LANG}&num=${Math.min(10, topN)}`;
  const res = await U.httpFetch(url, {}, 3);
  if (res.code !== 200) { console.warn('[serp] HTTP ' + res.code + ' for "' + query + '"'); return { urls: [], related: [] }; }
  const json = JSON.parse(res.text);
  const urls = (json.items || []).map(it => it.link).filter(Boolean);
  const related = ((json.queries || {}).relatedSearch || []).map(q => q.title).filter(Boolean);
  return { urls, related };
}

async function fetchPage(url) {
  try {
    const res = await U.httpFetch(url, {}, 1);
    return res.code >= 400 ? '' : res.text;
  } catch (e) {
    console.warn('[fetchPage] ' + url + ' -> ' + e.message);
    return '';
  }
}

function hostOf(u) {
  try { return String(u).replace(/^https?:\/\//, '').split('/')[0].toLowerCase().replace(/^www\./, ''); }
  catch (e) { return ''; }
}

function getSerpUsage() {
  const today = U.todayISO();
  if (_serpUsed.date !== today) _serpUsed = { date: today, n: 0 };
  return { ..._serpUsed };
}
function setSerpUsage(date, n) { _serpUsed = { date, n: Number(n) || 0 }; }

module.exports = { trendsRelatedQueries, autocomplete, googleSerp, fetchPage, hostOf, serpBudgetRemaining, getSerpUsage, setSerpUsage };
