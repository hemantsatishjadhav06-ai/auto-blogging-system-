'use strict';
/**
 * Site generation — attaches the backend to the frontend:
 *   - /blog/index.html : the blog listing page, rebuilt from Master_Blogs on every
 *     publish, so the website always reflects the panel/sheet status.
 *   - /blog/status.json : machine-readable feed of published posts (the frontend,
 *     the Master Hub, and any script can poll this to see edits/status).
 * Both are included in every Netlify digest deploy alongside the post pages.
 * Brand: navy #081d4a / white (www.neopolisinfra.com).
 */

const CFG = require('./config');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** rows: Master_Blogs rows with Status=Published (plus URL, title, keyword, date). */
function buildStatusJson(rows) {
  return JSON.stringify({
    site: CFG.SITE_URL,
    updated: new Date().toISOString(),
    posts: rows.map(r => ({
      si: r['SI'], title: r['Blog Title'], keyword: r['Primary Keyword'],
      date: r['Date'], url: r['Blog URL'] || '', doc: r['Doc Link'] || '',
      words: r['Actual WC'] || '', alignment: r['Word Alignment %'] || '',
      status: r['Status'] || ''
    }))
  }, null, 1);
}

function buildBlogIndex(rows) {
  const cards = rows.map(r => {
    const url = String(r['Blog URL'] || '#');
    return `<a class="card" href="${esc(url)}">
      <div class="tag">${esc(r['Primary Keyword'] || 'Guide')}</div>
      <h2>${esc(r['Blog Title'])}</h2>
      <div class="meta">${esc(r['Date'] || '')}${r['Actual WC'] ? ' · ' + esc(r['Actual WC']) + ' words' : ''} · ${Math.max(3, Math.round((Number(r['Actual WC']) || 1500) / 220))} min read</div>
    </a>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blog — Neopolis Infra</title>
<meta name="description" content="Guides on landlord-share flats, West Hyderabad corridors, prices, and safe buying — from Neopolis Infra.">
<style>
:root{--navy:#081d4a;--bg:#ffffff;--ink:#15213a;--line:#e3e8f2;--mut:#5a6a85}
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--navy);color:#fff;padding:1rem 5vw;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem}
header .b{font-weight:700;letter-spacing:.6px}
header nav a{color:#cdd8ef;text-decoration:none;margin-left:1.1rem;font-size:.92rem}
.hero{background:var(--navy);color:#fff;padding:2.6rem 5vw 3rem}
.hero h1{font-size:clamp(1.6rem,3.5vw,2.4rem)}
.hero p{color:#b9c6e2;margin-top:.5rem;max-width:640px}
main{max-width:1050px;margin:-1.6rem auto 3rem;padding:0 5vw;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1rem}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:1.2rem;text-decoration:none;color:var(--ink);box-shadow:0 6px 18px rgba(8,29,74,.06);transition:transform .15s}
.card:hover{transform:translateY(-3px)}
.card .tag{font-size:.72rem;letter-spacing:1.2px;text-transform:uppercase;color:#3d5aa8;font-weight:700}
.card h2{font-size:1.05rem;line-height:1.4;margin:.5rem 0 .6rem;color:var(--navy)}
.card .meta{font-size:.82rem;color:var(--mut)}
footer{border-top:1px solid var(--line);padding:1.4rem 5vw;text-align:center;color:var(--mut);font-size:.85rem}
footer a{color:#3d5aa8}
</style></head><body>
<header><div class="b">NEOPOLIS INFRA</div>
<nav><a href="${esc(CFG.SITE_URL)}/">Home</a><a href="${esc(CFG.SITE_URL)}/projects">Projects</a><a href="${esc(CFG.SITE_URL)}/contact">Contact</a></nav></header>
<div class="hero"><h1>Insights &amp; Buyer Guides</h1>
<p>Landlord-share flats, West Hyderabad corridors, prices, and how to buy safely — researched and updated regularly.</p></div>
<main>
${cards || '<p>New guides are on the way.</p>'}
</main>
<footer>© Neopolis Infra · <a href="${esc(CFG.SITE_URL)}">${esc(CFG.SITE_URL.replace('https://', ''))}</a> · Information is general guidance, not legal or investment advice.</footer>
</body></html>`;
}

module.exports = { buildBlogIndex, buildStatusJson };
