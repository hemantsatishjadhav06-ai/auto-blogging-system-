# System Design v2 — Neopolis 3-Layer Auto-Blogging Service

**Date:** 2026-08-20 · **Supersedes:** v1 (Apps Script, ADR-001) · **Status:** Built
**Runtime:** Node.js service on **Render** (free tier) · **Data:** Google Sheets + Google Docs · **Publish:** Netlify site `neopolis-infra` (site_id `47e0a5cc-d9d9-428b-a36b-beea806bff6f`) + LinkedIn

---

## 1. Requirements

### Functional
- **Layer 1 — Research:** discover short/long-tail keywords (Google Trends first-party, autocomplete fallback) AND discover **competitors from those keywords** (aggregate the domains that appear across page-1 results).
- **Layer 2 — Topic sheet:** select topics to publish ranked by **repeated words/phrases across competitor pages** (term-frequency analysis) merged with **project details** from a Projects tab; generate the draft; store the content in a **Google Doc** and **paste the Doc link into the sheet row** (plus the project's file link).
- **Layer 3 — QA:** **verify total word count** vs target, **verify every keyword's occurrence count**, then **humanise** the content (anti-AI-pattern rewrite) and re-verify; only passing content publishes.
- **LinkedIn:** every blog also produces a LinkedIn-article version through the same 3 layers, stored in the Doc + sheet.
- **Keyword scale-up:** each blog targets 1 primary + **10–18 supporting keywords**, each with a **minimum occurrence count**; the most niche long-tails additionally generate **specific LLM search queries** (AEO) answered verbatim in an FAQ + FAQPage JSON-LD, so the post is retrievable by LLM answer engines, not just Google.
- **Deploy on Render** for auto-run; **publish to Netlify**; all state in the user's Google Sheet (`1V3zMb6hVND0sgWry0mW4fmDzNEAHGRxLuuzTwfmC2Vc`).

### Non-functional
- ₹0/month target (free tiers only), single owner, browser-manageable, safe-by-default for a real-estate brand (approval gate on money pages preserved from v1).

### Constraints & facts established
- User's Netlify: account `hemantsatishjadhav06-ai` (GitHub-linked), site `neopolis-infra` deploys from branch `main` → **GitHub-commit publishing works**; Netlify API file-deploy is the no-repo alternative.
- User's Sheet is the imported v1 tracker → v2 **adds tabs**, never breaks v1 tabs.
- Render free web services **sleep after idle** and Render's native cron is paid → scheduling uses an **external free pinger** (cron-job.org) hitting token-protected `/run/*` endpoints, which both wakes the service and triggers the stage.

## 2. High-level design

```
 cron-job.org (free scheduler, pings with secret token)
      │  POST /run/layer1 ... /run/layer2 ... /run/layer3 ... /run/publish
      ▼
┌────────────────────────── RENDER (free web service, Node.js) ──────────────────────────┐
│  Express API + internal node-cron (best-effort while awake)                            │
│                                                                                        │
│  LAYER 1  research.js     Trends related-queries (+autocomplete fallback)              │
│           competitors.js  SERP top-10 per keyword → domain aggregation                 │
│                └─► Sheets: L1_Keywords, L1_Competitors                                 │
│                                                                                        │
│  LAYER 2  topics.js       cluster → topic queue                                        │
│           tf.js           n-gram term frequency across competitor pages                │
│                           → repeated words + counts → keyword plan (10–18 kws)         │
│           brief.js        + Projects tab details (file link attached)                  │
│           writer.js       Gemini draft (blog + LinkedIn) with per-keyword targets      │
│           gdocs.js        create Google Doc, write content, share, link → sheet row    │
│                └─► Sheets: L2_Topics (Doc link, project file link, keyword plan)       │
│                                                                                        │
│  LAYER 3  qa.js           word-count check, per-keyword count check, density ceiling   │
│           humanize.js     Gemini humanisation pass → re-verify (max 2 loops)           │
│           aeo.js          niche long-tails → LLM query list → FAQ + JSON-LD            │
│                └─► Sheets: L3_QA (all checks, pass/fail, humanised flag)               │
│                                                                                        │
│  PUBLISH  netlify.js      GitHub commit → Netlify build   (alt: Netlify API deploy)    │
│           linkedin.js     LinkedIn text-post via API if token set; else Doc section    │
│                └─► Sheets: Published (blog URL, LinkedIn status, Doc link)             │
└────────────────────────────────────────────────────────────────────────────────────────┘
      │ googleapis (service account)                    │ GitHub API / Netlify API
      ▼                                                 ▼
 Google Sheet (state/control)  Google Docs (content)   neopolis-infra.netlify.app + LinkedIn
```

## 3. Data model (tabs added to the existing sheet)

- **Projects** *(user-maintained)*: `Project Name | Corridor | Configurations | Size Range | Price Band | USP / Details | Brochure/File Link | Status` — the "attach the file in the sheet" requirement: the Drive/brochure link lives here and is copied into every topic row that uses the project.
- **L1_Keywords**: `Date | Seed | Keyword | Type | Source | Trends Bucket | Interest | Intent | Corridor | Niche Score | Used In Topic`. *Niche Score* = word-count of the keyword × specificity signals; the highest-niche keywords drive AEO queries.
- **L1_Competitors**: `Domain | First Seen | # Keywords Ranked | Sample URLs | Avg Word Count | Type (portal/builder/broker) | Notes` — competitors are *derived from the keywords*, not hand-picked.
- **L2_Topics**: `SI | Topic | Primary Keyword | Supporting Keywords (count) | Repeated Words (from competitors, with counts) | Target WC | Project | Project File Link | Doc Link | LLM Queries | Risk | Approval | Status`.
- **L3_QA**: `Topic | Target WC | Actual WC | WC Pass | Keywords Planned | Keywords Verified | Failed Keywords | Max Density | Density Pass | Humanised | Human Score Notes | Overall | Date`.
- **Published**: `Date | Topic | Blog URL | LinkedIn Status | LinkedIn URL/Note | Doc Link`.

The service **auto-creates any missing tab** with these headers on boot (idempotent), leaving v1 tabs untouched.

## 4. Key algorithms

**Competitor discovery (L1):** for each cluster-head keyword, take page-1 URLs; `domain → {count of keywords it appears for, URLs}`; a domain appearing for ≥2 keywords is a competitor; classified portal/builder by domain heuristics. Output feeds L2 (whose pages get term-analyzed) and strategy (who you must outrank).

**Repeated-words topic engine (L2):** for a topic's competitor pages: extract main text → tokenize → remove stopwords → count 1/2/3-grams → keep grams appearing in **≥2 competitor pages**, ranked by total count. Top 15 become the sheet's *Repeated Words* column (`gram (count)`) and the draft's **required terms**. Supporting-keyword plan = cluster keywords + top repeated grams, deduped, capped 10–18, each with `minCount = clamp(round(targetWC × densityTarget / 100 / words-in-gram), 2, 12)` (default densityTarget 0.6% per keyword, stuffing ceiling 2.5% for any single gram).

**Target word count:** unchanged from v1 (`clamp(max(median₁₀, avgTop3) × 1.15, floor, ceiling)`) — validated in the v1 test run.

**AEO / LLM queries (L3 input, generated in L2):** the 3–5 *nichest* keywords (highest Niche Score) each generate 2–3 fully-specific natural-language questions a person would ask an LLM ("Is it safe to buy a landlord-share 3 BHK in Narsingi in 2026 and what documents should I check?"). Each question is answered **verbatim as an H3 Q&A** and emitted as **FAQPage JSON-LD** in the published HTML — the specific search query literally exists on the page for answer engines to retrieve.

**Humanisation (L3):** a second model pass with hard rules: vary sentence length; use contractions; concrete local detail over abstractions; delete AI-cliché phrases (blocklist: "in today's fast-paced world", "delve", "landscape", "unlock", "game-changer", …); first-person-plural brand voice; keep every required keyword ≥ its minCount. Verifier then re-counts; on failure the loop repairs (max 2 iterations) and otherwise flags the row `NEEDS REVIEW` rather than publishing bad content.

## 5. API (all POST, `x-run-token` header must match RUN_TOKEN)

`/run/layer1` · `/run/layer2` · `/run/layer3` · `/run/publish` · `/run/all` · `/health` (GET, no auth). Each returns a JSON summary and writes its rows to the sheet; each is idempotent (keys on keyword/topic) so double-pings are safe.

## 6. Scheduling & scale

cron-job.org (free): L1 weekly (Mon 06:00 IST), L2 daily 07:00, L3 daily 08:00, publish daily 10:00. Each ping wakes the sleeping Render service (~30s cold start — fine for batch jobs). Load is trivial (1–3 posts/day); the free instance is over-provisioned for it. All external calls have retry+backoff; SERP budget guard (90/day) carries over from v1.

## 7. Trade-offs made explicit

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Runtime | Render web service + external pinger | Render paid cron / keep Apps Script | User specified Render; pinger keeps it ₹0. Apps Script v1 remains usable as a fallback scheduler |
| Publish | GitHub commit → Netlify build | Netlify API file-deploy | Site is git-backed from `main`; commits keep the repo the source of truth. API deploy documented as plan B |
| Content store | Google Docs (link in sheet) | Markdown in cell (v1) | User requirement; Docs are reviewable/commentable; cell keeps only the link |
| LinkedIn | Generate article in Doc + auto-post a **post** via API when `LINKEDIN_ACCESS_TOKEN` set | Full auto-published LinkedIn *Articles* | LinkedIn's public API supports posts (`w_member_social`), not member Articles — honest limit; the article text is ready to paste, the post + link auto-publishes |
| Keyword counting | Deterministic string counting in the verifier | Trust the model | Counts must be verifiable; the model is asked to hit targets, the verifier proves it |
| Trends | Server-side unofficial endpoints + autocomplete fallback | Paid keyword APIs | First-party constraint from v1 stands |

## 8. What to revisit as it grows
>5 posts/day → queue stages internally (Bull/pg-boss) and split layers into workers; add Netlify API deploys to skip CI latency; move sheet state to Postgres (Render free) keeping the Sheet as a mirrored view; LinkedIn company-page posting via Community Management API if a company page takes over distribution.

## 9. Open items (need from user)
1. Name of the GitHub repo behind `neopolis-infra` + one sample post file (front-matter/HTML template) — publisher ships with both a generic template and a `DRY_RUN` default until confirmed.
2. A Google **service account** must be created (free) and the Sheet + a Drive folder shared with it — 10-minute step in the deploy guide.
3. Optional `LINKEDIN_ACCESS_TOKEN` for auto-posting.

---

## Addendum (2026-08-21) — Two-level tracking: Master + per-blog keyword audit

**Requirement:** one master sheet tracking all blogs (word alignment + total keyword repetitions), plus a dedicated sheet per blog with keyword-by-keyword counts, attached to the master.

**Data model:**
- `Master_Blogs` (one row per blog): SI · Date · Blog Title · Primary Keyword · Target WC · Actual WC · **Word Alignment %** (actual/target) · WC Pass · Keywords Planned · Keywords Verified (n/m) · **Total Repetitions** · Max Density % · Status · Blog URL · Doc Link · **Keyword Audit Tab** (HYPERLINK to the blog's own tab gid).
- `Blog-NN-<slug>` (one tab per blog, created by Layer 3 after QA): metadata block (target/actual WC, alignment %, humanised, overall verdict) + table `Keyword | Role (PRIMARY/supporting) | Required Min | Repetitions (Actual) | Density % | Pass` + totals row.

**Flow:** Layer 3 verify → humanise → re-verify → `writeBlogAudit()` creates/refreshes the blog tab (idempotent by title) and upserts the Master row; Publish stamps Blog URL + Status onto the Master row. Data cells are written RAW (injection-safe); the tab hyperlink is the single USER_ENTERED formula, constructed only from values we generate.

**Counting semantics (revised for honesty):** hyphens equal spaces ("landlord share" matches "landlord-share") and simple plurals count ("NRI" matches "NRIs"); substrings never match. This changed the Narsingi post's measured repetitions from 101 to 125 and corrected two false FAILs.
