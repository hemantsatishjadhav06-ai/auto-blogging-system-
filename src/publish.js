'use strict';
/**
 * PUBLISH — blog to Netlify (github commit | netlify api file-deploy | dry_run)
 * and LinkedIn (API post if token set, else 'ready in Doc').
 */

const crypto = require('crypto');
const CFG = require('./config');
const U = require('./util');
const GS = require('./gsheets');
const GD = require('./gdocs');
const IMG = require('./images');
const SITE = require('./sitegen');

/** Parse the L2 'Images' cell back into [{role, url, driveUrl}]. */
function parseImagesCell(cell) {
  return String(cell || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\w+):\s*(\S+)(?:\s*\|\s*drive:\s*(\S+))?$/);
    return m ? { role: m[1], url: m[2], driveUrl: m[3] || '' } : null;
  }).filter(Boolean);
}

/** Insert hero/infographic/enhanced figures into the article HTML. */
function injectImages(bodyHtml, images, srcFor) {
  if (!images.length) return bodyHtml;
  const fig = (img, cap) => `\n<figure style="margin:1.6rem 0"><img src="${srcFor(img)}" alt="${cap}" style="width:100%;border-radius:10px" loading="lazy"><figcaption style="font-size:.85rem;color:#6b7a72;font-family:Helvetica,Arial,sans-serif;margin-top:.4rem">${cap}</figcaption></figure>`;
  let out = bodyHtml;
  const hero = images.find(i => i.role === 'hero');
  const info = images.find(i => i.role === 'infographic');
  const enh = images.find(i => i.role === 'enhanced');
  if (hero) {
    const h1End = out.indexOf('</h1>');
    const at = h1End > -1 ? h1End + 5 : 0;
    out = out.slice(0, at) + fig(hero, 'Cover: the story at a glance') + out.slice(at);
  }
  const h2s = [...out.matchAll(/<h2>/g)].map(m => m.index);
  if (info && h2s.length >= 2) {
    const at = h2s[Math.min(1, h2s.length - 1)];
    out = out.slice(0, at) + fig(info, 'Explained visually') + out.slice(at);
  }
  if (enh) {
    const faqAt = out.search(/<h2>[^<]*question/i);
    const at = faqAt > -1 ? faqAt : out.length;
    out = out.slice(0, at) + fig(enh, 'The key idea, in detail') + out.slice(at);
  }
  return out;
}

async function runPublish() {
  await GS.ensureTabs();
  const l2 = await GS.readTab('L2_Topics');
  const ready = l2.rows.filter(r =>
    String(r['Status']) === 'QA Passed' && String(r['Approval']).toLowerCase() === 'approved');
  const results = [];
  for (const row of ready) {
    try { results.push(await publishOne(row, l2.headers)); }
    catch (e) {
      console.error('[publish] failed "' + row['Topic'] + '": ' + e.message);
      await GS.updateRow('L2_Topics', l2.headers, row._row, { 'Status': 'Publish Error' });
      results.push({ topic: row['Topic'], error: e.message });
    }
  }
  console.log('[publish]', JSON.stringify(results));
  return results;
}

async function publishOne(row, headers) {
  const docId = (String(row['Doc Link']).match(/\/document\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  const { blog, linkedin } = await GD.readLatestContent(docId);
  const slug = U.slugify(row['Topic']);
  const llmQueries = String(row['LLM Queries'] || '').split('|').map(s => s.trim()).filter(Boolean);
  const images = parseImagesCell(row['Images']);

  let blogUrl;
  if (CFG.PUBLISH_MODE === 'github') blogUrl = await publishGithub(slug, row, blog, llmQueries, images);
  else if (CFG.PUBLISH_MODE === 'netlify_api') blogUrl = await publishNetlifyApi(slug, row, blog, llmQueries, images);
  else blogUrl = '[DRY RUN] ' + CFG.SITE_URL.replace(/\/+$/, '') + CFG.BLOG_BASE_PATH + '/' + slug;

  // ---- LinkedIn ----
  let liStatus = 'Article ready in Doc (paste to LinkedIn)';
  let liNote = row['Doc Link'];
  if (CFG.LINKEDIN_ACCESS_TOKEN && CFG.LINKEDIN_AUTHOR_URN) {
    try {
      const postText = extractLinkedInPost(linkedin) || (String(row['Topic']) + '\n\nFull guide: ' + blogUrl.replace('[DRY RUN] ', ''));
      const id = await linkedinPost(postText);
      liStatus = 'Posted via API'; liNote = id;
    } catch (e) { liStatus = 'API post failed: ' + e.message.slice(0, 80); }
  }

  await GS.appendRows('Published', [[U.todayISO(), row['Topic'], blogUrl, liStatus, liNote, row['Doc Link']]]);
  await GS.updateRow('L2_Topics', headers, row._row, { 'Status': 'Published' });

  // reflect the live URL on the Master_Blogs row
  try {
    const master = await GS.readTab('Master_Blogs');
    const m = master.rows.find(r => String(r['Primary Keyword']).toLowerCase() === String(row['Primary Keyword']).toLowerCase());
    if (m) await GS.updateRow('Master_Blogs', master.headers, m._row, { 'Status': 'Published', 'Blog URL': blogUrl });
  } catch (e) { console.warn('[publish] master update skipped: ' + e.message); }

  return { topic: row['Topic'], blogUrl, linkedin: liStatus };
}

// ---------- HTML page build (for netlify_api mode) ----------
function buildHtml(row, markdown, llmQueries, images = [], srcFor = (i) => i.url) {
  const faq = faqFromMarkdown(markdown, llmQueries);
  const jsonld = faq.length ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  } : null;
  let body = '<h1>' + esc(row['Topic']) + '</h1>\n' + mdToHtml(markdown);
  body = injectImages(body, images, srcFor);
  return ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(row['Topic'])}</title>`,
    `<meta name="description" content="${esc(String(row['Topic']).slice(0, 150))}">`,
    `<link rel="canonical" href="${CFG.SITE_URL.replace(/\/+$/, '')}${CFG.BLOG_BASE_PATH}/${U.slugify(row['Topic'])}">`,
    jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : '',
    '<style>body{font-family:Georgia,serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1c2b26}h1,h2,h3{font-family:Helvetica,Arial,sans-serif;color:#0b3d2e}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cfe0d8;padding:8px}a{color:#0b6e4f}</style>',
    '</head><body>', body,
    `<hr><p><a href="${CFG.SITE_URL}">&larr; ${CFG.BRAND}</a></p>`,
    '</body></html>'].join('\n');
}

/** Extract Q&A pairs for FAQPage JSON-LD: H3 questions followed by their paragraph. */
function faqFromMarkdown(md, llmQueries) {
  const out = [];
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^###\s+(.+?)\s*$/);
    if (!h) continue;
    const q = h[1].replace(/\*\*/g, '').trim();
    const isQuestion = /\?$/.test(q) || llmQueries.some(x => x.toLowerCase().slice(0, 40) === q.toLowerCase().slice(0, 40));
    if (!isQuestion) continue;
    let a = '';
    for (let j = i + 1; j < lines.length && !/^#{2,3}\s/.test(lines[j]); j++) a += lines[j] + ' ';
    a = a.replace(/[#*|>`]/g, '').replace(/\s+/g, ' ').trim();
    if (a) out.push({ q, a: a.slice(0, 600) });
  }
  return out.slice(0, 10);
}

/** Minimal markdown -> HTML (headings, bold, links, lists, tables, paragraphs). */
function mdToHtml(md) {
  const lines = String(md).split('\n');
  const out = []; let inList = false, inTable = false;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // separator
      if (!inTable) { out.push('<table>'); inTable = true; }
      const cells = line.split('|').slice(1, -1).map(c => '<td>' + inline(c.trim()) + '</td>').join('');
      out.push('<tr>' + cells + '</tr>');
      continue;
    } else if (inTable) { out.push('</table>'); inTable = false; }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.replace(/^[-*]\s+/, '')) + '</li>');
      continue;
    } else if (inList && line !== '') { out.push('</ul>'); inList = false; }
    else if (inList && line === '') { out.push('</ul>'); inList = false; continue; }
    if (/^###\s/.test(line)) out.push('<h3>' + inline(line.replace(/^###\s+/, '')) + '</h3>');
    else if (/^##\s/.test(line)) out.push('<h2>' + inline(line.replace(/^##\s+/, '')) + '</h2>');
    else if (/^#\s/.test(line)) out.push('<h1>' + inline(line.replace(/^#\s+/, '')) + '</h1>');
    else if (/^\d+\.\s/.test(line)) out.push('<p>' + inline(line) + '</p>');
    else if (line === '') out.push('');
    else out.push('<p>' + inline(line) + '</p>');
  }
  if (inList) out.push('</ul>');
  if (inTable) out.push('</table>');
  return out.filter(x => x !== '').join('\n');
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ---------- GitHub mode ----------
async function publishGithub(slug, row, markdown, llmQueries, images = []) {
  // images referenced remotely (Drive/fal URLs) in markdown front-matter body
  if (images.length) {
    const imgMd = images.map(i => `![${i.role}](${i.driveUrl || i.url})`).join('\n\n');
    markdown = imgMd.split('\n\n')[0] + '\n\n' + markdown + '\n\n' + imgMd.split('\n\n').slice(1).join('\n\n');
  }
  if (!CFG.GITHUB_TOKEN || !CFG.GITHUB_OWNER || !CFG.GITHUB_REPO) throw new Error('GitHub env vars missing');
  const fm = ['---',
    `title: "${String(row['Topic']).replace(/"/g, "'")}"`,
    `description: "${String(row['Topic']).replace(/"/g, "'")}"`,
    `slug: "${slug}"`, `date: "${U.todayISO()}"`,
    `keyword: "${row['Primary Keyword']}"`, 'category: "Blog"', 'draft: false', '---', ''].join('\n');
  const content = fm + markdown;
  const path = CFG.GITHUB_CONTENT_DIR.replace(/^\/+|\/+$/g, '') + '/' + slug + '.md';
  const api = `https://api.github.com/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: 'Bearer ' + CFG.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'neopolis-autoblog' };
  let sha = null;
  const cur = await U.httpFetch(api + '?ref=' + CFG.GITHUB_BRANCH, { headers }, 1);
  if (cur.code === 200) { try { sha = JSON.parse(cur.text).sha; } catch (e) {} }
  const payload = { message: 'auto-blog: ' + slug, content: Buffer.from(content, 'utf8').toString('base64'), branch: CFG.GITHUB_BRANCH };
  if (sha) payload.sha = sha;
  const res = await U.httpFetch(api, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 3);
  if (res.code !== 200 && res.code !== 201) throw new Error('GitHub HTTP ' + res.code + ': ' + res.text.slice(0, 200));
  return CFG.SITE_URL.replace(/\/+$/, '') + CFG.BLOG_BASE_PATH + '/' + slug;
}

// ---------- Netlify API file-deploy mode (no git repo needed) ----------
async function publishNetlifyApi(slug, row, markdown, llmQueries, images = []) {
  if (!CFG.NETLIFY_TOKEN) throw new Error('NETLIFY_TOKEN not set');
  const base = `${CFG.BLOG_BASE_PATH}/${slug}`.replace(/^\/+/, '/');
  const headers = { Authorization: 'Bearer ' + CFG.NETLIFY_TOKEN, 'Content-Type': 'application/json' };

  // 0) download image bytes; images are hosted on the site itself
  const assets = [];
  for (const img of images) {
    try {
      const { buf, contentType } = await IMG.fetchImageBytes(img.url);
      const ext = /png/.test(contentType) ? 'png' : 'jpg';
      assets.push({ img, path: `${base}/img-${img.role}.${ext}`, buf });
    } catch (e) { console.warn('[publish] image fetch failed (' + img.role + '): ' + e.message); }
  }
  const localSrc = (img) => {
    const a = assets.find(x => x.img.role === img.role);
    return a ? a.path.split('/').pop() : img.url; // relative within the post folder
  };
  const html = buildHtml(row, markdown, llmQueries, images, localSrc);
  const newPath = `${base}/index.html`;

  // 1) current files (path -> sha1) so the deploy KEEPS the whole existing site
  const filesRes = await U.httpFetch(`https://api.netlify.com/api/v1/sites/${CFG.NETLIFY_SITE_ID}/files`, { headers }, 2);
  if (filesRes.code !== 200) throw new Error('Netlify files HTTP ' + filesRes.code);
  const files = {};
  for (const f of JSON.parse(filesRes.text)) files[f.path] = f.sha;

  // 2) add / replace our page + image assets
  const uploads = [{ path: newPath, body: html, sha: crypto.createHash('sha1').update(html, 'utf8').digest('hex') }];
  for (const a of assets) uploads.push({ path: a.path, body: a.buf, sha: crypto.createHash('sha1').update(a.buf).digest('hex') });

  // 2b) frontend attachment: regenerate the blog index + status feed from the Master
  //     sheet on every publish, so the website always mirrors the panel/sheet state.
  try {
    const master = await GS.readTab('Master_Blogs');
    const published = master.rows.filter(r => String(r['Status']) === 'Published' && r['Blog Title'])
      .concat([{ 'SI': row['SI'], 'Blog Title': row['Topic'], 'Primary Keyword': row['Primary Keyword'], 'Date': U.todayISO(), 'Blog URL': CFG.SITE_URL.replace(/\/+$/, '') + CFG.BLOG_BASE_PATH + '/' + slug, 'Actual WC': row['Actual WC'] || '' }])
      .filter((r, i, arr) => arr.findIndex(x => String(x['Blog Title']) === String(r['Blog Title'])) === i)
      .sort((a, b) => String(b['Date']).localeCompare(String(a['Date'])));
    const indexHtml = SITE.buildBlogIndex(published);
    const statusJson = SITE.buildStatusJson(published);
    uploads.push({ path: `${CFG.BLOG_BASE_PATH}/index.html`.replace(/^\/+/, '/'), body: indexHtml, sha: crypto.createHash('sha1').update(indexHtml, 'utf8').digest('hex') });
    uploads.push({ path: `${CFG.BLOG_BASE_PATH}/status.json`.replace(/^\/+/, '/'), body: statusJson, sha: crypto.createHash('sha1').update(statusJson, 'utf8').digest('hex') });
  } catch (e) { console.warn('[publish] blog index regen skipped: ' + e.message); }

  for (const u of uploads) files[u.path] = u.sha;

  // 3) create deploy with the full digest
  const depRes = await U.httpFetch(`https://api.netlify.com/api/v1/sites/${CFG.NETLIFY_SITE_ID}/deploys`, {
    method: 'POST', headers, body: JSON.stringify({ files })
  }, 2);
  if (depRes.code >= 300) throw new Error('Netlify deploy HTTP ' + depRes.code + ': ' + depRes.text.slice(0, 200));
  const dep = JSON.parse(depRes.text);

  // 4) upload only the required (new) files
  const required = new Set(dep.required || []);
  for (const u of uploads) {
    if (!required.has(u.sha)) continue;
    const up = await U.httpFetch(`https://api.netlify.com/api/v1/deploys/${dep.id}/files${u.path}`, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + CFG.NETLIFY_TOKEN, 'Content-Type': 'application/octet-stream' }, body: u.body
    }, 2);
    if (up.code >= 300) throw new Error('Netlify upload HTTP ' + up.code + ' for ' + u.path);
  }
  return CFG.SITE_URL.replace(/\/+$/, '') + CFG.BLOG_BASE_PATH + '/' + slug;
}

// ---------- LinkedIn ----------
function extractLinkedInPost(linkedinText) {
  const idx = String(linkedinText || '').indexOf('--- POST VERSION ---');
  if (idx === -1) return null;
  return linkedinText.slice(idx + '--- POST VERSION ---'.length).trim().slice(0, 2900);
}

async function linkedinPost(text) {
  const res = await U.httpFetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + CFG.LINKEDIN_ACCESS_TOKEN,
      'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author: CFG.LINKEDIN_AUTHOR_URN,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    })
  }, 2);
  if (res.code >= 300) throw new Error('LinkedIn HTTP ' + res.code + ': ' + res.text.slice(0, 150));
  try { return JSON.parse(res.text).id || 'posted'; } catch (e) { return 'posted'; }
}

module.exports = { runPublish, buildHtml, faqFromMarkdown, mdToHtml };
