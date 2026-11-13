# FARMSTAT DEPLOY CHECKLIST

Use this for every push to `main`. Vercel deploys `main` automatically, so the checks below happen before the push.
The live-data pipeline (Supabase) and the scheduled GitHub jobs have their own runbook: [RUNBOOK.md](RUNBOOK.md).

## WHAT SHIPS WHERE

| Part | Where it runs | How it updates |
|---|---|---|
| Web app (`web/dist`) | Vercel, served by the FastAPI app | **Committed build.** Vercel does not run Vite, so `web/dist` must be rebuilt and committed with any change in `web/src` |
| API (`api/`, `src/farmstat/`) | Vercel Python function (`index.py`) | Every push to `main` |
| Forecasts (`models/web_snapshot.json.gz`) | Read by the API at start-up | Daily job, weekly retrain, or `scripts/build_snapshot.py` |
| Range calibration (`models/range_calibration.json`) | Used when the snapshot is built | `scripts/evaluate.py` then `scripts/calibrate_ranges.py` |
| Ingest function | Supabase Edge Functions | `supabase functions deploy ingest-mandi` (not on push) |
| Database changes | Supabase | Migrations in `supabase/migrations/`, applied by hand |

## BEFORE PUSHING

- [ ] **Tests pass:** `python -m pytest -q tests`
- [ ] **Lint is clean:** `ruff check --select F,E9,B,UP,SIM,PERF --target-version py311 api src scripts tests streamlit_app.py index.py`
- [ ] **Web build is fresh and committed:** `cd web && npm run build`, then `git status web/dist` shows the new files
  staged. CI fails the push if `web/dist` doesn't match `web/src`.
- [ ] **Snapshot is current:** if models, data, calibration or `SNAPSHOT_VERSION` changed, run
  `python scripts/build_snapshot.py` and commit `models/web_snapshot.json.gz`. Otherwise the deployed API (which has no
  scikit-learn) can't rebuild it and fails to start.
- [ ] **Bundle stays under Vercel's 500 MB function limit:** nothing new and large outside `.vercelignore`
  (`du -sh` the folders that aren't ignored).
- [ ] **Screens checked** at 1440, 1100, 820 and 390 px: the overview, a mandi page, compare, accuracy, about. No
  sideways scroll and no console errors.
- [ ] **No secrets in the diff:** `git diff --cached | grep -E "ghp_|sb_secret|service_role"` finds nothing. The
  publishable Supabase key and the anon JWT are public by design.
- [ ] **Commit author is the project owner,** with no co-author trailers.

## IF THE RELEASE TOUCHES SUPABASE

- [ ] Migration SQL saved in `supabase/migrations/` before it's applied.
- [ ] After applying: `select * from cron.job where jobname like 'farmstat-%'` shows every job active, and Supabase's
  security advisor reports no issues.
- [ ] After deploying the Edge Function: one manual pull succeeds (RUNBOOK → "Nothing new for a day or more") and a
  call without `x-ingest-token` gets 401.

## AFTER THE PUSH

- [ ] The Vercel deployment for the commit is **Ready** and its build log shows no errors.
- [ ] **Smoke test the live site** (2 minutes):
  1. The home page opens on the India overview with no mandi selected.
  2. Hovering the left rail opens the mandi panel; choosing a state and a mandi opens its page.
  3. Ctrl/⌘ K finds a mandi ("kolar tom") and opens it.
  4. `/api/live/status` returns `available: true` with a recent `latest_price_date`.
  5. `/api/overview?crop=Onion` and `/api/series?crop=Onion&state=Maharashtra&market=Lasalgaon` return 200.
- [ ] First load of the overview takes under about 2 s on a normal connection. A cold start (first request after an
  idle spell) takes longer, but under 5 s.

## ROLL BACK IF

- The home page or `/api/meta` returns an error, or the site shows an old design (the stale `web/dist` symptom).
- `/api/series` or `/api/overview` returns 500 for crops and mandis that worked before.
- Forecast ranges or advice change for every mandi without a model or calibration change in the release.

**How:** in Vercel, promote the previous Ready deployment, or revert the commit and push. Data and model files are
versioned in git, so a revert restores the previous forecasts too. To roll back the Edge Function, follow
RUNBOOK → "Roll back the Edge Function".
