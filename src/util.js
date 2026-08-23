'use strict';
/** Shared helpers: fetch with retry, text analytics (n-grams, counting), misc. */

const CFG = require('./config');

// ---------- HTTP ----------
async function httpFetch(url, opts = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'en-IN,en;q=0.9',
          ...(opts.headers || {})
        }
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status + ' for ' + url);
        await sleep(800 * Math.pow(2, attempt) + Math.random() * 400);
        continue;
      }
      const text = await res.text();
      return { code: res.status, text, headers: res.headers };
    } catch (e) {
      lastErr = e;
      await sleep(800 * Math.pow(2, attempt));
    }
  }
  throw lastErr || new Error('httpFetch failed: ' + url);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function stripJsonPrefix(text) {
  const i = text.indexOf('{'); const j = text.indexOf('[');
  const start = i === -1 ? j : (j === -1 ? i : Math.min(i, j));
  return start > -1 ? text.slice(start) : text;
}

// ---------- HTML / text ----------
function extractMainText(html) {
  if (!html) return '';
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function extractHeadings(html) {
  if (!html) return [];
  const out = []; const re = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi; let m;
  while ((m = re.exec(html)) !== null) {
    const t = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t && t.length < 120) out.push(t);
  }
  return out;
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"');
}

function wordCount(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // yyyy-mm-dd
}

// ---------- text analytics ----------
const STOPWORDS = new Set(('a,an,the,and,or,but,if,then,else,of,in,on,at,to,for,from,by,with,without,about,as,into,is,are,was,were,be,been,being,it,its,this,that,these,those,you,your,we,our,they,their,he,she,his,her,i,my,me,us,them,will,would,can,could,should,may,might,do,does,did,not,no,yes,so,than,too,very,just,also,more,most,much,many,any,all,some,such,per,via,vs,up,down,out,over,under,again,new,get,got,has,have,had,how,what,when,where,which,who,why,here,there,now,only,own,same,other,each,between,both,few,because,while,after,before,during,above,below,off,once,rs,inr,com,www,https,http').split(','));

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && w.length > 1);
}

/**
 * Repeated-words engine: count 1/2/3-grams across multiple documents.
 * Returns grams present in >= minDocs documents, ranked by total count.
 * [{gram, totalCount, docCount}]
 */
function repeatedGrams(docs, { minDocs = 2, top = 15, maxGram = 3 } = {}) {
  const perDoc = docs.map(d => {
    const toks = tokenize(d);
    const counts = new Map();
    for (let n = 1; n <= maxGram; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const words = toks.slice(i, i + n);
        if (words.some(w => STOPWORDS.has(w))) {
          if (n === 1) continue;
          // allow interior stopwords in 3-grams only if edges are content words
          if (STOPWORDS.has(words[0]) || STOPWORDS.has(words[n - 1])) continue;
        }
        const g = words.join(' ');
        counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
    return counts;
  });
  const total = new Map();
  for (const counts of perDoc) {
    for (const [g, c] of counts) {
      const cur = total.get(g) || { totalCount: 0, docCount: 0 };
      cur.totalCount += c; cur.docCount += 1;
      total.set(g, cur);
    }
  }
  const out = [];
  for (const [gram, v] of total) {
    if (v.docCount >= Math.min(minDocs, docs.length)) out.push({ gram, ...v });
  }
  // prefer longer grams on ties; filter grams fully contained in a higher-ranked longer gram
  out.sort((a, b) => b.totalCount - a.totalCount || b.gram.length - a.gram.length);
  const picked = [];
  for (const g of out) {
    if (picked.length >= top) break;
    if (picked.some(p => p.gram.includes(g.gram) && p.gram !== g.gram)) continue;
    picked.push(g);
  }
  return picked;
}

/**
 * Count occurrences of a phrase in text (word-boundary, case-insensitive).
 * Hyphens count as spaces ("landlord share" matches "landlord-share") and a
 * simple trailing plural is accepted ("nri" matches "NRIs") — SEO-honest counting.
 */
function countOccurrences(text, phrase) {
  const esc = String(phrase).trim().toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[\s-]+/g, '[\\s\\-]+');
  if (!esc) return 0;
  const re = new RegExp('(?:^|[^a-z0-9])' + esc + '(?:e?s)?(?=$|[^a-z0-9])', 'gi');
  const m = String(text).toLowerCase().match(re);
  return m ? m.length : 0;
}

/** Min occurrences a keyword should have for a target word count. */
function minCountFor(phrase, targetWC) {
  const wordsIn = Math.max(1, phrase.trim().split(/\s+/).length);
  const raw = Math.round((targetWC * (CFG.KEYWORD_DENSITY_TARGET / 100)) / wordsIn);
  return Math.max(2, Math.min(12, raw));
}

/** Density (%) of a phrase in text. */
function density(text, phrase, occurrences) {
  const total = wordCount(text);
  if (!total) return 0;
  const wordsIn = Math.max(1, phrase.trim().split(/\s+/).length);
  return +(100 * (occurrences * wordsIn) / total).toFixed(2);
}

/** Niche score: longer + more specific = more niche (drives AEO). */
function nicheScore(keyword) {
  const k = keyword.toLowerCase();
  let score = k.split(/\s+/).length * 10;
  if (/\d/.test(k)) score += 8;                    // has numbers (3 bhk, 2026)
  if (/\b(kokapet|narsingi|tellapur|kollur|manchirevula|financial district)\b/.test(k)) score += 10;
  if (/\b(landlord share|joint development|title|rera|poa|nri)\b/.test(k)) score += 10;
  if (/\b(how|what|is|can|should|which)\b/.test(k)) score += 5;
  return score;
}

function classifyIntent(kw) {
  const k = kw.toLowerCase();
  if (/\b(price|buy|cost|for sale|booking|emi|loan|resale|rate|per sq|sqft)\b/.test(k)) return 'transactional';
  if (/\b(vs|versus|best|compare|is it safe|worth|review|which|guide)\b/.test(k)) return 'commercial';
  if (/\b(flats?|apartments?|villas?)\s+in\b/.test(k)) return 'commercial';
  if (/\b(what|how|why|meaning|explained|process|documents|rules|law)\b/.test(k)) return 'informational';
  return 'informational';
}

function classifyType(kw) {
  const words = kw.split(/\s+/).length;
  return words >= 4 ? 'long-tail' : (words <= 2 ? 'short-tail' : 'mid-tail');
}

function detectCorridor(kw) {
  const k = kw.toLowerCase();
  for (const c of CFG.CORRIDORS) if (k.includes(c.toLowerCase())) return c;
  return '';
}

module.exports = {
  httpFetch, sleep, stripJsonPrefix, extractMainText, extractHeadings, wordCount,
  slugify, todayISO, tokenize, repeatedGrams, countOccurrences, minCountFor,
  density, nicheScore, classifyIntent, classifyType, detectCorridor, STOPWORDS
};
