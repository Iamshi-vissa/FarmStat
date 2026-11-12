"""
Live mandi prices: fetch the day's prices from data.gov.in (Agmarknet), store them in Supabase,
and turn them into weekly rows that extend the training panel.

  data.gov.in  --fetch-->  normalise  --upsert-->  Supabase daily_prices
  Supabase daily_prices  --read-->  weekly rows  -->  data/live_weekly.csv.gz  -->  forecasts / retraining

Environment:
  DATA_GOV_API_KEY      free key from data.gov.in (My Account > API Keys). Without it the shared sample key is
                        used, which returns only 10 records per call.
  SUPABASE_URL          e.g. https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY  service-role key (writes). Keep it secret: GitHub Actions secret only.
  SUPABASE_KEY          publishable key (reads). Safe to expose; the tables are read-only to the public.

In production the daily fetch runs inside Supabase (Edge Function `ingest-mandi`, scheduled with pg_cron; source in
supabase/functions/ingest-mandi). This module reads those rows back, so the GitHub Actions job needs no secrets.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from .data import LIVE_FILE  # noqa: F401 (re-exported for the scripts)

API = "https://api.data.gov.in/resource/"
CURRENT = "9ef84268-d588-465a-a308-a864a43d0070"   # current daily price, all mandis (lower-case fields)
HISTORY = "35985678-0d79-46b4-9ed6-6f13308a1d24"   # variety-wise daily prices, filterable by date (Title_Case fields)
SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"   # data.gov.in's public sample key

# Agmarknet commodity name -> FarmStat crop
COMMODITIES = {"Onion": "Onion", "Tomato": "Tomato", "Potato": "Potato", "Arecanut(Betelnut/Supari)": "Arecanut"}
FIX_STATE = {"Keralam": "Kerala", "Chattisgarh": "Chhattisgarh", "Delhi": "NCT of Delhi"}
PK = ["arrival_date", "state", "district", "market", "commodity", "variety", "grade"]
SUPABASE_URL = "https://irwjvkbgtkyjuwtgkngt.supabase.co"
PUBLIC_KEY = "sb_publishable_LmEKIjlgTrfV4znof_lvMA_tpseHelF"   # read-only (row-level security), safe to publish
COLS = PK + ["min_price", "max_price", "modal_price"]


# ── HTTP ───────────────────────────────────────────────────────────────
def _request(url: str, *, method: str = "GET", headers: dict | None = None, body: bytes | None = None,
             timeout: int = 60, retries: int = 4):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            code = getattr(e, "code", None)
            if code and 400 <= code < 500 and code != 429:
                detail = e.read().decode(errors="replace")[:300] if hasattr(e, "read") else ""
                raise RuntimeError(f"{method} {url.split('?')[0]} -> HTTP {code}: {detail}") from e
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)
    return None


# ── data.gov.in ────────────────────────────────────────────────────────
def fetch_records(resource: str, filters: dict, api_key: str | None = None, limit: int = 1000,
                  max_pages: int = 60, base: str = API) -> list[dict]:
    """All records for the filters, page by page (data.gov.in returns at most `limit` per call)."""
    key = api_key or os.environ.get("DATA_GOV_API_KEY") or SAMPLE_KEY
    if key == SAMPLE_KEY:
        limit = 10
    out, offset = [], 0
    for _ in range(max_pages):
        q = {"api-key": key, "format": "json", "limit": limit, "offset": offset}
        q.update({f"filters[{k}]": v for k, v in filters.items()})
        page = _request(f"{base}{resource}?{urllib.parse.urlencode(q)}") or {}
        recs = page.get("records", [])
        out.extend(recs)
        total = int(page.get("total", len(out)) or 0)
        offset += len(recs)
        if len(recs) < limit or offset >= total or key == SAMPLE_KEY:
            break
    return out


def fetch_latest(api_key: str | None = None, days_back: int = 7, base: str | None = None) -> list[dict]:
    """Today's prices for every FarmStat crop, plus the last few days (fills days the job missed)."""
    base = base or os.environ.get("DATA_GOV_API_BASE", API)
    recs = []
    for commodity in COMMODITIES:
        recs += fetch_records(CURRENT, {"commodity": commodity}, api_key, base=base)
        for d in range(1, days_back + 1):
            day = (date.today() - timedelta(days=d)).strftime("%d/%m/%Y")
            try:
                recs += fetch_records(HISTORY, {"Commodity": commodity, "Arrival_Date": day}, api_key, base=base)
            except RuntimeError as e:          # the history resource is optional; keep today's prices
                print(f"  history {commodity} {day}: {e}")
                break
    return recs


def _clean_market(name: str) -> str:
    s = " ".join(str(name).replace("APMC", " ").split())
    return s.strip(" -,")


def normalise(records: list[dict]) -> pd.DataFrame:
    """One clean row per day, mandi, commodity, variety and grade, in Rs per quintal."""
    if not records:
        return pd.DataFrame(columns=COLS)
    df = pd.DataFrame([{k.lower(): v for k, v in r.items()} for r in records])
    for c in ["state", "district", "market", "commodity", "variety", "grade"]:
        df[c] = df.get(c, "").fillna("").astype(str).str.strip()
    df = df[df["commodity"].isin(COMMODITIES)].copy()
    df["commodity"] = df["commodity"].map(COMMODITIES)
    df["state"] = df["state"].replace(FIX_STATE)
    df["market"] = df["market"].map(_clean_market)
    df["arrival_date"] = pd.to_datetime(df["arrival_date"].astype(str).str.replace("/", "-"), dayfirst=True,
                                        errors="coerce").dt.date
    for c in ["min_price", "max_price", "modal_price"]:
        df[c] = pd.to_numeric(df.get(c), errors="coerce")
    df = df[df["arrival_date"].notna() & (df["modal_price"] > 0)]
    df = df.sort_values("modal_price").drop_duplicates(PK, keep="last")
    return df[COLS].reset_index(drop=True)


# ── Supabase (PostgREST) ───────────────────────────────────────────────
def _sb_headers(key: str, **extra) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", **extra}


def upsert_daily(df: pd.DataFrame, url: str | None = None, key: str | None = None, chunk: int = 500) -> int:
    url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
    key = key or os.environ["SUPABASE_SERVICE_KEY"]
    rows = json.loads(df.assign(arrival_date=df["arrival_date"].astype(str)).to_json(orient="records"))
    endpoint = f"{url}/rest/v1/daily_prices?on_conflict={','.join(PK)}"
    for i in range(0, len(rows), chunk):
        _request(endpoint, method="POST", body=json.dumps(rows[i:i + chunk]).encode(),
                 headers=_sb_headers(key, Prefer="resolution=merge-duplicates,return=minimal"))
    return len(rows)


def read_daily(since: date, url: str | None = None, key: str | None = None, page: int = 1000) -> pd.DataFrame:
    """All stored daily prices from `since`, paged."""
    url = (url or os.environ.get("SUPABASE_URL") or SUPABASE_URL).rstrip("/")
    key = key or os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY") or PUBLIC_KEY
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode({"select": ",".join(COLS), "arrival_date": f"gte.{since}", "order": "arrival_date"})
        rows = _request(f"{url}/rest/v1/daily_prices?{q}",
                        headers=_sb_headers(key, Range=f"{start}-{start + page - 1}", **{"Range-Unit": "items"})) or []
        out += rows
        if len(rows) < page:
            break
        start += page
    df = pd.DataFrame(out, columns=COLS)
    df["arrival_date"] = pd.to_datetime(df["arrival_date"])
    return df


def log_run(row: dict, url: str | None = None, key: str | None = None, table: str = "ingest_runs") -> None:
    url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
    key = key or os.environ["SUPABASE_SERVICE_KEY"]
    _request(f"{url}/rest/v1/{table}", method="POST", body=json.dumps(row, default=str).encode(),
             headers=_sb_headers(key, Prefer="return=minimal"))


# ── daily -> weekly ────────────────────────────────────────────────────
def to_weekly(daily: pd.DataFrame) -> pd.DataFrame:
    """Weekly rows in the panel's format (week starts Monday).

    Onion, tomato, potato: one series per mandi; the day's price is the median over varieties and grades.
    Arecanut: one series per mandi and variety, like the panel. Arrivals aren't in the daily feed (left empty;
    the models handle missing values)."""
    if daily.empty:
        return pd.DataFrame(columns=["crop", "state", "district", "market", "week", "price", "arrivals_t", "trading_days"])
    d = daily[daily["commodity"].isin(COMMODITIES.values())].copy()   # cashew/sugarcane are stored but not weekly
    d["arrival_date"] = pd.to_datetime(d["arrival_date"])
    d["week"] = d["arrival_date"] - pd.to_timedelta(d["arrival_date"].dt.weekday, unit="D")
    arec = d["commodity"] == "Arecanut"
    d.loc[arec, "market"] = (d.loc[arec, "market"].str.replace(r"\bMarket\b", "", regex=True).str.strip()
                             + " (" + d.loc[arec, "variety"].str.strip().replace({"api": "Api"}) + ")")
    day = (d.groupby(["commodity", "state", "district", "market", "arrival_date", "week"], as_index=False)
           ["modal_price"].median())
    wk = (day.groupby(["commodity", "state", "district", "market", "week"], as_index=False)
          .agg(price=("modal_price", "mean"), trading_days=("arrival_date", "nunique")))
    wk["arrivals_t"] = np.nan
    wk = wk.rename(columns={"commodity": "crop"})
    return wk[["crop", "state", "district", "market", "week", "price", "arrivals_t", "trading_days"]]


def write_live_weekly(weekly: pd.DataFrame, path=LIVE_FILE) -> int:
    weekly.sort_values(["crop", "state", "market", "week"]).to_csv(path, index=False, float_format="%.2f")
    return len(weekly)


def utcnow() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
