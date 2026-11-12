# FARMSTAT LIVE DATA RUNBOOK

Use this when the live prices look stale, an ingest run failed, or you need to back-fill, rotate a key or pause
collection. The pipeline itself is described in the README under LIVE DATA.

## WHAT RUNS WHEN

| Job | Where | Schedule (UTC) | Does |
|---|---|---|---|
| `farmstat-today-onion` / `-tomato` / `-potato` / `-others` | Supabase pg_cron | :30, :34, :38, :42 past 10, 13 and 16 | Today's reports into `daily_prices` |
| `farmstat-queue-yesterday` | Supabase pg_cron | 19:05 daily | Adds yesterday to `backfill_queue` |
| `farmstat-backfill` | Supabase pg_cron | every 3 minutes | Loads the newest pending (day, crop) |
| `farmstat-net-cleanup` | Supabase pg_cron | 03:00 daily | Trims pg_net's response log |
| `daily-prices.yml` | GitHub Actions | 17:15 daily | Weekly rows + new forecasts, committed to the repo |
| `weekly-retrain.yml` | GitHub Actions | Sunday 21:30 (Monday 03:00 IST) | Champion / challenger retrain |

## PREREQUISITES

- Access to the Supabase project `farmstat` (SQL editor, Edge Functions, logs).
- Write access to the GitHub repository (Actions tab) for the forecast jobs.
- For redeploying the function: the [Supabase CLI](https://supabase.com/docs/guides/cli), then `supabase login` and
  `supabase link --project-ref <project ref>`.
- Secrets, all optional: `DATA_GOV_IN_API_KEY` (Edge Function secret, used for collecting), and in the GitHub
  repository `DATA_GOV_API_KEY` (same data.gov.in key, for the Python client) and `SUPABASE_SERVICE_KEY` (lets the jobs
  write `ingest_runs` / `model_runs`; without it the sidebar shows no retrain date).
- Where things are defined: the function in `supabase/functions/ingest-mandi/`, the token guard in
  `supabase/migrations/`. The pg_cron jobs and `farmstat_private.call_ingest` were created in the Supabase SQL editor;
  list them with `select jobname, schedule, active from cron.job;`.

## CHECK HEALTH

1. Open the web app: the sidebar footer shows the live feed's latest price date and when it was checked.
2. In the Supabase SQL editor, look at the latest runs:

   ```sql
   select id, started_at, status, rows_fetched, rows_upserted, dates_covered, message
   from ingest_runs order by id desc limit 10;
   ```

   - `ok`: every page loaded. `partial`: some pages failed; today's pulls fill them in on the next run.
   - `error`: see `message`. `failed`: written by the GitHub job (`scripts/ingest_live.py`) when it couldn't finish.
   - `running` older than about 3 minutes: the function was stopped mid-run (time limit or crash); the next run carries on.
   - Back-fill days are given up after 4 tries even if incomplete. Find them and re-run them by hand (below):

     ```sql
     select day, crop, attempts, rows_upserted from backfill_queue where attempts >= 4 order by day desc;
     ```
3. Back-fill progress:

   ```sql
   select count(*) filter (where done_at is null) as pending, count(*) as total from backfill_queue;
   ```

4. What the function returned to the scheduler:

   ```sql
   select id, status_code, left(content::text, 200) from net._http_response order by id desc limit 5;
   ```

   `401 missing or wrong x-ingest-token` means a caller didn't go through `farmstat_private.call_ingest` (see below).

## COMMON FIXES

**Runs are `partial` with "N of M" notes.** The public sample key returns 10 records per request and is throttled, so
large days don't finish in one run. They are retried automatically. To fix it for good, register a free key at
[data.gov.in](https://data.gov.in) and add it as the Edge Function secret `DATA_GOV_IN_API_KEY` (Edge Functions → Secrets).
No redeploy is needed.

**Nothing new for a day or more.** First check that the schedules fired:

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname like 'farmstat-%' order by d.start_time desc limit 20;
```

`succeeded` there only means the request was sent; the function's own answer is in the step-4 query above. Then run
one pull by hand:

```sql
select farmstat_private.call_ingest('{"commodities":["Onion"],"budget_s":60}'::jsonb);
```

Allow about 2 minutes, then check `ingest_runs`. If data.gov.in itself is down, runs show `error` with a network message; the
schedules resume on their own.

**Back-fill a date range** (at most 31 days per call):

```sql
select farmstat_private.call_ingest('{"from":"2026-10-01","to":"2026-10-07","commodities":["Onion","Tomato"]}'::jsonb);
```

Only one back-fill runs at a time, and the scheduled `farmstat-backfill` counts, so a manual call often gets `409`.
You won't see that directly: check the step-4 query. If it says 409, wait a few minutes or pause `farmstat-backfill`
first (below). Allow about 2 minutes per call.

**The web app shows old forecasts.** Open the latest `daily-prices` run in GitHub Actions. If it failed, re-run it; it
needs no secrets. If it passed but the site is old, check that Vercel redeployed the commit it made.

## PAUSE OR RESUME COLLECTION

```sql
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'farmstat-%';   -- pause
select cron.alter_job(jobid, active := true)  from cron.job where jobname like 'farmstat-%';   -- resume
```

Pausing these doesn't stop the GitHub jobs: to stop forecast updates too, disable `daily-prices.yml` and
`weekly-retrain.yml` in the repository's Actions tab.

## ROTATE THE INGEST TOKEN

The token only proves a call came from the project's own schedules. Rotating it takes effect on the next call:

```sql
update farmstat_private.settings
set value = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where key = 'ingest_token';
```

## ROLL BACK THE EDGE FUNCTION

```bash
git checkout <good commit> -- supabase/functions/ingest-mandi/index.ts
supabase functions deploy ingest-mandi
git checkout HEAD -- supabase/functions/ingest-mandi/index.ts      # restore your working tree
```

The tables haven't changed between versions, so no data migration is needed. Versions before 13 Nov 2026 don't check
the ingest token; they keep working with the schedules, which send it anyway.

## ESCALATION

- data.gov.in outages or API changes: the contact page on data.gov.in.
- Supabase platform problems: the project's support page in the Supabase dashboard.
- Everything else: open an issue in the GitHub repository.
