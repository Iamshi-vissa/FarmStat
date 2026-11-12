"""
Read-only access to the live daily prices in Supabase (filled every day by scripts/ingest_live.py).

The publishable key below is meant to be public: the tables only allow reading. Override with the
SUPABASE_URL / SUPABASE_KEY environment variables (for example in Vercel's project settings).
"""

from __future__ import annotations

import json
import os
import re
import statistics
import time
import urllib.parse
import urllib.request

URL = os.environ.get("SUPABASE_URL", "https://irwjvkbgtkyjuwtgkngt.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_LmEKIjlgTrfV4znof_lvMA_tpseHelF")
TTL = 600            # seconds; prices change once a day
_cache: dict = {}


def _get(table: str, params: dict) -> list:
    q = urllib.parse.urlencode(params, safe=",.()*")
    k = f"{table}?{q}"
    hit = _cache.get(k)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    req = urllib.request.Request(f"{URL}/rest/v1/{k}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=5) as r:
        rows = json.loads(r.read() or b"[]")
    _cache[k] = (time.time(), rows)
    return rows


def mandi(crop: str, state: str, market: str, days: int = 45) -> dict:
    """The latest daily prices reported by one mandi (FarmStat's series name, e.g. 'Lasalgaon' or 'Sirsi (Rashi)')."""
    params = {"select": "arrival_date,min_price,max_price,modal_price,variety", "commodity": f"eq.{crop}",
              "state": f"eq.{state}", "order": "arrival_date.desc", "limit": "400"}
    m = re.match(r"^(.*) \((.*)\)$", market) if crop == "Arecanut" else None
    if m:
        params["market"] = f"ilike.{m.group(1)}*"
        params["variety"] = f"eq.{m.group(2)}"
    else:
        params["market"] = f"eq.{market}"
    try:
        rows = _get("daily_prices", params)
    except (OSError, ValueError) as e:   # network errors, timeouts, bad JSON
        return {"available": False, "reason": f"live feed unreachable ({type(e).__name__})"}
    if not rows:
        return {"available": False, "reason": "no live reports for this mandi yet"}
    by_day: dict = {}
    for r in rows:
        by_day.setdefault(r["arrival_date"], []).append(r)
    series = []
    for d in sorted(by_day)[-days:]:
        rs = by_day[d]
        series.append({"date": d, "modal": statistics.median(float(r["modal_price"]) for r in rs),
                       "min": min((float(r["min_price"]) for r in rs if r["min_price"] is not None), default=None),
                       "max": max((float(r["max_price"]) for r in rs if r["max_price"] is not None), default=None),
                       "varieties": len(rs)})
    return {"available": True, "latest": series[-1], "days": series}


def status() -> dict:
    """When prices were last fetched and the model last retrained."""
    try:
        ing = _get("ingest_runs", {"select": "started_at,finished_at,status,rows_upserted,dates_covered",
                                   "order": "id.desc", "limit": "1"})
        mod = _get("model_runs", {"select": "trained_at,version,promoted,champion_mae,challenger_mae,notes",
                                  "order": "id.desc", "limit": "1"})
        latest = _get("daily_prices", {"select": "arrival_date", "order": "arrival_date.desc", "limit": "1"})
    except (OSError, ValueError) as e:   # network errors, timeouts, bad JSON
        return {"available": False, "reason": f"live feed unreachable ({type(e).__name__})"}
    return {"available": True, "last_fetch": ing[0] if ing else None, "last_retrain": mod[0] if mod else None,
            "latest_price_date": latest[0]["arrival_date"] if latest else None}
