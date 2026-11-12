"""
Prepares everything the web app shows: the latest forecast for every mandi, price history,
cashew and sugarcane data, and the test results. Built once at start-up and cached to disk.
"""

from __future__ import annotations

import hashlib
import pickle
import sys
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import CROPS, DATA_FILE, KEY, load_prices  # noqa: E402
from farmstat.features import build_dataset  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, MAX_HOLD_WEEKS, Forecaster  # noqa: E402
from farmstat.monthly import (M_HORIZONS, MONTHLY_FILE, MonthlyForecaster, build_monthly,  # noqa: E402
                              load_monthly, product_label)

CACHE_DIR = ROOT / ".cache"
CASHEW_MODEL = ROOT / "models" / "cashew_model.joblib"
ACTIVE_WEEKS = 8
FRP = [("2019-20", "2019-10-01", 275), ("2020-21", "2020-10-01", 285), ("2021-22", "2021-10-01", 290),
       ("2022-23", "2022-10-01", 305), ("2023-24", "2023-10-01", 315), ("2024-25", "2024-10-01", 340),
       ("2025-26", "2025-10-01", 355), ("2026-27", "2026-10-01", 365)]


def _fingerprint() -> str:
    h = hashlib.md5()
    for p in [DATA_FILE, DEFAULT_MODEL_PATH, Path(__file__)]:
        h.update(f"{p}:{p.stat().st_mtime_ns}:{p.stat().st_size}".encode())
    return h.hexdigest()[:12]


def _clean(v):
    """Make a value JSON-safe."""
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    return v


def records(df: pd.DataFrame) -> list[dict]:
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict("records")]


class FarmData:
    def __init__(self):
        self.model = Forecaster.load()
        self.prices = load_prices()
        cache = CACHE_DIR / f"latest_{_fingerprint()}.pkl"
        if cache.exists():
            self.latest = pickle.loads(cache.read_bytes())
        else:
            ds = build_dataset(self.prices, states=self.model.states)
            latest = ds.sort_values("week").groupby(KEY).tail(1)
            latest = latest[latest["week"] >= latest.groupby("crop")["week"].transform("max")
                            - pd.Timedelta(weeks=ACTIVE_WEEKS)]
            latest = latest.join(self.model.predict(latest)).reset_index(drop=True)
            adv = [self.model.advise(r["crop"], r["price"], r) for _, r in latest.iterrows()]
            latest["advice"] = [a.action for a in adv]
            latest["hold_weeks"] = [a.hold_weeks for a in adv]
            latest["advice_headline"] = [a.headline for a in adv]
            latest["advice_detail"] = [a.detail for a in adv]
            keep = ["week", "crop", "state", "district", "market", "price", "arrivals", "new_mandi", "naive",
                    "prob_rise", "advice", "hold_weeks", "advice_headline", "advice_detail"]
            keep += [f"p{q}_{h}" for h in self.model.horizons for q in (10, 50, 90)]
            self.latest = latest[keep]
            CACHE_DIR.mkdir(exist_ok=True)
            for old in CACHE_DIR.glob("latest_*.pkl"):
                old.unlink()
            cache.write_bytes(pickle.dumps(self.latest))
        # last 12 weekly prices per series, for the sparklines in the mandi list
        recent = self.prices[self.prices["week"] >= self.prices["week"].max() - pd.Timedelta(weeks=40)]
        self.spark = {k: g.sort_values("week")["price"].tail(12).round(0).tolist() for k, g in recent.groupby(KEY)}

    # ── weekly crops ────────────────────────────────────────────────────────
    def meta(self) -> dict:
        lt = self.latest
        base = lt["market"].str.replace(r" \(.*\)$", "", regex=True)
        crops = []
        for c in CROPS:
            sub = lt[lt["crop"] == c]
            if len(sub):
                crops.append(dict(id=c, kind="weekly", series=len(sub),
                                  states=[dict(name=s, count=int(n)) for s, n in sub.groupby("state").size().items()],
                                  data_until=_clean(sub["week"].max()), naive=bool(sub["naive"].all())))
        crops.append(dict(id="Cashew", kind="monthly"))
        crops.append(dict(id="Sugarcane", kind="info"))
        return dict(crops=crops, n_mandis=int(pd.DataFrame({"s": lt["state"], "b": base}).drop_duplicates().shape[0]),
                    n_states=int(lt["state"].nunique()), horizons=self.model.horizons,
                    max_hold_weeks=MAX_HOLD_WEEKS, version=self.model.version)

    def mandis(self, crop: str, state: str) -> list[dict]:
        sub = self.latest[(self.latest["crop"] == crop) & (self.latest["state"] == state)].copy()
        h = 1 if crop == "Tomato" else 2
        sub["change"] = sub[f"p50_{h}"] / sub["price"] - 1
        sub["horizon"] = h
        out = records(sub.sort_values("market"))
        for r in out:
            r["spark"] = self.spark.get((crop, state, r["market"]), [])
        return out

    def series(self, crop: str, state: str, market: str, weeks: int = 104) -> dict | None:
        row = self.latest[(self.latest["crop"] == crop) & (self.latest["state"] == state) & (self.latest["market"] == market)]
        if row.empty:
            return None
        r = row.iloc[0]
        hist = self.prices[(self.prices["crop"] == crop) & (self.prices["state"] == state) & (self.prices["market"] == market)]
        hist = hist[hist["week"] >= r["week"] - pd.Timedelta(weeks=weeks)].sort_values("week")
        fc = [dict(week=_clean(r["week"]), p10=_clean(r["price"]), p50=_clean(r["price"]), p90=_clean(r["price"]), h=0)]
        for h in self.model.horizons:
            fc.append(dict(week=_clean(r["week"] + pd.Timedelta(weeks=h)), h=h,
                           p10=_clean(r[f"p10_{h}"]), p50=_clean(r[f"p50_{h}"]), p90=_clean(r[f"p90_{h}"])))
        return dict(latest={k: _clean(v) for k, v in r.items()},
                    history=records(hist[["week", "price", "arrivals_t"]]), forecast=fc)

    def national(self, crop: str, variety: str | None = None) -> dict:
        sub = self.latest[self.latest["crop"] == crop]
        if variety:
            sub = sub[sub["market"].str.endswith(f"({variety})")]
        recent = sub[sub["week"] >= sub["week"].max() - pd.Timedelta(weeks=2)]
        states = recent.groupby("state")["price"].agg(["median", "size"]).sort_values("median", ascending=False)
        top = recent.sort_values("price", ascending=False).head(15)
        return dict(states=[dict(state=s, median=_clean(m), mandis=int(n)) for s, (m, n) in states.iterrows()],
                    top=records(top[["state", "district", "market", "week", "price", "advice"]]))

    # ── cashew ──────────────────────────────────────────────────────────────
    @lru_cache(maxsize=1)
    def cashew(self) -> dict:
        fc = MonthlyForecaster(joblib.load(CASHEW_MODEL))
        df = load_monthly("Cashew")
        last = build_monthly(df).sort_values("month").groupby("state").tail(1)
        last = last.join(fc.predict(last))
        states = []
        for _, r in last.iterrows():
            hist = df[df["state"] == r["state"]].sort_values("month")
            fcast = [dict(month=_clean(r["month"]), p10=_clean(r["price"]), p50=_clean(r["price"]), p90=_clean(r["price"]), h=0)]
            for h in M_HORIZONS:
                fcast.append(dict(month=_clean(r["month"] + pd.DateOffset(months=h)), h=h, p10=_clean(r[f"p10_{h}"]),
                                  p50=_clean(r[f"p50_{h}"]), p90=_clean(r[f"p90_{h}"])))
            states.append(dict(state=r["state"], product=product_label("Cashew", hist["price"].median()),
                               month=_clean(r["month"]), price=_clean(r["price"]),
                               history=records(hist[["month", "price"]]), forecast=fcast))
        season = [dict(month=pd.Timestamp(2000, int(m), 1).strftime("%b"), pct=v) for m, v in sorted(fc.bundle["season"].items())]
        return dict(states=states, season=season, metrics=fc.metrics)

    # ── sugarcane ───────────────────────────────────────────────────────────
    @lru_cache(maxsize=1)
    def sugarcane(self) -> dict:
        s = pd.read_csv(MONTHLY_FILE)
        s = s[(s["crop"] == "Sugarcane") & (s["state"] == "Chhattisgarh") & s["price"].notna()].sort_values("month")
        return dict(frp=[dict(season=a, start=b, price=c) for a, b, c in FRP],
                    current=dict(season="2026-27", price=365, recovery=10.25, step=3.56, floor=338.3, floor_below=9.5),
                    chhattisgarh=records(s[["month", "price"]]))

    def accuracy(self) -> dict:
        return self.model.metrics
