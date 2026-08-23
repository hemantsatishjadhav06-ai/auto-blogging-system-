'use strict';
/**
 * LAYER 2 — Topic sheet: repeated-words analysis -> keyword plan -> project details ->
 * draft (blog + LinkedIn) -> Google Doc -> link pasted in the sheet row.
 */

const CFG = require('./config');
const U = require('./util');
const S = require('./sources');
const GS = require('./gsheets');
const W = require('./writer');
const GD = require('./gdocs');
const IMG = require('./images');

async function runLayer2({ topics = CFG.TOPICS_PER_RUN } = {}) {
  await GS.ensureTabs();
  const date = U.todayISO();

  // ---- pick next topics from L1 keywords not yet used ----
  const kwTab = await GS.readTab('L1_Keywords');
  const l2Tab = await GS.readTab('L2_Topics');
  const usedPrimaries = new Set(l2Tab.rows.map(r => String(r['Primary Keyword']).toLowerCase()).filter(Boolean));

  // group by corridor/theme; head = highest niche+intent
  const groups = {};
  for (const r of kwTab.rows) {
    const kw = String(r['Keyword'] || '').toLowerCase();
    if (!kw) continue;
    const key = (r['Corridor'] || themeOf(kw)).toLowerCase();
    (groups[key] = groups[key] || []).push(r);
  }
  const candidates = [];
  for (const [key, rows] of Object.entries(groups)) {
    const sorted = rows.slice().sort((a, b) => scoreRow(b) - scoreRow(a));
    const head = sorted.find(r => !usedPrimaries.has(String(r['Keyword']).toLowerCase()));
    if (head) candidates.push({ key, head, cluster: sorted });
  }
  candidates.sort((a, b) => scoreRow(b.head) - scoreRow(a.head));

  const projects = (await GS.readTab('Projects')).rows.filter(r => r['Project Name']);
  const results = [];
  let siNext = l2Tab.rows.length + 1;

  for (const cand of candidates.slice(0, topics)) {
    const primary = String(cand.head['Keyword']).toLowerCase();
    try {
      results.push(await buildTopic({ cand, primary, projects, kwTab, l2Tab, date, si: siNext++ }));
    } catch (e) {
      console.error('[layer2] failed for "' + primary + '": ' + e.message);
      results.push({ primary, error: e.message });
    }
  }
  console.log('[layer2]', JSON.stringify(results.map(r => r.error ? r : { topic: r.topic, doc: r.docUrl })));
  return results;
}

function scoreRow(r) {
  const intentW = r['Intent'] === 'transactional' ? 3 : (r['Intent'] === 'commercial' ? 2 : 1);
  return intentW * 100 + (Number(r['Niche Score']) || 0) + (Number(r['Interest']) || 0);
}

function themeOf(kw) {
  if (kw.includes('landlord share') || kw.includes('land owner')) return 'landlord share';
  if (kw.includes('nri')) return 'nri buying';
  if (kw.includes('title') || kw.includes('legal') || kw.includes('rera')) return 'legal & title';
  if (kw.includes('joint development')) return 'joint development';
  return 'west hyderabad general';
}

async function buildTopic({ cand, primary, projects, kwTab, l2Tab, date, si }) {
  // ---- SERP + competitor pages ----
  const serp = await S.googleSerp(primary, CFG.SERP_TOP_N);
  const texts = [], headings = [], counts = [];
  for (const url of serp.urls) {
    const html = await S.fetchPage(url);
    if (!html) continue;
    const text = U.extractMainText(html);
    const wc = U.wordCount(text);
    if (wc < 150) continue;
    texts.push(text); counts.push(wc);
    headings.push(...U.extractHeadings(html));
    await U.sleep(250);
  }

  // ---- target word count (v1 formula, validated) ----
  const targetWC = targetWordCount(counts);

  // ---- repeated-words engine ----
  const repeated = U.repeatedGrams(texts, { minDocs: 2, top: 15 });

  // ---- keyword plan: cluster keywords + repeated grams, 10-18 total ----
  const clusterKws = cand.cluster.map(r => String(r['Keyword']).toLowerCase()).filter(k => k !== primary);
  const gramKws = repeated.map(g => g.gram).filter(g => g.split(' ').length >= 2);
  const seen = new Set([primary]);
  const supporting = [];
  for (const k of [...clusterKws, ...gramKws]) {
    if (seen.has(k) || supporting.length >= CFG.MAX_SUPPORTING_KEYWORDS) continue;
    // skip near-duplicates of the primary
    if (primary.includes(k) || k.includes(primary)) continue;
    seen.add(k);
    supporting.push({ keyword: k, minCount: U.minCountFor(k, targetWC) });
  }
  while (supporting.length < CFG.MIN_SUPPORTING_KEYWORDS && gramKws.length) {
    const k = gramKws.shift();
    if (k && !seen.has(k)) { seen.add(k); supporting.push({ keyword: k, minCount: U.minCountFor(k, targetWC) }); }
    if (!gramKws.length) break;
  }

  // ---- niche keywords -> LLM queries (AEO) ----
  const nicheKws = cand.cluster
    .slice().sort((a, b) => (Number(b['Niche Score']) || 0) - (Number(a['Niche Score']) || 0))
    .slice(0, CFG.AEO_NICHE_KEYWORDS).map(r => r['Keyword']);
  const llmQueries = await W.llmQueriesFor(nicheKws, cand.head['Corridor']);

  // ---- project details (attach file link from Projects tab) ----
  const corridor = cand.head['Corridor'] || '';
  const project = projects.find(p => corridor && String(p['Corridor']).toLowerCase().includes(corridor.toLowerCase())
      && String(p['Status'] || '').toLowerCase() !== 'inactive')
    || projects[0] || null;

  // ---- draft blog + linkedin ----
  const topicTitle = proposeTitle(primary);
  const blog = await W.draftBlog({
    topicTitle, primaryKeyword: primary, targetWC, supportingKeywords: supporting,
    repeatedWords: repeated, mustCoverHeadings: topHeadings(headings, 10),
    project, llmQueries, related: serp.related
  });
  const blogUrl = CFG.SITE_URL.replace(/\/+$/, '') + CFG.BLOG_BASE_PATH + '/' + (blog.slug || U.slugify(topicTitle));
  const li = await W.draftLinkedIn({ topicTitle, primaryKeyword: primary, blogUrl, supportingKeywords: supporting, project });

  // ---- Google Doc with content; link goes into the sheet ----
  const doc = await GD.createContentDoc({
    title: 'Blog: ' + (blog.title || topicTitle),
    meta: {
      title: blog.title, slug: blog.slug, meta_title: blog.meta_title,
      meta_description: blog.meta_description, primary_keyword: primary, supporting_keywords: supporting
    },
    blogMarkdown: blog.markdown_body,
    linkedinArticle: (li.article_title ? li.article_title + '\n\n' : '') + (li.article_body || '') + '\n\n--- POST VERSION ---\n' + (li.post_text || ''),
    llmQueries
  });

  // ---- images (fal.ai): hero + infographic + enhanced ----
  let images = [];
  if (CFG.FAL_API_KEY) {
    const openingSummary = String(blog.markdown_body || '').split('\n').slice(0, 6).join(' ').replace(/[#*|]/g, ' ').slice(0, 400);
    try {
      images = await IMG.generateBlogImages({ title: blog.title || topicTitle, primaryKeyword: primary, openingSummary, seq: si });
    } catch (e) { console.warn('[layer2] images failed: ' + e.message); }
  }

  // ---- risk + approval ----
  const risk = CFG.MONEY_PAGE_KEYWORDS.some(m => primary.includes(m)) || cand.head['Intent'] === 'transactional' ? 'money-page' : 'standard';
  const approval = risk === 'money-page' ? 'Pending' : (CFG.AUTO_PUBLISH_INTENTS.includes(String(cand.head['Intent'])) ? 'Approved' : 'Pending');

  // ---- write the L2 row ----
  await GS.appendRows('L2_Topics', [[
    si, blog.title || topicTitle, primary,
    supporting.map(k => `${k.keyword} (min ${k.minCount})`).join('; '),
    1 + supporting.length,
    repeated.map(g => `${g.gram} (${g.totalCount})`).join('; '),
    targetWC,
    project ? project['Project Name'] : '',
    project ? (project['Brochure/File Link'] || '') : '',
    doc.docUrl,
    images.map(i => `${i.role}: ${i.url}${i.driveUrl ? ' | drive: ' + i.driveUrl : ''}`).join('\n'),
    llmQueries.join(' | '),
    risk, approval, 'Drafted'
  ]]);

  // mark cluster keywords as used
  for (const r of cand.cluster) {
    if (kwTab.headers.includes('Used In Topic')) {
      await GS.updateRow('L1_Keywords', kwTab.headers, r._row, { 'Used In Topic': blog.title || topicTitle });
    }
  }

  // stash draft content for layer 3 in the doc (source of truth) + return
  return {
    topic: blog.title || topicTitle, primary, targetWC, docUrl: doc.docUrl, docId: doc.docId,
    supportingCount: supporting.length, llmQueries: llmQueries.length,
    project: project ? project['Project Name'] : null
  };
}

function targetWordCount(counts) {
  if (!counts.length) return CFG.WORDCOUNT_FLOOR;
  const sorted = counts.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const top3 = sorted.slice(-3);
  const avgTop3 = top3.reduce((a, b) => a + b, 0) / top3.length;
  const t = Math.round(Math.max(median, avgTop3) * CFG.WORDCOUNT_MULTIPLIER);
  return Math.max(CFG.WORDCOUNT_FLOOR, Math.min(CFG.WORDCOUNT_CEILING, t));
}

function topHeadings(all, limit) {
  const freq = {};
  all.forEach(h => { const k = h.toLowerCase(); freq[k] = freq[k] || { text: h, n: 0 }; freq[k].n++; });
  return Object.values(freq).sort((a, b) => b.n - a.n).slice(0, limit).map(x => x.text);
}

function proposeTitle(kw) {
  const y = new Date().getFullYear();
  const base = kw.replace(/\b\w/g, c => c.toUpperCase());
  const intent = U.classifyIntent(kw);
  if (intent === 'transactional') return `${base}: Prices, Options & Buyer Guide ${y}`;
  if (intent === 'commercial') return `${base}: What Buyers Should Know ${y}`;
  return `${base}: A Complete Guide ${y}`;
}

module.exports = { runLayer2, targetWordCount };
