'use strict';
/** Gemini calls: blog draft, LinkedIn article, humanisation, AEO queries. */

const CFG = require('./config');
const U = require('./util');

async function gemini(prompt, { json = true, temperature = 0.7 } = {}) {
  if (!CFG.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.GEMINI_MODEL}:generateContent?key=${encodeURIComponent(CFG.GEMINI_API_KEY)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: 8192, ...(json ? { responseMimeType: 'application/json' } : {}) }
  };
  const res = await U.httpFetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 3);
  if (res.code !== 200) throw new Error('Gemini HTTP ' + res.code + ': ' + res.text.slice(0, 300));
  const j = JSON.parse(res.text);
  const cand = (j.candidates || [])[0];
  if (!cand) throw new Error('Gemini: no candidates');
  return (cand.content.parts || []).map(p => p.text || '').join('');
}

function parseJson(raw) {
  let t = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s > -1 && e > -1) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

const BRAND_CONTEXT = [
  `You write for ${CFG.BRAND} (${CFG.SITE_URL}), a specialist desk selling landlord-share apartments`,
  `in West Hyderabad (${CFG.CORRIDORS.join(', ')}) at 8-14% below resale, direct from landowners, no brokers.`,
  'Audience: premium and NRI homebuyers, budget Rs 0.9-3.5 Cr.',
  'ACCURACY RULES (non-negotiable): never invent exact prices, legal guarantees, approvals, or project claims.',
  'Use ranges and "verify current details with the Neopolis team". No misleading statements.'
].join('\n');

/** Blog draft with per-keyword minimum counts. */
async function draftBlog({ topicTitle, primaryKeyword, targetWC, supportingKeywords, repeatedWords, mustCoverHeadings, project, llmQueries, related }) {
  const kwLines = supportingKeywords.map(k => `- "${k.keyword}" : use at least ${k.minCount} times`).join('\n');
  const prompt = [
    BRAND_CONTEXT, '',
    `TASK: Write ONE SEO blog post titled around: "${topicTitle}".`,
    `PRIMARY KEYWORD: "${primaryKeyword}" — use it in the H1, the first 100 words, one H2, and at least ${Math.max(4, Math.round(targetWC / 400))} times total.`,
    `TARGET LENGTH: ${targetWC} words (must be within +/-10%; count only the article body).`,
    '',
    'SUPPORTING KEYWORDS — every one of these MUST appear at least the stated number of times, naturally:',
    kwLines, '',
    'COMPETITOR-REPEATED TERMS (weave these in; they are what ranking pages talk about): ' + repeatedWords.slice(0, 15).map(g => g.gram).join(', '),
    mustCoverHeadings && mustCoverHeadings.length ? 'COVER THESE SUBTOPICS (from ranking pages):\n- ' + mustCoverHeadings.join('\n- ') : '',
    project ? [
      'PROJECT TO FEATURE (facts below are supplied by the client; do not embellish beyond them):',
      `Name: ${project['Project Name']} | Corridor: ${project['Corridor']} | Configurations: ${project['Configurations']}`,
      `Sizes: ${project['Size Range']} | Price band: ${project['Price Band']}`,
      `Details/USP: ${project['USP / Details']}`,
      'Mention the project in one dedicated section and the conclusion, factually.'
    ].join('\n') : '',
    '',
    'LLM SEARCH QUERIES (AEO): include an FAQ section where each of these exact questions is an H3, answered directly and completely in 2-4 sentences:',
    llmQueries.map(q => '- ' + q).join('\n'),
    related && related.length ? 'Also answer briefly: ' + related.join(' | ') : '',
    '',
    'STYLE: H2/H3 structure, short paragraphs, one comparison table, India context, Rupee ranges only, 2026 framing, soft CTA to contact ' + CFG.BRAND + ' at the end.',
    '',
    'OUTPUT strict JSON only:',
    '{"title":"","slug":"","meta_title":"<=60 chars","meta_description":"<=155 chars","markdown_body":"","image_prompt":""}'
  ].filter(Boolean).join('\n');
  return parseJson(await gemini(prompt));
}

/** LinkedIn article variant (same research, professional narrative). */
async function draftLinkedIn({ topicTitle, primaryKeyword, blogUrl, supportingKeywords, project }) {
  const prompt = [
    BRAND_CONTEXT, '',
    `TASK: Write a LinkedIn ARTICLE (800-1200 words) adapted from a blog on "${topicTitle}".`,
    'Voice: a market specialist sharing insight, first-person plural ("we see", "our title checks"), no hard selling.',
    `Weave in naturally: "${primaryKeyword}" plus ` + supportingKeywords.slice(0, 6).map(k => '"' + k.keyword + '"').join(', ') + '.',
    project ? `Reference the ${project['Project Name']} project factually where it fits.` : '',
    'Structure: a hook opening (2 lines), 3-5 short sections with plain-text headers, a practical takeaway list, one question to the reader at the end.',
    blogUrl ? `Close with: full guide on our site: ${blogUrl}` : '',
    'Also produce a 150-word LinkedIn POST version (with 3-5 hashtags) that links to the article/blog.',
    '',
    'OUTPUT strict JSON only: {"article_title":"","article_body":"","post_text":""}'
  ].filter(Boolean).join('\n');
  return parseJson(await gemini(prompt));
}

const AI_CLICHES = ['in today\'s fast-paced world', 'delve', 'dive into', 'landscape', 'unlock', 'game-changer', 'game changer', 'revolutionize', 'seamless', 'elevate', 'embark', 'realm', 'tapestry', 'testament', 'furthermore', 'moreover,', 'in conclusion', 'it is important to note', 'navigating the'];

/** Humanisation pass: keep keywords >= minCount, kill AI patterns, keep length. */
async function humanize({ markdown, targetWC, supportingKeywords, primaryKeyword, failedKeywords }) {
  const prompt = [
    BRAND_CONTEXT, '',
    'TASK: Rewrite the blog below so it reads like an experienced Hyderabad property consultant wrote it — not an AI.',
    'HARD RULES:',
    '- Keep total length within +/-10% of ' + targetWC + ' words.',
    '- Vary sentence length: mix short punchy sentences with longer ones. Use contractions sometimes.',
    '- Concrete and local beats abstract: name roads, commute realities, buyer situations.',
    '- Delete these AI cliches entirely: ' + AI_CLICHES.join(', ') + '.',
    '- Keep every heading, table, FAQ question, and link.',
    '- KEYWORD COUNTS ARE CONTRACTUAL. "' + primaryKeyword + '" and each of these must keep at least their minimum occurrences:',
    supportingKeywords.map(k => `  - "${k.keyword}" >= ${k.minCount}`).join('\n'),
    failedKeywords && failedKeywords.length ? 'THESE ARE CURRENTLY UNDER COUNT — add natural mentions: ' + failedKeywords.map(f => `"${f.keyword}" needs ${f.needed} more`).join(', ') : '',
    '- Never stuff: no keyword sequence repeated in the same sentence twice.',
    '',
    'OUTPUT strict JSON only: {"markdown_body":""}',
    '',
    'BLOG TO REWRITE:', '---', markdown
  ].filter(Boolean).join('\n');
  return parseJson(await gemini(prompt, { temperature: 0.8 }));
}

/** Generate specific LLM-style search queries from the nichest keywords (AEO). */
async function llmQueriesFor(nicheKeywords, corridor) {
  const prompt = [
    'For a Hyderabad real-estate blog, generate the exact questions a person would type into an AI assistant',
    '(ChatGPT/Gemini/Perplexity) for each keyword below. The more specific the better: include location',
    (corridor ? `(${corridor} / West Hyderabad)` : '(West Hyderabad)') + ', year 2026, configuration, and buyer situation where natural.',
    `Give ${CFG.AEO_QUERIES_PER_KEYWORD} question(s) per keyword. Questions must be answerable factually by a blog (no personal data).`,
    '',
    'KEYWORDS:',
    nicheKeywords.map(k => '- ' + k).join('\n'),
    '',
    'OUTPUT strict JSON only: {"queries":["question1","question2",...]}'
  ].join('\n');
  const out = parseJson(await gemini(prompt, { temperature: 0.6 }));
  return (out.queries || []).slice(0, CFG.AEO_NICHE_KEYWORDS * CFG.AEO_QUERIES_PER_KEYWORD);
}

module.exports = { gemini, parseJson, draftBlog, draftLinkedIn, humanize, llmQueriesFor, AI_CLICHES };
