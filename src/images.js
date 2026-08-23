'use strict';
/**
 * fal.ai image generation — 3 images per blog:
 *   1. hero  : title image in a distinctive editorial style (style rotates per post)
 *   2. graph : infographic-style visual explaining the blog's opening concept
 *   3. enhanced : the graph image passed through an enhancer/upscaler
 * Runs on Render (fal.ai queue API). Images are also archived to Drive.
 */

const CFG = require('./config');
const U = require('./util');
const { google } = require('googleapis');
const { auth } = require('./gsheets');

// Brand palette (matches www.neopolisinfra.com): deep navy #081d4a, crisp white,
// soft blue-grey neutrals, warm sand highlights. Minimalist, professional, trust-focused.
const BRAND_COLORS = 'deep navy blue (#081d4a) and crisp white with soft blue-grey neutrals and a subtle warm sand highlight';
const HERO_STYLES = [
  `premium architectural photography at dusk, cinematic, shallow depth of field, cool navy-blue hour tones with warm window lights`,
  `modern flat vector illustration, bold geometric shapes, ${BRAND_COLORS}, generous white space`,
  `isometric 3D render, soft studio lighting, minimal, high detail, ${BRAND_COLORS}`,
  `editorial photo-collage, layered paper texture, sophisticated real-estate magazine look, navy and white with sand accents`
];

async function falRun(model, input) {
  if (!CFG.FAL_API_KEY) throw new Error('FAL_API_KEY not set');
  const submit = await U.httpFetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: 'Key ' + CFG.FAL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }, 2);
  if (submit.code >= 300) throw new Error(`fal submit ${model} HTTP ${submit.code}: ${submit.text.slice(0, 200)}`);
  const job = JSON.parse(submit.text);
  const statusUrl = job.status_url || `https://queue.fal.run/${model}/requests/${job.request_id}/status`;
  const responseUrl = job.response_url || `https://queue.fal.run/${model}/requests/${job.request_id}`;

  for (let i = 0; i < 60; i++) {           // up to ~3 min
    await U.sleep(3000);
    const st = await U.httpFetch(statusUrl, { headers: { Authorization: 'Key ' + CFG.FAL_API_KEY } }, 1);
    const sj = JSON.parse(st.text);
    if (sj.status === 'COMPLETED') break;
    if (sj.status === 'FAILED' || sj.status === 'ERROR') throw new Error('fal job failed: ' + JSON.stringify(sj).slice(0, 200));
  }
  const res = await U.httpFetch(responseUrl, { headers: { Authorization: 'Key ' + CFG.FAL_API_KEY } }, 2);
  if (res.code >= 300) throw new Error('fal result HTTP ' + res.code);
  const out = JSON.parse(res.text);
  const img = (out.images && out.images[0]) || (out.image) || null;
  const url = img && (img.url || img);
  if (!url) throw new Error('fal returned no image url: ' + JSON.stringify(out).slice(0, 200));
  return String(url);
}

/**
 * Generate the 3 blog images. Returns [{role, url, driveUrl?}] — failures per-image
 * degrade gracefully (a blog publishes with fewer images rather than not at all).
 */
async function generateBlogImages({ title, primaryKeyword, openingSummary, seq = 0 }) {
  const out = [];
  const style = HERO_STYLES[seq % HERO_STYLES.length];

  // 1. hero / title image
  try {
    const heroUrl = await falRun(CFG.FAL_MODEL_TITLE, {
      prompt: `Blog cover image for a premium Hyderabad real-estate article titled "${title}". ${style}. West Hyderabad skyline with modern residential towers near the Outer Ring Road. Sophisticated, trustworthy, aspirational. No text, no words, no watermark.`,
      image_size: 'landscape_16_9', num_images: 1
    });
    out.push({ role: 'hero', url: heroUrl });
  } catch (e) { console.warn('[images] hero failed: ' + e.message); }

  // 2. graph / explanation of the blog's top section
  let graphUrl = null;
  try {
    graphUrl = await falRun(CFG.FAL_MODEL_GRAPH, {
      prompt: `Clean infographic-style illustration explaining: ${openingSummary || primaryKeyword}. Diagram aesthetic, labelled zones, arrows, simple icons of apartment buildings and documents, ${BRAND_COLORS}, white background, flat vector, professional real-estate explainer matching the Neopolis Infra website branding. Minimal or no text.`,
      image_size: 'landscape_4_3', num_images: 1
    });
    out.push({ role: 'infographic', url: graphUrl });
  } catch (e) { console.warn('[images] infographic failed: ' + e.message); }

  // 3. enhanced version of #2
  if (graphUrl) {
    try {
      const enhanced = await falRun(CFG.FAL_ENHANCE_MODEL, { image_url: graphUrl });
      out.push({ role: 'enhanced', url: enhanced });
    } catch (e) { console.warn('[images] enhance failed: ' + e.message); }
  }

  // archive to Drive (best-effort)
  for (const img of out) {
    try { img.driveUrl = await uploadUrlToDrive(img.url, `blog-${U.slugify(title).slice(0, 40)}-${img.role}.jpg`); }
    catch (e) { console.warn('[images] drive archive failed (' + img.role + '): ' + e.message); }
  }
  return out;
}

/** Download an image and upload it into the configured Drive folder. */
async function uploadUrlToDrive(url, name) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch image HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const drive = google.drive({ version: 'v3', auth: auth() });
  const { Readable } = require('stream');
  const file = await drive.files.create({
    requestBody: { name, parents: CFG.DRIVE_FOLDER_ID ? [CFG.DRIVE_FOLDER_ID] : undefined },
    media: { mimeType: resp.headers.get('content-type') || 'image/jpeg', body: Readable.from(buf) },
    fields: 'id'
  });
  return 'https://drive.google.com/file/d/' + file.data.id + '/view';
}

/** Fetch image bytes (for embedding files into the Netlify deploy). */
async function fetchImageBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch image HTTP ' + resp.status);
  return { buf: Buffer.from(await resp.arrayBuffer()), contentType: resp.headers.get('content-type') || 'image/jpeg' };
}

module.exports = { generateBlogImages, falRun, uploadUrlToDrive, fetchImageBytes };
