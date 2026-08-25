/** Central config. Secrets come from env vars (set in Render dashboard). */
'use strict';

function env(k, dflt) { return process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : dflt; }
function envNum(k, dflt) { const v = Number(env(k, dflt)); return isNaN(v) ? dflt : v; }
function envList(k, dflt) { const v = env(k, null); return v ? v.split(',').map(s => s.trim()).filter(Boolean) : dflt; }

module.exports = {
  // --- service ---
  PORT: envNum('PORT', 10000),
  RUN_TOKEN: env('RUN_TOKEN', ''),                    // required: shared secret for /run/* endpoints
  ENABLE_INTERNAL_CRON: env('ENABLE_INTERNAL_CRON', 'true') === 'true',

  // --- Google (service account) ---
  SHEET_ID: env('SHEET_ID', '1V3zMb6hVND0sgWry0mW4fmDzNEAHGRxLuuzTwfmC2Vc'),
  GOOGLE_SERVICE_ACCOUNT_JSON: env('GOOGLE_SERVICE_ACCOUNT_JSON', ''),  // paste full JSON (option A)
  // Option B: OAuth client + one-time refresh token (from your own Google account)
  GOOGLE_OAUTH_CLIENT_ID: env('GOOGLE_OAUTH_CLIENT_ID', ''),
  GOOGLE_OAUTH_CLIENT_SECRET: env('GOOGLE_OAUTH_CLIENT_SECRET', ''),
  GOOGLE_OAUTH_REFRESH_TOKEN: env('GOOGLE_OAUTH_REFRESH_TOKEN', ''),
  DRIVE_FOLDER_ID: env('DRIVE_FOLDER_ID', ''),        // folder for generated Docs

  // --- brand / site ---
  SITE_URL: env('SITE_URL', 'https://neopolis-infra.netlify.app'),
  BLOG_BASE_PATH: env('BLOG_BASE_PATH', '/blog'),
  BRAND: 'Neopolis Infra',
  CORRIDORS: envList('CORRIDORS', ['Kokapet', 'Narsingi', 'Financial District', 'Manchirevula', 'Tellapur', 'Kollur']),
  SEED_THEMES: envList('SEED_THEMES', [
    'landlord share flats hyderabad', 'flats in kokapet', 'flats in narsingi',
    'west hyderabad real estate', 'nri buy flat hyderabad',
    'title verification flat hyderabad', 'joint development agreement flats'
  ]),
  TRENDS_GEO: env('TRENDS_GEO', 'IN-TG'),
  COUNTRY: 'in',
  LANG: 'en',

  // --- models ---
  GEMINI_API_KEY: env('GEMINI_API_KEY', ''),
  GEMINI_MODEL: env('GEMINI_MODEL', 'gemini-2.5-flash'),

  // --- SERP ---
  SEARCH_API_KEY: env('SEARCH_API_KEY', ''),
  SEARCH_ENGINE_ID: env('SEARCH_ENGINE_ID', ''),
  SERP_TOP_N: envNum('SERP_TOP_N', 10),
  SERP_DAILY_BUDGET: envNum('SERP_DAILY_BUDGET', 90),

  // --- content rules ---
  WORDCOUNT_FLOOR: envNum('WORDCOUNT_FLOOR', 1200),
  WORDCOUNT_CEILING: envNum('WORDCOUNT_CEILING', 2600),
  WORDCOUNT_MULTIPLIER: envNum('WORDCOUNT_MULTIPLIER', 1.15),
  WC_TOLERANCE: envNum('WC_TOLERANCE', 0.10),          // ±10%
  MIN_SUPPORTING_KEYWORDS: envNum('MIN_SUPPORTING_KEYWORDS', 10),
  MAX_SUPPORTING_KEYWORDS: envNum('MAX_SUPPORTING_KEYWORDS', 18),
  KEYWORD_DENSITY_TARGET: envNum('KEYWORD_DENSITY_TARGET', 0.6),   // % per keyword
  KEYWORD_DENSITY_CEILING: envNum('KEYWORD_DENSITY_CEILING', 2.5), // % stuffing guard
  AEO_NICHE_KEYWORDS: envNum('AEO_NICHE_KEYWORDS', 4),  // how many niche kws generate LLM queries
  AEO_QUERIES_PER_KEYWORD: envNum('AEO_QUERIES_PER_KEYWORD', 2),
  TOPICS_PER_RUN: envNum('TOPICS_PER_RUN', 1),
  HUMANIZE_MAX_LOOPS: envNum('HUMANIZE_MAX_LOOPS', 2),

  // --- publishing ---
  PUBLISH_MODE: env('PUBLISH_MODE', 'dry_run'),        // dry_run | github | netlify_api
  GITHUB_TOKEN: env('GITHUB_TOKEN', ''),
  GITHUB_OWNER: env('GITHUB_OWNER', 'hemantsatishjadhav06-ai'),
  GITHUB_REPO: env('GITHUB_REPO', ''),
  GITHUB_BRANCH: env('GITHUB_BRANCH', 'main'),
  GITHUB_CONTENT_DIR: env('GITHUB_CONTENT_DIR', 'content/blog'),
  NETLIFY_TOKEN: env('NETLIFY_TOKEN', ''),
  NETLIFY_SITE_ID: env('NETLIFY_SITE_ID', '47e0a5cc-d9d9-428b-a36b-beea806bff6f'),

  // --- Images (fal.ai) ---
  FAL_API_KEY: env('FAL_API_KEY', ''),
  FAL_MODEL_TITLE: env('FAL_MODEL_TITLE', 'fal-ai/flux/schnell'),
  FAL_MODEL_GRAPH: env('FAL_MODEL_GRAPH', 'fal-ai/flux/schnell'),
  FAL_ENHANCE_MODEL: env('FAL_ENHANCE_MODEL', 'fal-ai/clarity-upscaler'),

  // --- Notifications ---
  NOTIFY_EMAIL: env('NOTIFY_EMAIL', 'hjadhav7733@gmail.com'),

  // --- Admin panel ---
  // Open by default: /admin loads straight in with no token/login screen.
  // Set ADMIN_OPEN=false to require the RUN_TOKEN sign-in again.
  ADMIN_OPEN: env('ADMIN_OPEN', 'true') === 'true',

  // --- LinkedIn ---
  LINKEDIN_ACCESS_TOKEN: env('LINKEDIN_ACCESS_TOKEN', ''),
  LINKEDIN_AUTHOR_URN: env('LINKEDIN_AUTHOR_URN', ''), // e.g. urn:li:person:xxxx

  // --- approval ---
  MONEY_PAGE_KEYWORDS: envList('MONEY_PAGE_KEYWORDS', ['price', 'buy', 'cost', 'for sale', 'emi', 'loan', 'legal', 'nri', 'registration', 'title']),
  AUTO_PUBLISH_INTENTS: envList('AUTO_PUBLISH_INTENTS', ['informational'])
};
