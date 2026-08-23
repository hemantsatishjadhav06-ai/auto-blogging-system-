'use strict';
/**
 * Email notifications via Gmail API, using the SAME Google OAuth refresh token as
 * Sheets/Docs (scope: gmail.send). Only works with the OAuth auth option — with a
 * service account it degrades to a console warning (service accounts can't send
 * as the user without domain-wide delegation).
 */

const { google } = require('googleapis');
const CFG = require('./config');
const { auth } = require('./gsheets');

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendMail(subject, htmlBody) {
  if (!CFG.NOTIFY_EMAIL) return { skipped: 'NOTIFY_EMAIL not set' };
  if (!CFG.GOOGLE_OAUTH_REFRESH_TOKEN) return { skipped: 'email needs the OAuth auth option (gmail.send scope)' };
  try {
    const gmail = google.gmail({ version: 'v1', auth: auth() });
    const raw = [
      'To: ' + CFG.NOTIFY_EMAIL,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody
    ].join('\r\n');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: b64url(raw) } });
    return { sent: true };
  } catch (e) {
    console.warn('[notify] email failed: ' + e.message);
    return { error: e.message };
  }
}

/** Run report email (called after /run/all, /run/publish, and on errors). */
async function sendRunReport(stageName, summary, ok = true) {
  const subject = `[Neopolis AutoBlog] ${ok ? '✅' : '❌'} ${stageName} — ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
  const rows = Object.entries(summary || {}).map(([k, v]) =>
    `<tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold">${k}</td><td style="padding:6px 10px;border:1px solid #ddd">${typeof v === 'object' ? '<pre style="margin:0;white-space:pre-wrap">' + escapeHtml(JSON.stringify(v, null, 1)).slice(0, 3000) + '</pre>' : escapeHtml(String(v))}</td></tr>`
  ).join('');
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:640px">',
    `<h2 style="color:#0b3d2e">Neopolis AutoBlog — ${escapeHtml(stageName)}</h2>`,
    `<table style="border-collapse:collapse">${rows}</table>`,
    `<p style="color:#666;font-size:13px">Tracking sheet: https://docs.google.com/spreadsheets/d/${CFG.SHEET_ID}<br>Site: ${CFG.SITE_URL}</p>`,
    '</div>'
  ].join('');
  return sendMail(subject, html);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { sendMail, sendRunReport };
