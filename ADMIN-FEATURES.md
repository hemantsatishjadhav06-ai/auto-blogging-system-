# Neopolis Admin Backend — Features

Served by the same Render service at **`/admin`** (nothing extra to deploy). Sign in
once with the admin token (RUN_TOKEN); every action writes to the same Google Sheet
the pipeline uses, so the panel, the sheet, and the daily automation never disagree.
Brand-matched to www.neopolisinfra.com (navy #081d4a / white, minimalist).

## Implemented now (v2.4)

**Dashboard** — counts at a glance: total blogs, drafted, awaiting approval, QA
passed, needs review, published, properties; latest QA results; quick links to the
website and tracking sheet.

**Blog pipeline (publish/status management)** — every blog with word count vs
target (+alignment %), keywords verified (n/m), total repetitions, risk class,
approval and status chips; per-blog actions:
- **Approve / Reject** (money-page gate handled here instead of the sheet)
- **Publish now** (approves + runs the publisher; site updated, Master row stamped)
- **Regenerate images** (fal.ai — brand-matched navy/white prompts; new set saved
  to the sheet + Drive)
- Open the **Google Doc** (full content) and the **live post**.

**Properties (project management)** — add a property (name, corridor,
configurations, size range, price band, USP, brochure link); activate/deactivate;
the writer only features Active properties, so this directly controls what the
daily blogs promote.

**QA view** — full audit history: word-count pass, keywords verified, humanised
flag, overall verdict per blog.

**Security** — token-gated API (timing-safe), the shell page shows only a login
box; all sheet writes stay injection-safe (RAW).

## Brainstorm — roadmap (in suggested order)

1. **Edit-in-panel**: change a blog's title/meta/slug and body (writes a new Doc
   revision) before approving; inline diff of humanised vs original.
2. **Scheduling calendar**: pick publish date/time per blog; queue view by week;
   pause/resume the daily pipeline from the panel.
3. **Image picker**: show the 3 generated images inline, choose hero, re-roll a
   single image with a style dropdown (photo / vector / isometric / collage).
4. **Property → blog linking**: from a property, "write a blog about this" button
   (seeds Layer 2 with that project); property detail page listing every blog that
   features it.
5. **Leads tie-in**: surface the Meta-lead + WhatsApp-funnel sheets (already in
   your stack) so blog CTAs, properties, and leads live in one panel.
6. **Analytics**: pull Google Search Console (same OAuth) — clicks/impressions per
   post beside its keyword plan; simple trend per corridor cluster.
7. **Users & roles**: owner vs editor tokens; editor can draft/approve, only owner
   publishes; per-action audit log tab in the sheet.
8. **Site controls**: edit the blog index order, feature a post on the homepage,
   manage redirects — all via the same Netlify deploy mechanism.
9. **Notifications centre**: read the run-report emails in-panel; retry failed
   stages with one click.
10. **LinkedIn queue**: show each blog's LinkedIn article + post text with a
    "copy" button and (when token present) "post now".

---

## v2.5 — Frontend attachment, parallel writes & Master Hub

**Backend attached to the frontend.** Every publish now also regenerates, in the
same Netlify deploy:
- `/blog/index.html` — the public blog listing (navy/white brand), rebuilt from the
  Master_Blogs sheet so the website always mirrors current status.
- `/blog/status.json` — a machine-readable feed of published posts (title, keyword,
  URL, words, date, status). The panel and any external script can poll it to see
  edits and publish status without touching the sheet.

**In-panel editing with parallel writes.** The Blogs table has an **Edit** button:
load the blog's content, change title/body, Save — which writes in parallel to
(1) the Google Doc (as an EDITED revision the publisher reads), (2) L2_Topics
(title + status), and (3) Master_Blogs (title + recounted word count + alignment).
Then **Publish/Republish** pushes the edit live and refreshes the index + status
feed. Sheet and site never drift.

**Master Hub** (landing tab) — the single place to run the system:
- **System health**: live status of every integration (Sheets, Docs/Drive, Gemini,
  fal.ai, Search/SERP with remaining daily budget, Netlify, email) — green/attention.
- **Pipeline controls**: run Layer 1 / 2 / 3 / Publish on demand; shows whether a run
  is in progress and the last run.
- **Everything one click away**: website, blog frontend, live status feed, tracking
  sheet, Drive folder.

A shared run-state (`state.js`) is the single mutex across cron, the `/run/*`
endpoints, and the Hub, so nothing double-runs.
