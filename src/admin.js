'use strict';
/**
 * Neopolis Admin Backend — blog publish/status management + property (Projects) CRUD,
 * served by the same Render service. Auth: the RUN_TOKEN (entered once in the panel,
 * kept in localStorage, sent as x-run-token on every API call).
 *
 * Set MOCK_SHEETS=1 to run the panel against in-memory fixtures (local testing).
 */

const express = require('express');
const CFG = require('./config');
const GS = require('./gsheets');
const IMG = require('./images');

const router = express.Router();

// ---------- data access (real sheets, or mock fixtures for local testing) ----------
const MOCK = process.env.MOCK_SHEETS === '1';
const mockDB = {
  L2_Topics: { headers: ['SI', 'Topic', 'Primary Keyword', 'Supporting Keywords', 'Keyword Count', 'Repeated Words (competitors)', 'Target WC', 'Project', 'Project File Link', 'Doc Link', 'Images', 'LLM Queries', 'Risk', 'Approval', 'Status'],
    rows: [{ _row: 2, SI: 1, Topic: 'Flats in Narsingi for Sale: Prices, Options & Buyer Guide 2026', 'Primary Keyword': 'flats in narsingi for sale', 'Keyword Count': 15, 'Target WC': 2500, 'Doc Link': 'https://docs.google.com/document/d/x/edit', Images: 'infographic: https://example.com/i.png', Risk: 'money-page', Approval: 'Approved', Status: 'Published' },
           { _row: 3, SI: 2, Topic: 'Flats In Kokapet: What Buyers Should Know 2026', 'Primary Keyword': 'flats in kokapet', 'Keyword Count': 14, 'Target WC': 2500, 'Doc Link': '', Images: '', Risk: 'standard', Approval: 'Pending', Status: 'Drafted' }] },
  Master_Blogs: { headers: ['SI', 'Date', 'Blog Title', 'Primary Keyword', 'Target WC', 'Actual WC', 'Word Alignment %', 'WC Pass', 'Keywords Planned', 'Keywords Verified', 'Total Repetitions', 'Max Density %', 'Status', 'Blog URL', 'Doc Link', 'Images', 'Keyword Research', 'Keyword Audit Tab'],
    rows: [{ _row: 2, SI: 1, 'Blog Title': 'Flats in Narsingi for Sale: Prices, Options & Buyer Guide 2026', 'Primary Keyword': 'flats in narsingi for sale', 'Target WC': 2500, 'Actual WC': 2319, 'Word Alignment %': 93, 'Keywords Verified': '12/15', 'Total Repetitions': 125, Status: 'Published', 'Blog URL': CFG.SITE_URL + '/blog/flats-in-narsingi-for-sale-buyer-guide' }] },
  Projects: { headers: ['Project Name', 'Corridor', 'Configurations', 'Size Range', 'Price Band', 'USP / Details', 'Brochure/File Link', 'Status'],
    rows: [{ _row: 2, 'Project Name': 'Neopolis Narsingi – Landlord Shares', Corridor: 'Narsingi', Configurations: '3 & 4 BHK', 'Size Range': '1400-3950 sqft', 'Price Band': 'from ~Rs 1.10 Cr', 'USP / Details': 'Landlord share, one-time payment', 'Brochure/File Link': '', Status: 'Active' }] },
  L3_QA: { headers: ['Topic', 'Target WC', 'Actual WC', 'WC Pass', 'Keywords Planned', 'Keywords Verified', 'Failed Keywords', 'Max Density %', 'Density Pass', 'Humanised', 'Notes', 'Overall', 'Date'],
    rows: [{ _row: 2, Topic: 'Flats in Narsingi for Sale: Prices, Options & Buyer Guide 2026', 'Target WC': 2500, 'Actual WC': 2319, 'WC Pass': 'PASS', 'Keywords Verified': '12/15', Overall: 'NEEDS REVIEW', Date: '2026-08-21' }] }
};

async function readTab(tab) {
  if (MOCK) return JSON.parse(JSON.stringify(mockDB[tab] || { headers: [], rows: [] }));
  return GS.readTab(tab);
}
async function updateRow(tab, headers, rowNumber, patch) {
  if (MOCK) {
    const t = mockDB[tab]; const r = t.rows.find(x => x._row === rowNumber);
    if (r) Object.assign(r, patch);
    return;
  }
  return GS.updateRow(tab, headers, rowNumber, patch);
}
async function appendRows(tab, rows) {
  if (MOCK) { rows.forEach(r => mockDB[tab].rows.push({ _row: mockDB[tab].rows.length + 2, ...Object.fromEntries(mockDB[tab].headers.map((h, i) => [h, r[i]])) })); return; }
  return GS.appendRows(tab, rows);
}

// ---------- API ----------
router.get('/api/overview', async (req, res) => {
  try {
    const [l2, master, projects, qa] = await Promise.all([readTab('L2_Topics'), readTab('Master_Blogs'), readTab('Projects'), readTab('L3_QA')]);
    const by = (s) => l2.rows.filter(r => String(r['Status']) === s).length;
    res.json({
      blogs: { total: l2.rows.filter(r => r['Topic']).length, drafted: by('Drafted'), qaPassed: by('QA Passed'), needsReview: by('Needs Review'), published: by('Published') },
      awaitingApproval: l2.rows.filter(r => String(r['Approval']) === 'Pending' && r['Topic']).length,
      projects: projects.rows.filter(r => r['Project Name']).length,
      lastQA: qa.rows.slice(-5).reverse(),
      site: CFG.SITE_URL, sheet: 'https://docs.google.com/spreadsheets/d/' + CFG.SHEET_ID
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/blogs', async (req, res) => {
  try {
    const [l2, master] = await Promise.all([readTab('L2_Topics'), readTab('Master_Blogs')]);
    const mByKw = {}; master.rows.forEach(m => { mByKw[String(m['Primary Keyword']).toLowerCase()] = m; });
    const blogs = l2.rows.filter(r => r['Topic']).map(r => {
      const m = mByKw[String(r['Primary Keyword']).toLowerCase()] || {};
      return {
        row: r._row, si: r['SI'], topic: r['Topic'], keyword: r['Primary Keyword'],
        keywords: r['Keyword Count'] || '', targetWC: r['Target WC'], actualWC: m['Actual WC'] || '',
        alignment: m['Word Alignment %'] || '', verified: m['Keywords Verified'] || '', repetitions: m['Total Repetitions'] || '',
        risk: r['Risk'], approval: r['Approval'], status: r['Status'],
        doc: r['Doc Link'] || '', url: m['Blog URL'] || '', images: String(r['Images'] || '').split('\n').filter(Boolean)
      };
    });
    res.json({ blogs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/blogs/:row/status', async (req, res) => {
  try {
    const rowNumber = Number(req.params.row);
    const { approval, status } = req.body || {};
    const l2 = await readTab('L2_Topics');
    const target = l2.rows.find(r => r._row === rowNumber);
    if (!target) return res.status(404).json({ error: 'blog row not found' });
    const patch = {};
    if (approval && ['Approved', 'Pending', 'Rejected'].includes(approval)) patch['Approval'] = approval;
    if (status && ['Drafted', 'QA Passed', 'Needs Review', 'Published', 'Archived'].includes(status)) patch['Status'] = status;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    await updateRow('L2_Topics', l2.headers, rowNumber, patch);
    res.json({ ok: true, row: rowNumber, patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/blogs/:row/publish', async (req, res) => {
  try {
    const rowNumber = Number(req.params.row);
    const l2 = await readTab('L2_Topics');
    const target = l2.rows.find(r => r._row === rowNumber);
    if (!target) return res.status(404).json({ error: 'blog row not found' });
    await updateRow('L2_Topics', l2.headers, rowNumber, { 'Approval': 'Approved', 'Status': 'QA Passed' });
    if (MOCK) { await updateRow('L2_Topics', l2.headers, rowNumber, { 'Status': 'Published' }); return res.json({ ok: true, mock: true }); }
    const { runPublish } = require('./publish');
    const result = await runPublish();
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/projects', async (req, res) => {
  try {
    const p = await readTab('Projects');
    res.json({ headers: p.headers, projects: p.rows.filter(r => r['Project Name']).map(r => ({ row: r._row, ...r })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/projects', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.corridor) return res.status(400).json({ error: 'name and corridor required' });
    await appendRows('Projects', [[b.name, b.corridor, b.configurations || '', b.sizeRange || '', b.priceBand || '', b.usp || '', b.brochure || '', b.status || 'Active']]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/projects/:row', async (req, res) => {
  try {
    const rowNumber = Number(req.params.row);
    const p = await readTab('Projects');
    if (!p.rows.find(r => r._row === rowNumber)) return res.status(404).json({ error: 'project not found' });
    const map = { name: 'Project Name', corridor: 'Corridor', configurations: 'Configurations', sizeRange: 'Size Range', priceBand: 'Price Band', usp: 'USP / Details', brochure: 'Brochure/File Link', status: 'Status' };
    const patch = {};
    for (const [k, col] of Object.entries(map)) if (req.body && req.body[k] !== undefined) patch[col] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    await updateRow('Projects', p.headers, rowNumber, patch);
    res.json({ ok: true, patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/blogs/:row/images', async (req, res) => {
  try {
    if (MOCK) return res.json({ ok: true, mock: true, images: ['hero: https://example.com/new-hero.png'] });
    const rowNumber = Number(req.params.row);
    const l2 = await readTab('L2_Topics');
    const target = l2.rows.find(r => r._row === rowNumber);
    if (!target) return res.status(404).json({ error: 'blog row not found' });
    const images = await IMG.generateBlogImages({
      title: target['Topic'], primaryKeyword: target['Primary Keyword'],
      openingSummary: req.body && req.body.summary, seq: Number(req.body && req.body.styleSeq) || Number(target['SI']) || 0
    });
    const cell = images.map(i => `${i.role}: ${i.url}${i.driveUrl ? ' | drive: ' + i.driveUrl : ''}`).join('\n');
    await updateRow('L2_Topics', l2.headers, rowNumber, { 'Images': cell });
    res.json({ ok: true, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/qa', async (req, res) => {
  try { const qa = await readTab('L3_QA'); res.json({ qa: qa.rows.filter(r => r['Topic']).reverse() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Content editing (frontend <-> backend <-> sheet, in parallel) ----------
let mockDocText = '## Sample section\n\nMock blog content for local testing. Narsingi flats guide body text.';

router.get('/api/blogs/:row/content', async (req, res) => {
  try {
    const rowNumber = Number(req.params.row);
    const l2 = await readTab('L2_Topics');
    const target = l2.rows.find(r => r._row === rowNumber);
    if (!target) return res.status(404).json({ error: 'blog row not found' });
    if (MOCK) return res.json({ topic: target['Topic'], markdown: mockDocText });
    const GD = require('./gdocs');
    const docId = (String(target['Doc Link']).match(/\/document\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!docId) return res.status(400).json({ error: 'no Doc linked on this blog' });
    const { blog } = await GD.readLatestContent(docId);
    res.json({ topic: target['Topic'], markdown: blog });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Save an edit. Writes go in PARALLEL to every store:
 *  - Google Doc: appended as an "EDITED vN" revision (publisher reads the latest)
 *  - L2_Topics: title + status -> QA Passed (ready to republish)
 *  - Master_Blogs: title + recounted Actual WC + alignment
 * If the blog was already Published, the panel offers "Republish" to push the edit live.
 */
router.post('/api/blogs/:row/content', async (req, res) => {
  try {
    const rowNumber = Number(req.params.row);
    const { markdown, title } = req.body || {};
    if (!markdown || String(markdown).trim().length < 50) return res.status(400).json({ error: 'markdown body required (min 50 chars)' });
    const l2 = await readTab('L2_Topics');
    const target = l2.rows.find(r => r._row === rowNumber);
    if (!target) return res.status(404).json({ error: 'blog row not found' });

    const U = require('./util');
    const actualWC = U.wordCount(String(markdown).replace(/[#*|>`\-]/g, ' '));
    const newTitle = title && String(title).trim() ? String(title).trim() : target['Topic'];

    if (MOCK) { mockDocText = markdown; }
    else {
      const GD = require('./gdocs');
      const docId = (String(target['Doc Link']).match(/\/document\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
      if (!docId) return res.status(400).json({ error: 'no Doc linked on this blog' });
      await GD.appendRevision(docId, 'EDITED v' + Date.now().toString().slice(-5), markdown, '');
    }

    // parallel sheet updates
    await updateRow('L2_Topics', l2.headers, rowNumber, { 'Topic': newTitle, 'Status': 'QA Passed' });
    try {
      const master = await readTab('Master_Blogs');
      const m = master.rows.find(r => String(r['Primary Keyword']).toLowerCase() === String(target['Primary Keyword']).toLowerCase());
      if (m) {
        const targetWC = Number(m['Target WC']) || Number(target['Target WC']) || 0;
        await updateRow('Master_Blogs', master.headers, m._row, {
          'Blog Title': newTitle, 'Actual WC': actualWC,
          'Word Alignment %': targetWC ? Math.round(100 * actualWC / targetWC) : '',
          'Status': 'Edited — republish pending'
        });
      }
    } catch (e) { console.warn('[admin] master sync skipped: ' + e.message); }

    res.json({ ok: true, actualWC, title: newTitle, next: 'Use Publish/Republish to push the edit to the website.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Master Hub ----------
const state = require('./state');

router.get('/api/hub/health', async (req, res) => {
  const checks = [];
  const add = (name, ok, note) => checks.push({ name, ok: !!ok, note: note || '' });
  // integrations (config presence + live probes where cheap)
  try { await readTab('Config'); add('Google Sheets (state)', true, MOCK ? 'mock mode' : 'read OK'); }
  catch (e) { add('Google Sheets (state)', false, e.message.slice(0, 90)); }
  add('Google Docs/Drive (content)', MOCK || !!(CFG.GOOGLE_OAUTH_REFRESH_TOKEN || CFG.GOOGLE_SERVICE_ACCOUNT_JSON), CFG.GOOGLE_OAUTH_REFRESH_TOKEN ? 'OAuth' : (CFG.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service account' : 'auth missing'));
  add('Gemini (writer)', !!CFG.GEMINI_API_KEY, CFG.GEMINI_MODEL);
  add('fal.ai (images)', !!CFG.FAL_API_KEY, CFG.FAL_MODEL_TITLE);
  add('Google Search (SERP)', !!(CFG.SEARCH_API_KEY && CFG.SEARCH_ENGINE_ID), 'budget left today: ' + require('./sources').serpBudgetRemaining());
  add('Netlify (website)', CFG.PUBLISH_MODE !== 'netlify_api' || !!CFG.NETLIFY_TOKEN, 'mode: ' + CFG.PUBLISH_MODE);
  add('Email reports', !!CFG.NOTIFY_EMAIL, CFG.NOTIFY_EMAIL + (CFG.GOOGLE_OAUTH_REFRESH_TOKEN ? '' : ' (needs OAuth)'));
  res.json({
    checks,
    running: state.running, lastRun: state.lastRun,
    uptimeMin: Math.round((Date.now() - state.startedAt) / 60000),
    links: {
      website: CFG.SITE_URL, blog: CFG.SITE_URL + CFG.BLOG_BASE_PATH,
      statusFeed: CFG.SITE_URL + CFG.BLOG_BASE_PATH + '/status.json',
      sheet: 'https://docs.google.com/spreadsheets/d/' + CFG.SHEET_ID,
      driveFolder: CFG.DRIVE_FOLDER_ID ? 'https://drive.google.com/drive/folders/' + CFG.DRIVE_FOLDER_ID : ''
    }
  });
});

router.post('/api/hub/run/:stage', async (req, res) => {
  const stageName = req.params.stage;
  const map = MOCK
    ? { layer1: async () => ({ mock: true }), layer2: async () => ({ mock: true }), layer3: async () => ({ mock: true }), publish: async () => ({ mock: true }) }
    : { layer1: () => require('./layer1').runLayer1({}), layer2: () => require('./layer2').runLayer2({}), layer3: () => require('./layer3').runLayer3(), publish: () => require('./publish').runPublish() };
  if (!map[stageName]) return res.status(400).json({ error: 'unknown stage' });
  if (state.running) return res.status(409).json({ error: 'a run is already in progress' });
  state.running = true;
  try { const result = await map[stageName](); res.json({ ok: true, stage: stageName, result }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { state.running = false; state.lastRun = { name: stageName, at: new Date().toISOString() }; }
});

// ---------- Panel (single file, Neopolis brand: navy #081d4a + white) ----------
router.get('/', (req, res) => { res.type('html').send(PANEL_HTML); });

const PANEL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neopolis Admin</title>
<style>
:root{--navy:#081d4a;--navy2:#0f2c6b;--bg:#f6f8fb;--ink:#15213a;--line:#dfe5ef;--ok:#1e7a4f;--warn:#a3620a;--bad:#a3341e;--chip:#eef2f9}
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--navy);color:#fff;padding:.9rem 4vw;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
header .b{font-weight:700;letter-spacing:.6px}
header .b span{opacity:.65;font-weight:400}
nav{display:flex;gap:.4rem;flex-wrap:wrap}
nav button{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;padding:.4rem .9rem;border-radius:99px;cursor:pointer;font-size:.85rem}
nav button.on{background:#fff;color:var(--navy);font-weight:600}
main{max-width:1100px;margin:1.4rem auto;padding:0 4vw}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem;margin-bottom:1.4rem}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding: .9rem 1rem}
.card .n{font-size:1.7rem;font-weight:700;color:var(--navy)}
.card .l{font-size:.8rem;color:#5a6a85;text-transform:uppercase;letter-spacing:.7px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:.9rem}
th{background:var(--navy);color:#fff;text-align:left;padding:.6rem .7rem;font-weight:600;font-size:.8rem;letter-spacing:.4px}
td{padding:.55rem .7rem;border-top:1px solid var(--line);vertical-align:top}
.chip{display:inline-block;background:var(--chip);border-radius:99px;padding:.15rem .6rem;font-size:.78rem;font-weight:600}
.chip.Published{color:var(--ok)}.chip.Drafted{color:#3b4a6b}.chip[data-s="QA Passed"]{color:var(--ok)}.chip[data-s="Needs Review"]{color:var(--warn)}.chip.Pending{color:var(--warn)}.chip.Approved{color:var(--ok)}.chip.Rejected{color:var(--bad)}
button.act{background:var(--navy);color:#fff;border:0;border-radius:8px;padding:.35rem .7rem;cursor:pointer;font-size:.8rem;margin:.1rem .15rem .1rem 0}
button.act.ghost{background:#fff;color:var(--navy);border:1px solid var(--navy)}
button.act:disabled{opacity:.5;cursor:wait}
a{color:var(--navy2)}
#login{max-width:420px;margin:14vh auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:2rem;text-align:center}
#login input{width:100%;padding:.7rem;border:1px solid var(--line);border-radius:8px;margin:.9rem 0;font-size:1rem}
.row-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.5rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:.8rem;margin:.9rem 0}
.row-form input{padding:.5rem;border:1px solid var(--line);border-radius:8px;font-size:.85rem}
.muted{color:#5a6a85;font-size:.82rem}
#msg{position:fixed;bottom:1rem;right:1rem;background:var(--navy);color:#fff;padding:.6rem 1rem;border-radius:8px;display:none;max-width:70vw}
h2{margin:1.2rem 0 .6rem;color:var(--navy);font-size:1.05rem}
</style></head><body>
<div id="login"><h2 style="margin:0 0 .4rem">NEOPOLIS <span style="font-weight:400">Admin</span></h2>
<p class="muted">Enter the admin token (RUN_TOKEN) to continue.</p>
<input id="tok" type="password" placeholder="admin token"><br>
<button class="act" style="padding:.6rem 1.6rem" onclick="saveTok()">Sign in</button></div>

<div id="app" style="display:none">
<header><div class="b">NEOPOLIS <span>Admin</span></div>
<nav>
<button data-v="hub" class="on" onclick="show('hub',this)">Master Hub</button>
<button data-v="dash" onclick="show('dash',this)">Dashboard</button>
<button data-v="blogs" onclick="show('blogs',this)">Blogs</button>
<button data-v="projects" onclick="show('projects',this)">Properties</button>
<button data-v="qa" onclick="show('qa',this)">QA</button>
<button onclick="logout()" style="opacity:.7">Sign out</button>
</nav></header>
<main>
<section id="v-hub">
<h2>System health</h2><div id="hub-checks" class="cards"></div>
<h2>Pipeline controls</h2>
<div class="card" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
<button class="act" onclick="hubRun('layer1',this)">Run Layer 1 · Research</button>
<button class="act" onclick="hubRun('layer2',this)">Run Layer 2 · Write</button>
<button class="act" onclick="hubRun('layer3',this)">Run Layer 3 · QA</button>
<button class="act" onclick="hubRun('publish',this)">Publish</button>
<span class="muted" id="hub-state"></span>
</div>
<h2>Everything, one click away</h2><div id="hub-links" class="cards"></div>
</section>
<section id="v-dash" style="display:none"><div class="cards" id="cards"></div><h2>Latest QA</h2><div id="dashqa"></div></section>
<section id="v-blogs" style="display:none"><h2>Blog pipeline</h2><div id="blogs"></div></section>
<section id="v-projects" style="display:none"><h2>Add property</h2>
<div class="row-form">
<input id="p-name" placeholder="Project name *"><input id="p-corridor" placeholder="Corridor *">
<input id="p-config" placeholder="Configurations (e.g. 3 & 4 BHK)"><input id="p-size" placeholder="Size range">
<input id="p-price" placeholder="Price band"><input id="p-usp" placeholder="USP / details">
<input id="p-brochure" placeholder="Brochure link"><button class="act" onclick="addProject()">Add property</button>
</div>
<h2>Properties</h2><div id="projects"></div></section>
<section id="v-qa" style="display:none"><h2>QA history</h2><div id="qa"></div></section>
</main></div>
<div id="editor" style="display:none;position:fixed;inset:0;background:rgba(8,29,74,.55);z-index:9">
<div style="background:#fff;max-width:820px;margin:4vh auto;border-radius:14px;padding:1.3rem;max-height:88vh;overflow:auto">
<h2 style="margin-top:0">Edit blog <span class="muted" id="ed-row"></span></h2>
<input id="ed-title" style="width:100%;padding:.6rem;border:1px solid var(--line);border-radius:8px;font-size:1rem;margin:.4rem 0" placeholder="Title">
<textarea id="ed-md" style="width:100%;height:52vh;padding:.7rem;border:1px solid var(--line);border-radius:8px;font-family:ui-monospace,monospace;font-size:.85rem"></textarea>
<div class="muted" style="margin:.4rem 0">Saves to the Google Doc + updates the Sheet in parallel. Then use Publish/Republish to push it live on the website.</div>
<button class="act" onclick="saveEdit()">Save edit</button>
<button class="act ghost" onclick="$('editor').style.display='none'">Cancel</button>
</div></div>
<div id="msg"></div>
<script>
const $=id=>document.getElementById(id);
let TOKEN=localStorage.getItem('neo_admin_token')||'';
function saveTok(){TOKEN=$('tok').value.trim();localStorage.setItem('neo_admin_token',TOKEN);boot();}
function logout(){localStorage.removeItem('neo_admin_token');location.reload();}
function toast(t){const m=$('msg');m.textContent=t;m.style.display='block';setTimeout(()=>m.style.display='none',3500);}
async function api(path,opts={}){
  const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json','x-run-token':TOKEN,...(opts.headers||{})}});
  if(r.status===401){logout();throw new Error('bad token');}
  const j=await r.json(); if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j;
}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function show(v,btn){document.querySelectorAll('main > section').forEach(s=>s.style.display='none');$('v-'+v).style.display='';
document.querySelectorAll('nav button[data-v]').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');
({hub:loadHub,dash:loadDash,blogs:loadBlogs,projects:loadProjects,qa:loadQA})[v]();}
async function boot(){
  try{await api('/admin/api/overview');$('login').style.display='none';$('app').style.display='';loadHub();}
  catch(e){$('login').style.display='';$('app').style.display='none';if(TOKEN)toast('Sign-in failed: '+e.message);}
}
async function loadHub(){
  const h=await api('/admin/api/hub/health');
  $('hub-checks').innerHTML=h.checks.map(c=>'<div class="card"><div style="font-weight:700;color:'+(c.ok?'var(--ok)':'var(--bad)')+'">'+(c.ok?'● OK':'● ATTENTION')+'</div><div style="font-weight:600;margin:.2rem 0">'+esc(c.name)+'</div><div class="muted">'+esc(c.note)+'</div></div>').join('');
  $('hub-state').textContent=(h.running?'A run is in progress… ':'Idle. ')+(h.lastRun?('Last: '+h.lastRun.name+' @ '+h.lastRun.at.slice(0,16).replace('T',' ')):'No runs yet.')+' · Up '+h.uptimeMin+' min';
  const L=h.links;
  $('hub-links').innerHTML=[['Website',L.website],['Blog (frontend)',L.blog],['Live status feed',L.statusFeed],['Tracking Sheet',L.sheet],['Drive folder',L.driveFolder]].filter(x=>x[1])
    .map(([n,u])=>'<div class="card"><div class="l">'+n+'</div><div style="margin-top:.3rem;font-size:.85rem;word-break:break-all"><a href="'+u+'" target="_blank">'+u.replace('https://','')+'</a></div></div>').join('');
}
async function hubRun(stage,btn){btn.disabled=1;toast('Running '+stage+'…');
  try{const r=await api('/admin/api/hub/run/'+stage,{method:'POST',body:'{}'});toast(stage+' done');loadHub();}
  catch(e){toast(e.message);}finally{btn.disabled=0;}}
let edRow=null;
async function openEdit(row){
  try{const c=await api('/admin/api/blogs/'+row+'/content');edRow=row;$('ed-row').textContent='#'+row;$('ed-title').value=c.topic||'';$('ed-md').value=c.markdown||'';$('editor').style.display='block';}
  catch(e){toast(e.message);}
}
async function saveEdit(){
  try{const r=await api('/admin/api/blogs/'+edRow+'/content',{method:'POST',body:JSON.stringify({title:$('ed-title').value,markdown:$('ed-md').value})});
  $('editor').style.display='none';toast('Saved — '+r.actualWC+' words. '+r.next);loadBlogs();}
  catch(e){toast(e.message);}
}
async function loadDash(){
  const o=await api('/admin/api/overview');
  $('cards').innerHTML=[['Total blogs',o.blogs.total],['Drafted',o.blogs.drafted],['Awaiting approval',o.awaitingApproval],['QA passed',o.blogs.qaPassed],['Needs review',o.blogs.needsReview],['Published',o.blogs.published],['Properties',o.projects]]
    .map(([l,n])=>'<div class="card"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
  $('dashqa').innerHTML=qaTable(o.lastQA);
  $('cards').insertAdjacentHTML('beforeend','<div class="card"><div class="l">Links</div><div style="font-size:.85rem;margin-top:.3rem"><a href="'+o.site+'" target="_blank">Website</a><br><a href="'+o.sheet+'" target="_blank">Tracking sheet</a></div></div>');
}
async function loadBlogs(){
  const {blogs}=await api('/admin/api/blogs');
  $('blogs').innerHTML='<div style="overflow-x:auto"><table><tr><th>SI</th><th>Topic</th><th>Keyword</th><th>WC (actual/target)</th><th>Keywords ✓</th><th>Reps</th><th>Approval</th><th>Status</th><th>Links</th><th>Actions</th></tr>'+
  blogs.map(b=>'<tr><td>'+esc(b.si)+'</td><td style="max-width:260px">'+esc(b.topic)+'</td><td>'+esc(b.keyword)+'</td><td>'+esc(b.actualWC)+' / '+esc(b.targetWC)+(b.alignment?' ('+esc(b.alignment)+'%)':'')+'</td><td>'+esc(b.verified)+'</td><td>'+esc(b.repetitions)+'</td>'+
  '<td><span class="chip '+esc(b.approval)+'">'+esc(b.approval||'—')+'</span></td><td><span class="chip '+esc(b.status)+'" data-s="'+esc(b.status)+'">'+esc(b.status||'—')+'</span></td>'+
  '<td>'+(b.doc?'<a href="'+esc(b.doc)+'" target="_blank">Doc</a> ':'')+(b.url?'<a href="'+esc(b.url)+'" target="_blank">Live</a>':'')+'</td>'+
  '<td>'+(b.approval!=='Approved'?btn('Approve','setStatus('+b.row+',{approval:\\'Approved\\'})'):'')+
        btn(b.status==='Published'?'Republish':'Publish','publish('+b.row+')')+
        btn('Edit','openEdit('+b.row+')',1)+
        btn('Images ↻','regen('+b.row+')',1)+
        (b.approval!=='Rejected'?btn('Reject','setStatus('+b.row+',{approval:\\'Rejected\\'})',1):'')+'</td></tr>').join('')+'</table></div>';
}
function btn(t,fn,ghost){return '<button class="act'+(ghost?' ghost':'')+'" onclick="this.disabled=1;'+fn+'.finally(()=>this.disabled=0)">'+t+'</button>';}
async function setStatus(row,patch){try{await api('/admin/api/blogs/'+row+'/status',{method:'POST',body:JSON.stringify(patch)});toast('Updated');loadBlogs();}catch(e){toast(e.message);}}
async function publish(row){try{toast('Publishing…');await api('/admin/api/blogs/'+row+'/publish',{method:'POST',body:'{}'});toast('Published');loadBlogs();}catch(e){toast(e.message);}}
async function regen(row){try{toast('Generating images (fal.ai)…');const r=await api('/admin/api/blogs/'+row+'/images',{method:'POST',body:'{}'});toast('Images: '+r.images.length);loadBlogs();}catch(e){toast(e.message);}}
async function loadProjects(){
  const {projects}=await api('/admin/api/projects');
  $('projects').innerHTML='<div style="overflow-x:auto"><table><tr><th>Name</th><th>Corridor</th><th>Config</th><th>Size</th><th>Price band</th><th>USP</th><th>Status</th><th>Actions</th></tr>'+
  projects.map(p=>'<tr><td>'+esc(p['Project Name'])+'</td><td>'+esc(p['Corridor'])+'</td><td>'+esc(p['Configurations'])+'</td><td>'+esc(p['Size Range'])+'</td><td>'+esc(p['Price Band'])+'</td><td style="max-width:220px">'+esc(p['USP / Details'])+'</td>'+
  '<td><span class="chip">'+esc(p['Status']||'Active')+'</span></td>'+
  '<td>'+btn(String(p['Status']).toLowerCase()==='inactive'?'Activate':'Deactivate','toggleProject('+p.row+',\\''+(String(p['Status']).toLowerCase()==='inactive'?'Active':'Inactive')+'\\')',1)+'</td></tr>').join('')+'</table></div>';
}
async function toggleProject(row,status){try{await api('/admin/api/projects/'+row,{method:'PUT',body:JSON.stringify({status})});toast('Saved');loadProjects();}catch(e){toast(e.message);}}
async function addProject(){
  const b={name:$('p-name').value,corridor:$('p-corridor').value,configurations:$('p-config').value,sizeRange:$('p-size').value,priceBand:$('p-price').value,usp:$('p-usp').value,brochure:$('p-brochure').value};
  if(!b.name||!b.corridor)return toast('Name and corridor are required');
  try{await api('/admin/api/projects',{method:'POST',body:JSON.stringify(b)});toast('Property added');['p-name','p-corridor','p-config','p-size','p-price','p-usp','p-brochure'].forEach(i=>$(i).value='');loadProjects();}catch(e){toast(e.message);}
}
function qaTable(rows){return '<div style="overflow-x:auto"><table><tr><th>Date</th><th>Topic</th><th>WC</th><th>Keywords ✓</th><th>Overall</th></tr>'+
  (rows||[]).map(q=>'<tr><td>'+esc(q['Date'])+'</td><td>'+esc(q['Topic'])+'</td><td>'+esc(q['Actual WC'])+' / '+esc(q['Target WC'])+'</td><td>'+esc(q['Keywords Verified'])+'</td><td><span class="chip" data-s="'+esc(q['Overall'])+'">'+esc(q['Overall'])+'</span></td></tr>').join('')+'</table></div>';}
async function loadQA(){const {qa}=await api('/admin/api/qa');$('qa').innerHTML=qaTable(qa);}
boot();
</script></body></html>`;

module.exports = { router };
