"""
Download daily mandi prices for extra crops (arecanut, cashew) for every state
from the Agmarknet public report service (the same one the "Daily Price and
Arrival Report" page on agmarknet.gov.in uses; no login needed). Data starts 2021.

Uses only the Python standard library.

Usage (from the FarmStat folder):
    py -3.12 scripts/download_agmarknet.py
Output:
    data/agmarknet_extra_raw.csv
"""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

BASE = "https://api.agmarknet.gov.in/v1"
WANTED = {"Arecanut": ["arecanut", "betelnut", "supari"], "Cashew": ["cashew"]}
ALL_DISTRICTS, ALL_MARKETS, ALL_GRADES, PRICE, ALL_VARIETIES = 100001, 100002, 100003, 100004, 100007
START = date(2021, 1, 1)
PAGE = 1000
OUT = Path(__file__).resolve().parents[1] / "data" / "agmarknet_extra_raw.csv"
HEADERS = {"User-Agent": "FarmStat student project (non-commercial)", "Content-Type": "application/json"}


def call(path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    for attempt in range(4):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers=HEADERS, method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30 * (attempt + 1)); continue
            if e.code == 404:
                return {}
            last = e
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 ** attempt)
    print(f"   ! giving up on {path}: {last}")
    return {}


def iso_date(v) -> str:
    """'25-03-2024' or '25/03/2024' -> '2024-03-25' (other formats are kept as they are)."""
    t = str(v or "").strip().replace("/", "-")
    p = t.split("-")
    return f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 and len(p[2]) == 4 else t


def num(v) -> str:
    return str(v or "").replace(",", "").strip()


def main() -> None:
    print("Getting the list of states and commodities ...")
    f = call("/daily-price-arrival/filters").get("data")
    if not f:
        sys.exit("Could not reach api.agmarknet.gov.in - check your internet connection and try again.")
    states = [(s["state_name"].strip(), int(s["state_id"])) for s in f["state_data"]]
    crops = {}
    for c in f["cmdt_data"]:
        name = c["cmdt_name"].strip()
        for crop, keys in WANTED.items():
            if any(k in name.lower() for k in keys):
                crops.setdefault(crop, []).append((name, int(c["cmdt_id"]), int(c["cmdt_group_id"])))
    for crop, items in crops.items():
        print(f"  {crop}: {[i[0] for i in items]}")
    missing = set(WANTED) - set(crops)
    if missing:
        print(f"  (not found in Agmarknet's list: {missing})")

    OUT.parent.mkdir(exist_ok=True)
    cols = ["crop", "commodity", "state", "district", "market", "variety", "grade", "date", "min_price", "max_price", "modal_price"]
    total = 0
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(cols)
        for crop, items in crops.items():
            for cname, cid, gid in items:
                for sname, sid in states:
                    n_state = 0
                    start = START
                    while start <= date.today():
                        end = min(start + timedelta(days=364), date.today())
                        page = 1
                        while True:
                            doc = call("/daily-price-arrival/report", {
                                "from_date": start.isoformat(), "to_date": end.isoformat(), "data_type": str(PRICE),
                                "group": str(gid), "commodity": str(cid), "state": f"[{sid}]",
                                "district": f"[{ALL_DISTRICTS}]", "market": f"[{ALL_MARKETS}]",
                                "grade": f"[{ALL_GRADES}]", "variety": f"[{ALL_VARIETIES}]",
                                "page": str(page), "limit": str(PAGE)})
                            recs = ((doc.get("data") or {}).get("records")) or []
                            rows = [r for g in recs for r in g.get("data", [])]
                            for r in rows:
                                w.writerow([crop, cname, r.get("state_name") or sname, r.get("district_name"),
                                            r.get("market_name"), r.get("variety_name"), r.get("grade_name"),
                                            iso_date(r.get("arrival_date")), num(r.get("min_price")),
                                            num(r.get("max_price")), num(r.get("model_price"))])
                            n_state += len(rows)
                            if len(rows) < PAGE:
                                break
                            page += 1
                            time.sleep(1)
                        start = end + timedelta(days=1)
                        time.sleep(1)
                    if n_state:
                        print(f"  {crop:9s} {sname:25s} {n_state:7,d} rows")
                        total += n_state
                    fh.flush()
    print(f"\nDone: {total:,} rows saved to {OUT}")


if __name__ == "__main__":
    main()
