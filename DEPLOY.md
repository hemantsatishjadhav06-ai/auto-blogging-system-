# Deploy Guide — Neopolis AutoBlog v2 (Render)

The whole stack is free-tier. One-time setup ≈ 45–60 minutes, all in the browser.

## 0. What you're deploying

A Node.js service with 4 stages, each callable by URL and scheduled externally:

| Stage | What it does | Sheet tabs it fills |
|---|---|---|
| Layer 1 | Keywords (Trends/autocomplete) + competitors derived from those keywords | `L1_Keywords`, `L1_Competitors` |
| Layer 2 | Repeated-words analysis → keyword plan (10–18 kws with min counts) → project details → blog + LinkedIn draft → **Google Doc, link pasted in sheet** | `L2_Topics` |
| Layer 3 | Verify word count + every keyword's count → **humanise** → re-verify | `L3_QA` |
| Publish | Approved posts → Netlify; LinkedIn post via API or ready-to-paste | `Published` |

## 1. Google service account (10 min)
1. https://console.cloud.google.com → create/select a project.
2. Enable APIs: **Google Sheets API**, **Google Docs API**, **Google Drive API**.
3. IAM & Admin → Service Accounts → Create (name: `neopolis-autoblog`). No roles needed.
4. Keys → Add key → JSON → download. You'll paste this whole JSON into Render as `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Copy the service account's email (…@…iam.gserviceaccount.com), then:
   - **Share your tracking Sheet** with that email as **Editor** (the sheet: `1V3zMb6hVND0sgWry0mW4fmDzNEAHGRxLuuzTwfmC2Vc`).
   - Create a Drive folder "Neopolis Blog Docs", share it with that email as **Editor**, and copy its folder ID from the URL → `DRIVE_FOLDER_ID`.

## 2. Other free keys (reuse from v1 if you made them)
- `GEMINI_API_KEY` — https://aistudio.google.com/apikey
- `SEARCH_API_KEY` + `SEARCH_ENGINE_ID` — Programmable Search ("search entire web") + Custom Search API key. 100 queries/day free.
- Later, for live publishing (pick ONE):
  - `GITHUB_TOKEN` + `GITHUB_REPO` (repo behind the neopolis-infra site; fine-grained PAT, Contents read/write), or
  - `NETLIFY_TOKEN` (User settings → Applications → New access token) — publishes pages via the Netlify API without touching the repo. `NETLIFY_SITE_ID` is preset to your site.
- Optional: `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN` (LinkedIn Developer app with `w_member_social`; URN looks like `urn:li:person:xxxx`). Without it, every LinkedIn article is still generated and waiting in the Doc.

## 3. Deploy on Render (15 min)
1. Push this folder to a **new GitHub repo** (public or private).
2. https://dashboard.render.com → **New + → Blueprint** → select the repo (it reads `render.yaml`), or New + → Web Service with Build `npm install`, Start `npm start`, plan **Free**.
3. In the service's **Environment** tab, paste the secret values from steps 1–2. Set `PUBLISH_MODE=dry_run` for the first runs.
4. Deploy. Open `https://<your-service>.onrender.com/health` — you should see `{ok:true}` and the logs should say `sheet tabs verified` (this auto-creates the v2 tabs in your sheet).

## 4. Fill the Projects tab (5 min)
In the sheet's new **Projects** tab, add one row per project:
`Project Name | Corridor | Configurations | Size Range | Price Band | USP / Details | Brochure/File Link | Status`
The *Brochure/File Link* (a Drive link to the project PDF/brochure) is what gets attached into every topic row that features the project.

## 5. Schedule with cron-job.org (10 min)
Render free services sleep when idle; these pings wake them AND trigger the stage.
1. https://cron-job.org (free) → create 4 jobs, all `POST`, each with header `x-run-token: <your RUN_TOKEN from Render env>`:

| URL | Schedule (IST) |
|---|---|
| `/run/layer1` | Monday 06:00 |
| `/run/layer2` | daily 07:00 |
| `/run/layer3` | daily 08:00 |
| `/run/publish` | daily 10:00 |

2. Set each job's timeout to the max allowed (stages can take 1–3 min incl. cold start).

## 6. First supervised run
1. Trigger `/run/layer1` manually (cron-job.org "run now", or curl). Check `L1_Keywords` + `L1_Competitors` fill.
2. Trigger `/run/layer2`. Check `L2_Topics`: keyword plan with min-counts, repeated words with counts, project + file link, **Doc link** (open it — blog + LinkedIn article inside), LLM queries.
3. Trigger `/run/layer3`. Check `L3_QA`: word-count pass, keywords verified n/n, humanised=Yes.
4. In `L2_Topics`, set **Approval = Approved** on the row.
5. Trigger `/run/publish`. In dry_run you'll see the would-be URL in `Published`.
6. When drafts look right: set `PUBLISH_MODE=github` (+ repo vars) or `netlify_api` (+ token) in Render env and re-deploy. Next publish goes live on neopolis-infra.netlify.app.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON env var not set` | Paste the full JSON (one line) in Render env |
| `The caller does not have permission` | Share the Sheet AND Drive folder with the service-account email |
| Layer 1 logs `[trends] fallback` | Normal — Trends rate-limited; autocomplete (first-party) fills in |
| `SERP daily budget exhausted` | Free 100/day cap; waits for tomorrow, or raise `SERP_DAILY_BUDGET` if you enabled billing |
| Layer 3 result `NEEDS REVIEW` | A keyword stayed under count after 2 humanise loops — open the Doc, fix manually, set L2 Status back to `Drafted` and re-run layer 3 |
| 409 `run already in progress` | Stages are serialized on purpose; wait for the previous one |
| LinkedIn `API post failed` | Token expired (LinkedIn tokens last ~60 days) — regenerate, or use the article from the Doc |
