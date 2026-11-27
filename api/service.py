"""
Prepares everything the web app shows: the latest forecast for every mandi, price history and the test results.

Everything that needs the trained models (the forecasts, advice and test results) is
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
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import CROPS, DATA_FILE, KEY, LIVE_FILE, load_prices  # noqa: E402
from farmstat.calibration import CALIBRATION_FILE  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, MAX_HOLD_WEEKS  # noqa: E402

SNAPSHOT = ROOT / "models" / "web_snapshot.json.gz"
SNAPSHOT_VERSION = "6"   # bump when the snapshot's contents change shape (6: active = recent vs crop's latest week)
ACTIVE_WEEKS = 8
WARMUP_WEEKS = 4        # a live series needs this many reported weeks in the last 13 before the model forecasts it


def fingerprint() -> str:
    """Content hash of the data and models the snapshot was built from."""
    h = hashlib.md5(SNAPSHOT_VERSION.encode())
    for p in [DATA_FILE, LIVE_FILE, DEFAULT_MODEL_PATH, CALIBRATION_FILE]:
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
        import sklearn  # noqa: F401
    except ImportError as e:
        raise RuntimeError("The saved forecasts don't match the current data or models, and rebuilding them "
                           "needs scikit-learn: pip install -r requirements-full.txt") from e
    from farmstat.features import build_dataset
    from farmstat.forecast import Forecaster

    model = Forecaster.load()
    ds = build_dataset(prices, states=model.states)
    latest = ds.sort_values("week").groupby(KEY).tail(1)
    # active = reported within ACTIVE_WEEKS of the crop's latest week, so mandis that stopped reporting (e.g. last seen
    # in July) drop out instead of showing an old price next to this week's
    panel = prices[prices["source"] == "panel"] if "source" in prices else prices
    panel_end = latest["crop"].map(panel.groupby("crop")["week"].max())
    crop_end = latest["crop"].map(latest.groupby("crop")["week"].max())
    keep_rows = latest["week"] >= crop_end - pd.Timedelta(weeks=ACTIVE_WEEKS)
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
                metrics=json.loads(json.dumps(model.metrics, default=_clean)), latest=latest[keep])
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
        # last 12 weekly prices per series, for the sparklines in the mandi list
        recent = self.prices[self.prices["week"] >= self.prices["week"].max() - pd.Timedelta(weeks=40)]
        last12 = recent.sort_values(KEY + ["week"]).groupby(KEY, sort=False).tail(12)   # sort once, not per series
        self.spark = {k: g.round(0).tolist() for k, g in last12.groupby(KEY, sort=False)["price"]}
        # row positions of each series, so a mandi's history is a lookup instead of a scan of every row
        self._rows = self.prices.groupby(KEY, sort=False).indices
        self._overview: dict[str, dict | None] = {}
        self._meta: dict | None = None
        self._accuracy: dict | None = None

    # ── weekly crops ────────────────────────────────────────────────────────
    def meta(self) -> dict:
        """Crops, their states and this week's India picture (computed once: every request checks its crop here)."""
        if self._meta is None:
            self._meta = self._build_meta()
        return self._meta

    def _build_meta(self) -> dict:
        lt = self.latest
        base = lt["market"].str.replace(r" \(.*\)$", "", regex=True)
        crops = []
        for c in CROPS:
            sub = lt[lt["crop"] == c]
            if len(sub):
                ov = self.overview(c) or {}   # this week's India median, trend and calls, for the crop choice on the home page
                crops.append(dict(id=c, kind="weekly", series=len(sub),
                                  states=[dict(name=s, count=int(n)) for s, n in sub.groupby("state").size().items()],
                                  data_until=_clean(sub["week"].max()), naive=bool(sub["naive"].all()),
                                  median=ov.get("median"), median_prev=ov.get("median_prev"), week=ov.get("week"),
                                  trend=[t["price"] for t in ov.get("trend", [])], calls=ov.get("calls", {})))
        return dict(crops=crops, n_mandis=int(pd.DataFrame({"s": lt["state"], "b": base}).drop_duplicates().shape[0]),
                    n_states=int(lt["state"].nunique()), horizons=self.horizons,
                    max_hold_weeks=MAX_HOLD_WEEKS, version=self.version,
                    model_data_until=self.metrics.get("data_until"), retrained_at=self.metrics.get("retrained_at"))

    def has_series(self, crop: str, state: str, market: str) -> bool:
        lt = self.latest
        return bool(((lt["crop"] == crop) & (lt["state"] == state) & (lt["market"] == market)).any())

    def index(self) -> dict:
        """Every active series in one compact list, for the search-anywhere palette: [crop, state, market, district, price]."""
        lt = self.latest.sort_values(["crop", "state", "market"])
        cols = ["crop", "state", "market", "district", "price"]
        rows = [[_clean(v) for v in r] for r in lt[cols].itertuples(index=False)]
        return dict(columns=cols, rows=rows)

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
        hist = self.prices.iloc[self._rows.get((crop, state, market), [])]
        hist = hist[hist["week"] >= r["week"] - pd.Timedelta(weeks=weeks)].sort_values("week")
        fc = [dict(week=_clean(r["week"]), p10=_clean(r["price"]), p50=_clean(r["price"]), p90=_clean(r["price"]), h=0)]
        fc += [dict(week=_clean(r["week"] + pd.Timedelta(weeks=h)), h=h,
                    p10=_clean(r[f"p10_{h}"]), p50=_clean(r[f"p50_{h}"]), p90=_clean(r[f"p90_{h}"])) for h in self.horizons]
        return dict(latest={k: _clean(v) for k, v in r.items()},
                    history=records(hist[["week", "price", "arrivals_t"]]), forecast=fc)

    def overview(self, crop: str) -> dict | None:
        """India-wide picture for one weekly crop, shown before a mandi is chosen (computed once per crop)."""
        if crop not in self._overview:
            self._overview[crop] = self._build_overview(crop)
        return self._overview[crop]

    def _build_overview(self, crop: str) -> dict | None:
        lt = self.latest[self.latest["crop"] == crop].copy()
        if lt.empty:
            return None
        h = 1 if crop == "Tomato" else 2
        lt["move"] = lt[f"p50_{h}"] / lt["price"] - 1
        modelled = lt[~lt["naive"].astype(bool)]
        week = lt["week"].max()
        fresh = lt[lt["week"] >= week - pd.Timedelta(weeks=2)]           # reported in the last 3 weeks
        # The weekly India median, worked out the same way as this week's headline figure: for each week, every followed
        # mandi's latest price among those that reported in the three weeks to then. So the trend ends on the headline
        # figure and "vs last week" compares like with like.
        hist = self.prices[(self.prices["crop"] == crop) & (self.prices["week"] > week - pd.Timedelta(weeks=28))
                           & (self.prices["week"] <= week)].merge(lt[KEY], on=KEY).sort_values("week")
        weeks = sorted(w for w in hist["week"].unique() if w > week - pd.Timedelta(weeks=26))
        trend = pd.Series({w: hist[hist["week"].between(w - pd.Timedelta(weeks=2), w)].groupby(KEY)["price"].last().median()
                           for w in weeks}, dtype=float).round(0)
        if len(trend) and trend.index[-1] == week:
            trend.iloc[-1] = round(float(fresh["price"].median()))   # this week includes the live feed's reports
        prev = trend.iloc[-2] if len(trend) > 1 else None
        year = self.prices[(self.prices["crop"] == crop)
                           & (self.prices["week"].between(week - pd.Timedelta(weeks=53), week - pd.Timedelta(weeks=51)))]
        states = []
        for st, g in fresh.groupby("state"):
            m = g[~g["naive"].astype(bool)]
            top = g.sort_values("price", ascending=False).iloc[0]
            states.append(dict(state=st, median=_clean(g["price"].median()), mandis=len(g),
                               move=_clean(m["move"].median()) if len(m) else None,
                               top_market=top["market"], top_price=_clean(top["price"])))
        states.sort(key=lambda d: -(d["median"] or 0))
        cols = ["state", "district", "market", "price", "move", "prob_rise", "advice", "new_mandi"]
        movers = modelled[(modelled["week"] >= week - pd.Timedelta(weeks=2)) & ~modelled["warming"].astype(bool)]
        return dict(
            crop=crop, week=_clean(week), horizon=h, series=len(lt), states_count=int(lt["state"].nunique()),
            median=_clean(fresh["price"].median()), median_prev=_clean(prev),
            median_year_ago=_clean(year["price"].median()) if len(year) else None,
            move=_clean(modelled["move"].median()) if len(modelled) else None,
            rise_share=_clean((modelled["prob_rise"] >= 0.5).mean()) if len(modelled) else None,
            calls={k: int(v) for k, v in lt["advice"].value_counts().items()},
            naive=bool(lt["naive"].all()),
            trend=[dict(week=_clean(w), price=_clean(p)) for w, p in trend.items()],
            states=states,
            rises=records(movers.sort_values("move", ascending=False).head(5)[cols]),
            falls=records(movers.sort_values("move").head(5)[cols]),
            top=records(fresh.sort_values("price", ascending=False).head(5)[cols]),
        )

    # ── test results ─────────────────────────────────────────────────────────
    def accuracy(self) -> dict:
        """What the Model accuracy page shows: the independent walk-forward test (reports/evaluation.json, written by
        scripts/evaluate.py) plus the farmer back-test and arecanut ranges from training."""
        if self._accuracy is None:
            m = self.metrics
            out = dict(version=self.version, data_until=m.get("data_until"), recent=m.get("recent_check"),
                       backtest=m.get("backtest_extra_Rs_per_quintal", {}),
                       arecanut_coverage=m.get("arecanut", {}).get("range_coverage", {}))
            ev_file = ROOT / "reports" / "evaluation.json"
            if ev_file.exists():
                ev = json.loads(ev_file.read_text())
                hz = {h: dict(MAE_Rs=r["MAE_Rs"], naive_MAE_Rs=r["naive_MAE_Rs"], skill_vs_naive=r["skill_vs_naive"],
                              skill_95ci=r.get("skill_95ci"), p_value=r.get("diebold_mariano", {}).get("p_value"),
                              direction_acc=r["direction_acc"], coverage_10_90=r["coverage_10_90"],
                              coverage_conformal=r.get("coverage_10_90_conformal"), rows=r.get("rows"),
                              rmse_Rs=r.get("RMSE_Rs"), mape=r.get("MAPE"))
                      for h, r in ev["horizons"].items()}
                out.update(test_years=ev["test_years"], horizons=hz, segments=ev["by_crop_and_type"],
                           by_year=ev["by_year"], by_state=ev.get("by_state", []), rise_warning=ev["rise_warning"])
            else:   # training metrics only (the independent test has not been run)
                start, end = m["test_period"].split(" to ")
                hz = {h: dict(MAE_Rs=r["MAE_Rs"], naive_MAE_Rs=r["MAE_Rs"] / (1 - r["skill_vs_naive"]),
                              skill_vs_naive=r["skill_vs_naive"], direction_acc=r["direction_acc"],
                              coverage_10_90=r["coverage_10_90"]) for h, r in m["horizons"].items()}
                out.update(test_years=list(range(int(start[:4]), int(end[:4]) + 1)), horizons=hz, segments=[], by_year=[],
                           by_state=[], rise_warning=None)
            self._accuracy = json.loads(json.dumps(out, default=_clean))
        return self._accuracy
