'use strict';
/** Google Docs: create a doc per blog, write blog + LinkedIn sections, return shareable link. */

const { google } = require('googleapis');
const { auth } = require('./gsheets');
const CFG = require('./config');

function docs() { return google.docs({ version: 'v1', auth: auth() }); }
function drive() { return google.drive({ version: 'v3', auth: auth() }); }

/**
 * Create a Google Doc containing the blog content + LinkedIn article.
 * Returns { docId, docUrl }.
 */
async function createContentDoc({ title, sheetUrl, meta, blogMarkdown, linkedinArticle, llmQueries }) {
  const d = docs();
  const create = await d.documents.create({ requestBody: { title } });
  const docId = create.data.documentId;

  // Move into the shared folder if configured (so the owner sees it in Drive)
  if (CFG.DRIVE_FOLDER_ID) {
    try {
      await drive().files.update({ fileId: docId, addParents: CFG.DRIVE_FOLDER_ID, fields: 'id, parents' });
    } catch (e) { console.warn('[gdocs] move to folder failed:', e.message); }
  }

  const parts = [];
  parts.push('NEOPOLIS AUTOBLOG — CONTENT DOCUMENT\n');
  parts.push('Tracking sheet: ' + (sheetUrl || ('https://docs.google.com/spreadsheets/d/' + CFG.SHEET_ID)) + '\n');
  parts.push('Generated: ' + new Date().toISOString() + '\n');
  parts.push('\n===== METADATA =====\n');
  parts.push('Title: ' + (meta.title || '') + '\n');
  parts.push('Slug: ' + (meta.slug || '') + '\n');
  parts.push('Meta title: ' + (meta.meta_title || '') + '\n');
  parts.push('Meta description: ' + (meta.meta_description || '') + '\n');
  parts.push('Primary keyword: ' + (meta.primary_keyword || '') + '\n');
  parts.push('Supporting keywords (' + (meta.supporting_keywords || []).length + '): ' + (meta.supporting_keywords || []).map(k => k.keyword + ' (min ' + k.minCount + ')').join('; ') + '\n');
  if (llmQueries && llmQueries.length) {
    parts.push('\n===== LLM SEARCH QUERIES TARGETED (AEO) =====\n');
    llmQueries.forEach(q => parts.push('- ' + q + '\n'));
  }
  parts.push('\n===== BLOG CONTENT (Markdown) =====\n\n');
  parts.push(blogMarkdown + '\n');
  parts.push('\n===== LINKEDIN ARTICLE =====\n\n');
  parts.push(linkedinArticle + '\n');

  await d.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: 1 }, text: parts.join('') } }] }
  });

  // Anyone-with-link reader so the sheet link opens for the owner and team
  try {
    await drive().permissions.create({ fileId: docId, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (e) { console.warn('[gdocs] share failed:', e.message); }

  return { docId, docUrl: 'https://docs.google.com/document/d/' + docId + '/edit' };
}

/** Replace the blog + LinkedIn sections after humanisation (append a revision block). */
async function appendRevision(docId, label, blogMarkdown, linkedinArticle) {
  const d = docs();
  const doc = await d.documents.get({ documentId: docId });
  const end = doc.data.body.content[doc.data.body.content.length - 1].endIndex - 1;
  const text = '\n\n===== ' + label + ' (' + new Date().toISOString() + ') =====\n\n'
    + blogMarkdown + '\n\n----- LinkedIn (' + label + ') -----\n\n' + (linkedinArticle || '(unchanged)') + '\n';
  await d.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: end }, text } }] }
  });
}

/** Read full plain text of a doc. */
async function getDocText(docId) {
  const doc = await docs().documents.get({ documentId: docId });
  let out = '';
  for (const el of doc.data.body.content || []) {
    if (!el.paragraph) continue;
    for (const pe of el.paragraph.elements || []) {
      if (pe.textRun && pe.textRun.content) out += pe.textRun.content;
    }
  }
  return out;
}

/**
 * Extract the LATEST blog markdown (and LinkedIn text) from a content doc.
 * Sections are delimited by "===== BLOG CONTENT (Markdown) =====" (initial)
 * and "===== HUMANISED vN (...) =====" (revisions from appendRevision).
 */
async function readLatestContent(docId) {
  const text = await getDocText(docId);
  const blocks = [];
  const re = /=====\s*(BLOG CONTENT \(Markdown\)|HUMANISED[^=]*?|EDITED[^=]*?)\s*=====/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push({ label: m[1].trim(), start: m.index + m[0].length });
  if (!blocks.length) return { blog: '', linkedin: '' };
  const last = blocks[blocks.length - 1];
  const next = text.indexOf('=====', last.start);
  let body = text.slice(last.start, next === -1 ? undefined : next).trim();
  // split off the linkedin sub-section if present in this block
  let linkedin = '';
  const liIdx = body.indexOf('----- LinkedIn');
  if (liIdx > -1) { linkedin = body.slice(body.indexOf('\n', liIdx) + 1).trim(); body = body.slice(0, liIdx).trim(); }
  if (!linkedin || /^\(unchanged\)/.test(linkedin)) {
    const marker = '===== LINKEDIN ARTICLE =====';
    const liBlock = text.indexOf(marker);
    if (liBlock > -1) {
      const contentStart = liBlock + marker.length;
      const liEnd = text.indexOf('=====', contentStart);
      linkedin = text.slice(contentStart, liEnd === -1 ? undefined : liEnd).trim();
    }
  }
  return { blog: body, linkedin, latestLabel: last.label };
}

module.exports = { createContentDoc, appendRevision, getDocText, readLatestContent };
