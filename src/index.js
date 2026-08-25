'use strict';
/**
 * Neopolis AutoBlog v2 — Express service for Render.
 * Endpoints (POST, header x-run-token: RUN_TOKEN):
 *   /run/layer1  research: keywords + competitors
 *   /run/layer2  topics: repeated-words -> draft -> Google Doc -> sheet
 *   /run/layer3  QA: word count + keyword counts + humanise
 *   /run/publish publish approved: Netlify + LinkedIn
 *   /run/all     layer1 -> layer2 -> layer3 -> publish
 * GET /health    liveness (no auth) — also the wake-up target for cron-job.org pings.
 */

const express = require('express');
const crypto = require('crypto');
const cron = require('node-cron');
const CFG = require('./config');
const { runLayer1 } = require('./layer1');
const { runLayer2 } = require('./layer2');
const { runLayer3 } = require('./layer3');
const { runPublish } = require('./publish');
const { ensureTabs, getConfigValue, setConfigValue } = require('./gsheets');
const { getSerpUsage, setSerpUsage } = require('./sources');
const { sendRunReport } = require('./notify');
const admin = require('./admin');

const state = require('./state');

const app = express();
app.use(express.json({ limit: '2mb' }));

function tokenOk(req) {
  if (!CFG.RUN_TOKEN) return false;
  const given = Buffer.from(String(req.get('x-run-token') || ''));
  const want = Buffer.from(CFG.RUN_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function guard(req, res, next) {
  if (!CFG.RUN_TOKEN) return res.status(500).json({ error: 'RUN_TOKEN not configured' });
  if (!tokenOk(req)) return res.status(401).json({ error: 'bad token' });
  if (state.running) return res.status(409).json({ error: 'a run is already in progress' });
  next();
}

// Admin panel. When ADMIN_OPEN (default) the panel and its API need no token —
// /admin loads straight in. Set ADMIN_OPEN=false to require the RUN_TOKEN sign-in.
app.use('/admin', (req, res, next) => {
  if (req.path === '/' || req.path === '') return next();
  if (CFG.ADMIN_OPEN) return next();
  if (!tokenOk(req)) return res.status(401).json({ error: 'bad token' });
  next();
}, admin.router);

async function stage(res, name, fn) {
  state.running = true;
  const started = Date.now();
  try {
    // restore today's SERP usage from the sheet so restarts never exceed the free quota
    try {
      const u = getSerpUsage();
      const saved = Number(await getConfigValue('SERP_USED_' + u.date)) || 0;
      if (saved > u.n) setSerpUsage(u.date, saved);
    } catch (e) { console.warn('serp usage restore skipped:', e.message); }
    const result = await fn();
    try { const u = getSerpUsage(); await setConfigValue('SERP_USED_' + u.date, u.n); }
    catch (e) { console.warn('serp usage save skipped:', e.message); }
    res.json({ stage: name, ok: true, seconds: Math.round((Date.now() - started) / 1000), result });
    if (name === 'all' || name === 'publish') sendRunReport(name, result, true).catch(() => {});
  } catch (e) {
    console.error(`[${name}]`, e);
    res.status(500).json({ stage: name, ok: false, error: e.message });
    sendRunReport(name, { error: e.message }, false).catch(() => {});
  } finally { state.running = false; state.lastRun = { name, at: new Date().toISOString() }; }
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'neopolis-autoblog-v2', time: new Date().toISOString() }));

app.post('/run/layer1', guard, (req, res) => stage(res, 'layer1', () => runLayer1(req.body || {})));
app.post('/run/layer2', guard, (req, res) => stage(res, 'layer2', () => runLayer2(req.body || {})));
app.post('/run/layer3', guard, (req, res) => stage(res, 'layer3', () => runLayer3()));
app.post('/run/publish', guard, (req, res) => stage(res, 'publish', () => runPublish()));
app.post('/run/all', guard, (req, res) => stage(res, 'all', async () => {
  const out = {};
  out.layer1 = await runLayer1({});
  out.layer2 = await runLayer2({});
  out.layer3 = await runLayer3();
  out.publish = await runPublish();
  return out;
}));

// Internal cron (best-effort: only fires while the free instance is awake;
// cron-job.org pings are the reliable scheduler AND the wake-up call).
if (CFG.ENABLE_INTERNAL_CRON) {
  const tz = { timezone: 'Asia/Kolkata' };
  const safe = (name, fn) => async () => {
    if (state.running) return;
    state.running = true;
    try { console.log('[cron]', name); await fn(); }
    catch (e) { console.error('[cron]', name, e.message); }
    finally { state.running = false; state.lastRun = { name, at: new Date().toISOString() }; }
  };
  cron.schedule('0 6 * * 1', safe('layer1', () => runLayer1({})), tz);
  cron.schedule('0 7 * * *', safe('layer2', () => runLayer2({})), tz);
  cron.schedule('0 8 * * *', safe('layer3', () => runLayer3()), tz);
  cron.schedule('0 10 * * *', safe('publish', () => runPublish()), tz);
}

app.listen(CFG.PORT, async () => {
  console.log('neopolis-autoblog-v2 listening on :' + CFG.PORT);
  try { await ensureTabs(); console.log('sheet tabs verified'); }
  catch (e) { console.warn('tab bootstrap deferred (set GOOGLE_SERVICE_ACCOUNT_JSON):', e.message); }
});
