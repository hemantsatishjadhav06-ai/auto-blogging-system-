'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
const U = require('../src/util');
const { verify, parseKeywordPlan } = require('../src/layer3');
const { faqFromMarkdown, mdToHtml } = require('../src/publish');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, info) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' => ' + JSON.stringify(info) : '')); cond ? pass++ : fail++; }

// ---- repeated grams (the Layer-2 "words repeated" engine) ----
const docs = [
  'landlord share flats in kokapet offer great value. landlord share flats are verified. price trends in kokapet rise. flats in kokapet near financial district.',
  'buyers want landlord share flats with clear title. price trends in kokapet matter. financial district connectivity drives flats in kokapet demand.',
  'title verification matters for landlord share flats. kokapet financial district corridor grows.'
];
const grams = U.repeatedGrams(docs, { minDocs: 2, top: 10 });
const gramNames = grams.map(g => g.gram);
ok('repeatedGrams finds "landlord share flats"', gramNames.includes('landlord share flats'), gramNames.slice(0,6));
ok('repeatedGrams finds "flats in kokapet"', gramNames.includes('flats in kokapet'));
ok('repeatedGrams counts docs', grams.find(g=>g.gram==='landlord share flats').docCount === 3);

// ---- occurrence counting ----
ok('countOccurrences basic', U.countOccurrences('Flats in Kokapet. flats in kokapet!', 'flats in kokapet') === 2);
ok('countOccurrences plural+base', U.countOccurrences('kokapets are not kokapet', 'kokapet') === 2); // plurals count (SEO-honest)
ok('countOccurrences hyphen=space', U.countOccurrences('a landlord-share flat', 'landlord share') === 1);
ok('countOccurrences no substring', U.countOccurrences('kokapetville', 'kokapet') === 0);
ok('minCountFor scales', U.minCountFor('kokapet', 2000) >= 2 && U.minCountFor('kokapet', 2000) <= 12, U.minCountFor('kokapet', 2000));

// ---- verify() on the real Narsingi draft ----
const draft = JSON.parse(fs.readFileSync('/tmp/run/draft.json', 'utf8'));
const plan = [
  { keyword: 'landlord share', minCount: 5 },
  { keyword: 'narsingi', minCount: 10 },
  { keyword: '3 bhk', minCount: 2 },
  { keyword: 'unicorn keyword missing', minCount: 3 }
];
const v = verify(draft.markdown_body, 2500, 'flats in narsingi for sale', plan);
ok('verify: actual WC computed', v.actualWC > 2000, v.actualWC);
ok('verify: catches missing keyword', v.failed.some(f => f.keyword === 'unicorn keyword missing'), v.failed);
ok('verify: passes present keywords', v.checks.find(c => c.keyword === 'narsingi').pass, v.checks.find(c=>c.keyword==='narsingi').actual);
ok('verify: density sane', v.maxDensity < 5, v.maxDensity);

// ---- keyword plan parser ----
const parsed = parseKeywordPlan('kw one (min 4); kw two (min 3); loose kw');
ok('parseKeywordPlan', parsed.length === 3 && parsed[0].minCount === 4 && parsed[2].minCount === 2, parsed);

// ---- FAQ JSON-LD extraction ----
const md = '## FAQ\n### Is it safe to buy a landlord share flat in Narsingi in 2026?\nYes, if the JDA allocation and title are verified before payment.\n### What is the price?\nPrices vary by project; ask for current unit pricing.\n## Other\ntext';
const faq = faqFromMarkdown(md, ['Is it safe to buy a landlord share flat in Narsingi in 2026?']);
ok('faqFromMarkdown extracts Q&A', faq.length === 2 && faq[0].a.includes('JDA'), faq.map(f=>f.q));

// ---- markdown -> html ----
const html = mdToHtml('# Title\n\n## Section\n\nPara with **bold** and [link](https://x.y).\n\n- item one\n- item two\n\n| A | B |\n|---|---|\n| 1 | 2 |');
ok('mdToHtml headings', html.includes('<h1>Title</h1>') && html.includes('<h2>Section</h2>'));
ok('mdToHtml list+table', html.includes('<li>item one</li>') && html.includes('<td>1</td>'));
ok('mdToHtml inline', html.includes('<strong>bold</strong>') && html.includes('<a href="https://x.y">link</a>'));

// ---- niche score ordering ----
ok('nicheScore: long specific > short generic',
  U.nicheScore('3 bhk landlord share flat kokapet price 2026') > U.nicheScore('flats hyderabad'),
  [U.nicheScore('3 bhk landlord share flat kokapet price 2026'), U.nicheScore('flats hyderabad')]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
