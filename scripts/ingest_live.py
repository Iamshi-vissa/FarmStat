"""
Daily job: fetch the latest mandi prices from data.gov.in, store them in Supabase, rebuild the live weekly
rows and refresh the forecasts the web app shows.

    python scripts/ingest_live.py                 # normal daily run (last 7 days)
    python scripts/ingest_live.py --days 120      # backfill a longer gap
    python scripts/ingest_live.py --no-db         # try the fetch without Supabase (prints a summary)

Prices are normally collected inside Supabase (Edge Function ingest-mandi on a pg_cron schedule). Without
SUPABASE_SERVICE_KEY this script only reads them back (public read-only key) and refreshes the forecasts, so the
GitHub Actions job needs no secrets. With SUPABASE_SERVICE_KEY (and ideally DATA_GOV_API_KEY) set, it also fetches
from data.gov.in itself and stores what it finds, as a second source.
"""

import argparse
import os
import sys
import time
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from farmstat import live  # noqa: E402
from farmstat.data import DATA_FILE  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="also fetch this many past days (fills missed runs)")
    ap.add_argument("--no-db", action="store_true", help="fetch and summarise only")
    ap.add_argument("--no-snapshot", action="store_true", help="skip refreshing the forecasts")
    a = ap.parse_args()

    t0 = time.time()
    if not live.LIVE_FILE.exists():   # first run: fill the whole gap since the history panel ends
        panel_end = pd.read_csv(DATA_FILE, usecols=["week"], parse_dates=["week"])["week"].max()
        gap = (pd.Timestamp.today().normalize() - panel_end).days + 7
        if gap > a.days:
            print(f"No live data yet: fetching the last {gap} days to fill the gap since {panel_end:%d %b %Y}")
            a.days = gap
    run = {"started_at": live.utcnow(), "status": "running"}
    cloud_only = not os.environ.get("SUPABASE_SERVICE_KEY")
    if cloud_only:
        a.no_db = False
        print("Reading prices collected by the Supabase ingest-mandi function (no write key: skipping own fetch).")
    elif not os.environ.get("DATA_GOV_API_KEY"):
        print("! DATA_GOV_API_KEY is not set: using data.gov.in's sample key (10 records per call).")
    try:
        recs = [] if cloud_only else live.fetch_latest(days_back=a.days)
        daily = live.normalise(recs)
        run["rows_fetched"] = len(recs)
        if len(daily):
            run["dates_covered"] = f"{min(daily.arrival_date)} to {max(daily.arrival_date)}"
        print(f"Fetched {len(recs):,} records -> {len(daily):,} clean rows ({run.get('dates_covered', 'no dates')})")
        print(daily.groupby("commodity").size().to_string() if len(daily) else "  nothing for FarmStat crops")
        if a.no_db:
            return 0

        run["rows_upserted"] = live.upsert_daily(daily) if len(daily) and not cloud_only else 0

        # rebuild every live week from the cloud copy, starting a week before the panel ends
        panel_end = pd.read_csv(DATA_FILE, usecols=["week"], parse_dates=["week"])["week"].max()
        stored = live.read_daily(since=(panel_end - timedelta(days=7)).date())
        weekly = live.to_weekly(stored)
        run["weeks_appended"] = live.write_live_weekly(weekly)
        print(f"Live weekly rows: {len(weekly):,} from {len(stored):,} stored daily prices")

        if not a.no_snapshot:
            from api.service import SNAPSHOT, build_snapshot, fingerprint, load_prices, write_snapshot
            snap = build_snapshot(load_prices(), fingerprint())
            write_snapshot(snap, SNAPSHOT)
            print(f"Forecasts refreshed for {len(snap['latest']):,} mandi series")

        run.update(status="ok", finished_at=live.utcnow(), message=f"{time.time() - t0:.0f}s")
        return 0
    except Exception as e:  # noqa: BLE001 - log any failure, then fail the job
        run.update(status="failed", finished_at=live.utcnow(), message=str(e)[:500])
        print(f"FAILED: {e}")
        return 1
    finally:
        if not a.no_db and not cloud_only:
            try:
                live.log_run(run)
            except Exception as e:  # noqa: BLE001
                print(f"could not log the run: {e}")


if __name__ == "__main__":
    sys.exit(main())
