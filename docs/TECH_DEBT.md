# FARMSTAT TECH DEBT REGISTER

Last reviewed 19 Nov 2026. Each item is scored with **Priority = (Impact + Risk) × (6 − Effort)**, each 1–5, so a
bigger number means fix sooner. Items fixed in this review are listed at the end.

## OPEN ITEMS, HIGHEST PRIORITY FIRST

| # | Item | Type | Impact | Risk | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | The web build is committed instead of built by Vercel | Infrastructure | 3 | 4 | 2 | 28 |
| 2 | The Supabase cron jobs and `call_ingest` exist only in the database, not in `supabase/migrations/` | Infrastructure | 2 | 4 | 2 | 24 |
| 3 | No alert when the ingest or the daily job fails | Infrastructure | 2 | 3 | 2 | 20 |
| 4 | Only about half of live mandi names match a history series | Data | 3 | 3 | 3 | 18 |
| 5 | scikit-learn is pinned to one version; CI uses Python 3.12, development uses 3.13 | Dependency | 2 | 2 | 2 | 16 |
| 6 | The range calibration isn't refreshed by the weekly retrain | Model | 2 | 3 | 3 | 15 |
| 7 | Two sources of model results: the README's first tables quote the notebook, the app and validation quote the re-run | Documentation | 1 | 2 | 2 | 12 |
| 8 | `App.jsx` holds all navigation state in one component with several linked effects | Code | 2 | 2 | 3 | 12 |
| 9 | Data and model files live in git (`.git` is 48 MB) | Infrastructure | 1 | 2 | 3 | 9 |

### WHY EACH MATTERS AND THE FIX

1. **Committed web build.** Two releases this week changed `web/src` without recommitting `web/dist`, so the live site
   kept the old design. CI now fails when `web/dist` is stale, which catches it, but the build is still a manual
   step. *Fix:* let Vercel run `npm ci && npm run build` in `web/` (a build command plus `outputDirectory`, with the
   API kept as a function), then remove `web/dist` from git. *Effort:* half a day, including a test deploy.
2. **Schedules outside the repo.** If the Supabase project were recreated, nobody could rebuild the seven cron jobs,
   the back-fill queue or `farmstat_private.call_ingest` from the repo. *Fix:* export them with
   `select jobname, schedule, command from cron.job` and the function definitions into a migration (keep the token out:
   it's generated in the database).
3. **Silent failures.** A failed GitHub job emails the repo owner, but an Edge Function that keeps returning `partial`
   or `error` is only visible in `ingest_runs`. *Fix:* a daily SQL check (pg_cron) that posts to a webhook when no run
   was `ok` in 24 hours, or a GitHub job that reads `/api/live/status` and fails if `latest_price_date` is over 2 days old.

4. **Name matching.** Live reports for mandis whose names differ slightly from Agmarknet's history ("Kolar" and "Kolar
   APMC" are handled; spelling variants aren't) start as new series with no history, so they get no forecast for weeks.
   *Fix:* a reviewed mapping file (`data/mandi_aliases.csv`) applied in `farmstat.live`, seeded by fuzzy matching
   within the same district.
5. **Pinned versions.** The saved models need scikit-learn 1.9.1 exactly. *Fix:* when upgrading, retrain and save
   with the new version in the same commit; align `.python-version`, CI and Vercel on one Python version.
6. **Calibration drift.** `models/range_calibration.json` comes from `scripts/evaluate.py` (about 20 minutes of
   training). The weekly retrain changes the model but keeps the old shifts. They are small and stable (the 4-week low end
   moves about 11% in log terms), so the risk is low. *Fix:* re-run `evaluate.py` and `calibrate_ranges.py` monthly, or
   after any model change, in a scheduled workflow.
7. **Two result sets.** The app's accuracy section (in About) now reads only the re-run (`reports/evaluation.json`), but the
   README's first tables still quote the notebook (ROC-AUC 0.746 vs 0.732). Both are explained, but readers stumble. *Fix:* make `scripts/evaluate.py`
   the only source and have the notebook load its output.

8. **App state.** Crop, state, mandi, view and the address bar are kept in step by five effects in `App.jsx`. Choosing
    the page is now one readable `page()` switch, but the effects remain and each new screen adds a case. *Fix:* move it into a `useNavigation()` hook backed by the
    URL, with unit tests for the transitions (crop change, mandi missing for a crop, deep links).
9. **Large files in git.** The weekly data (5.3 MB), the models (3 MB) and the daily job's commits grow the history.
    *Fix:* Git LFS for `data/` and `models/`, or keep only the latest data in the repo and the history in Supabase.

## PLAN

- **Next release:** items 1 and 2 (they protect deploys and recovery), plus 3 (a one-file workflow).
- **Alongside feature work:** 6 with the next model change, 8 when a new screen is added.
- **When there's time:** 4, 5, 7, 9.

## FIXED IN THIS REVIEW

- **Stale live site:** `web/dist` was rebuilt and committed. A new CI workflow (`.github/workflows/ci.yml`) runs ruff,
  the tests and a check that `web/dist` matches `web/src` on every push.
- **Path traversal guard:** the route that serves the web app now refuses any file outside `web/dist`, with a test.
- **Start-up time:** API cold start dropped from 2.5 s to 1.4 s. The outlier filter now uses one grouped rolling
  median instead of a Python function per series, and the sparklines sort once instead of 1,444 times.
- **Mandi history lookups:** about 15 ms to 4 ms, using a precomputed row index instead of scanning all 635,000 rows
  per request.
- **Memory-safe caches:** `functools.lru_cache` on methods was replaced with per-instance caches (ruff B019).
- **Duplicate requests:** the web client now shares an in-flight request instead of sending it twice. The overview's
  data and code start loading alongside `/api/meta`, and the chart library loads when the browser is idle.
- **Forecast ranges:** the app's 10th–90th percentile ranges are now calibrated (split-conformal, one shift per tail,
  learned from three out-of-sample years). Coverage across 2023–2026 is 80–81% at every horizon, against 67–79% before.
- **Repo hygiene:** removed 13 screenshots the README no longer uses, fixed all ruff findings, and made the
  Streamlit `zip()` calls strict.
- **Web code cleanup (November 2026):** ESLint added (`npm run lint`, zero warnings, run in CI); duplicated
  screen-size, browser-storage and event code moved into `hooks.js`, `storage.js` and `events.js`; inline spacing
  replaced by one `.page` stack; the WebGL contour background replaced by a pre-rendered image, removing two ~1.5 s
  main-thread stalls after load.
- **Product rebuild (November 2026):** cashew and sugarcane removed end to end (app, API, monthly model, data, ingest
  schedule, notebook); the Streamlit app retired; the Compare and mandi pages trimmed of panels that repeated the
  overview or the main chart; the Accuracy page reads one source; browser tests (`tests/e2e`) added and run in CI;
  unknown API paths return 404 instead of the app page; old links to removed crops open the overview.
- **Redesign and weight cut (November 2026):** the app opens on a crop choice (nothing pre-selected); search finds only
  the chosen crop's mandis; the Mandi tab is gone (a mandi opens from the panel, search, Compare or the overview);
  Recharts replaced by hand-written SVG charts and three of four font families dropped, taking the app's JavaScript
  from about 225 kB to 107 kB compressed; the split-flap board, paper slip and contour image removed.
