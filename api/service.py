"""
Prepares everything the web app shows: the latest forecast for every mandi, price history,
cashew and sugarcane data, and the test results.

Everything that needs the trained models (the forecasts, advice, cashew forecasts and test results) is
computed once and saved as a snapshot, so the web app itself runs without scikit-learn:

  1. models/web_snapshot.json.gz   committed with the repo (used on Vercel, where the disk is read-only)
  2. .cache/ or the temp folder     written on first start if the committed snapshot doesn't match
                                    the current data and models (this step needs scikit-learn)

After retraining or updating the data, rebuild the committed snapshot:  python scripts/build_snapshot.py
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import CROPS, DATA_FILE, KEY, LIVE_FILE, load_prices  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, MAX_HOLD_WEEKS  # noqa: E402
from farmstat.monthly import M_HORIZONS, MONTHLY_FILE, build_monthly, load_monthly, product_label  # noqa: E402

CASHEW_MODEL = ROOT / "models" / "cashew_model.joblib"
SNAPSHOT = ROOT / "models" / "web_snapshot.json.gz"
SNAPSHOT_VERSION = "3"   # bump when the snapshot's contents change shape
ACTIVE_WEEKS = 8
WARMUP_WEEKS = 4        # a live series needs this many reported weeks in the last 13 before the model forecasts it
FRP = [("2019-20", "2019-10-01", 275), ("2020-21", "2020-10-01", 285), ("2021-22", "2021-10-01", 290),
       ("2022-23", "2022-10-01", 305), ("2023-24", "2023-10-01", 315), ("2024-25", "2024-10-01", 340),
       ("2025-26", "2025-10-01", 355), ("2026-27", "2026-10-01", 365)]


def fingerprint() -> str:
    """Content hash of the data and models the snapshot was built from."""
    h = hashlib.md5(SNAPSHOT_VERSION.encode())
    for p in [DATA_FILE, LIVE_FILE, MONTHLY_FILE, DEFAULT_MODEL_PATH, CASHEW_MODEL]:
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()[:12]


def _cache_files() -> list[Path]:
    """Where a rebuilt snapshot may be written: the project folder, else the temp folder."""
    tmp = Path(os.environ.get("FARMSTAT_CACHE", Path(tempfile.gettempdir()) / "farmstat"))
    return [ROOT / ".cache" / SNAPSHOT.name, tmp / SNAPSHOT.name]


def read_snapshot(path: Path, fp: str) -> dict | None:
    """The snapshot at `path`, or None if it's missing or was built from other data/models."""
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        snap = json.load(f)
    if snap.get("fingerprint") != fp:
        return None
    snap["latest"] = pd.read_csv(io.StringIO(snap["latest"]), parse_dates=["week"])
    return snap


def write_snapshot(snap: dict, path: Path) -> None:
    out = dict(snap, latest=snap["latest"].to_csv(index=False))
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(out, f, separators=(",", ":"))


def build_snapshot(prices: pd.DataFrame, fp: str) -> dict:
    """Run the trained models over the latest data. Needs scikit-learn (see requirements-full.txt)."""
    try:
        import joblib
        import sklearn  # noqa: F401
    except ImportError as e:
        raise RuntimeError("The saved forecasts don't match the current data or models, and rebuilding them "
                           "needs scikit-learn: pip install -r requirements-full.txt") from e
    from farmstat.features import build_dataset
    from farmstat.forecast import Forecaster
    from farmstat.monthly import MonthlyForecaster

    model = Forecaster.load()
    ds = build_dataset(prices, states=model.states)
    latest = ds.sort_values("week").groupby(KEY).tail(1)
    # active = reported within ACTIVE_WEEKS of the history panel's end (or since, from the live feed), so mandis the
    # live back-fill hasn't reached yet stay listed with their last known price
    panel = prices[prices["source"] == "panel"] if "source" in prices else prices
    panel_end = latest["crop"].map(panel.groupby("crop")["week"].max())
    keep_rows = latest["week"] >= panel_end - pd.Timedelta(weeks=ACTIVE_WEEKS)
    latest = latest.assign(live=latest["week"] > panel_end)[keep_rows]
    latest = latest.join(model.predict(latest)).reset_index(drop=True)
    adv = [model.advise(r["crop"], r["price"], r) for _, r in latest.iterrows()]
    latest["advice"] = [a.action for a in adv]
    latest["hold_weeks"] = [a.hold_weeks for a in adv]
    latest["advice_headline"] = [a.headline for a in adv]
    latest["advice_detail"] = [a.detail for a in adv]
    latest = _warm_up(latest, ds, model.horizons)
    keep = ["week", "crop", "state", "district", "market", "price", "arrivals", "new_mandi", "naive",
            "prob_rise", "advice", "hold_weeks", "advice_headline", "advice_detail", "live", "warming"]
    keep += [f"p{q}_{h}" for h in model.horizons for q in (10, 50, 90)]
    snap = dict(fingerprint=fp, version=model.version, horizons=list(model.horizons),
                metrics=json.loads(json.dumps(model.metrics, default=_clean)),
                cashew=_cashew(MonthlyForecaster(joblib.load(CASHEW_MODEL))), latest=latest[keep])
    return snap


def _warm_up(latest: pd.DataFrame, ds: pd.DataFrame, horizons) -> pd.DataFrame:
    """Live series whose reports only just resumed (after a gap, or a new mandi) have too few recent weeks for the
    model's lag features, which then read as a crash. Until they have WARMUP_WEEKS reported weeks out of the last 13,
    show today's live price with the range prices usually moved for that crop (last 3 years) and no call."""
    latest = latest.copy()
    warm = latest["live"] & (latest["obs_last_13"] < WARMUP_WEEKS)
    latest["warming"] = warm
    if not warm.any():
        return latest
    recent = ds[ds["week"] >= ds["week"].max() - pd.Timedelta(weeks=156)]
    for crop, g in latest[warm].groupby("crop"):
        r = recent[recent["crop"] == crop]
        price = latest.loc[g.index, "price"]
        for h in horizons:
            lo, hi = np.quantile(r[f"y_{h}"].dropna(), [0.1, 0.9])
            latest.loc[g.index, f"p50_{h}"] = price
            latest.loc[g.index, f"p10_{h}"] = price * np.exp(lo)
            latest.loc[g.index, f"p90_{h}"] = price * np.exp(hi)
        latest.loc[g.index, "prob_rise"] = float((r["y_2"].dropna() > np.log(1.05)).mean())
    latest.loc[warm, "naive"] = True
    latest.loc[warm, "advice"] = "Your call"
    latest.loc[warm, "hold_weeks"] = 0
    latest.loc[warm, "advice_headline"] = "Live price, forecast warming up"
    latest.loc[warm, "advice_detail"] = (f"This mandi's live reports have just resumed. Forecasts start once it has "
                                          f"{WARMUP_WEEKS} recent weeks; until then the range shows how prices usually move.")
    return latest


def _cashew(fc) -> dict:
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
    season = [dict(month=pd.Timestamp(2000, int(m), 1).strftime("%b"), pct=_clean(v))
              for m, v in sorted(fc.bundle["season"].items())]
    return json.loads(json.dumps(dict(states=states, season=season, metrics=fc.metrics), default=_clean))


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
    if isinstance(v, np.ndarray):
        return [_clean(x) for x in v.tolist()]
    return v


def records(df: pd.DataFrame) -> list[dict]:
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict("records")]


class FarmData:
    def __init__(self):
        self.prices = load_prices()
        fp = fingerprint()
        snap = next((s for p in [SNAPSHOT, *_cache_files()] if (s := read_snapshot(p, fp)) is not None), None)
        if snap is None:
            snap = build_snapshot(self.prices, fp)
            for p in _cache_files():
                try:
                    write_snapshot(snap, p)
                    break
                except OSError:          # read-only folder: try the next one
                    continue
        self.latest = snap["latest"]
        self.horizons, self.version, self.metrics = snap["horizons"], snap["version"], snap["metrics"]
        self._cashew = snap["cashew"]
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
                    n_states=int(lt["state"].nunique()), horizons=self.horizons,
                    max_hold_weeks=MAX_HOLD_WEEKS, version=self.version)

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
        for h in self.horizons:
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
    def cashew(self) -> dict:
        return self._cashew

    # ── sugarcane ───────────────────────────────────────────────────────────
    @lru_cache(maxsize=1)
    def sugarcane(self) -> dict:
        s = pd.read_csv(MONTHLY_FILE)
        s = s[(s["crop"] == "Sugarcane") & (s["state"] == "Chhattisgarh") & s["price"].notna()].sort_values("month")
        return dict(frp=[dict(season=a, start=b, price=c) for a, b, c in FRP],
                    current=dict(season="2026-27", price=365, recovery=10.25, step=3.56, floor=338.3, floor_below=9.5),
                    chhattisgarh=records(s[["month", "price"]]))

    def accuracy(self) -> dict:
        return self.metrics
