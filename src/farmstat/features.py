"""
Turn the weekly price history into model features.

Every feature for week t uses ONLY information available by the end of week t.
The targets look H weeks ahead. This is what stops the model from "seeing the future"
during training (data leakage).

Target for horizon H:  y_H = log(price in week t+H) - log(price in week t)
i.e. the % change in price over the next H weeks (in log form). Predicting the change,
not the price itself, lets one model work for cheap and expensive mandis alike.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .data import CROPS, KEY

HORIZONS = [1, 2, 4]   # weeks ahead
FFILL_LIMIT = 2        # carry a price forward over at most 2 weeks without a report

PRICE_FEATURES = [
    "log_price", "ret_1", "ret_2", "ret_4", "ret_8", "ret_13", "ret_26", "ret_52",
    "dev_ma4", "dev_ma13", "dev_ma52", "vol_8", "vol_26", "range_13",
    "weeks_since_obs", "obs_last_13", "trading_days", "history_weeks",
]
ARRIVAL_FEATURES = ["log_arrivals", "arr_chg_1", "arr_chg_4", "arr_dev_ma13", "arr_yoy",
                    "nat_arr_chg_4", "nat_arr_yoy"]
MARKET_FEATURES = ["nat_ret_1", "nat_ret_4", "nat_ret_13", "rel_to_nat", "state_ret_4", "rel_to_state",
                   "premium_52", "n_markets"]
SEASON_FEATURES = ["week_sin", "week_cos", "month"]
CAT_FEATURES = ["crop_code", "state_code"]
FEATURES = PRICE_FEATURES + ARRIVAL_FEATURES + MARKET_FEATURES + SEASON_FEATURES + CAT_FEATURES


def _weekly_series(g: pd.DataFrame) -> pd.DataFrame:
    """Re-index one crop-mandi series to every week and carry prices forward a little."""
    g = g.set_index("week").sort_index()
    idx = pd.date_range(g.index.min(), g.index.max(), freq="W-MON")
    d = pd.DataFrame(index=idx)
    d["observed"] = g["price"].reindex(idx).notna()
    d["price"] = g["price"].reindex(idx).ffill(limit=FFILL_LIMIT)
    d["arrivals"] = g["arrivals_t"].reindex(idx)
    d["trading_days"] = g["trading_days"].reindex(idx)
    last_obs = pd.Series(np.where(d["observed"], np.arange(len(d)), np.nan), index=idx).ffill()
    d["weeks_since_obs"] = np.arange(len(d)) - last_obs.values
    d["district"] = g["district"].iloc[-1]
    return d


def _median_frame(series: dict, col: str, transform=np.log) -> pd.DataFrame:
    return pd.DataFrame({k: transform(s[col]) for k, s in series.items()})


def build_dataset(prices: pd.DataFrame, states: list[str] | None = None) -> pd.DataFrame:
    """Feature table: one row per crop, mandi and reported week, plus targets for each horizon."""
    states = states or sorted(prices["state"].unique())
    state_code = {s: i for i, s in enumerate(states)}
    first_week = prices.groupby(KEY)["week"].min()

    series = {k: _weekly_series(g) for k, g in prices.groupby(KEY)}

    # National and state-level signals per crop: median log price, total arrivals
    nat, st = {}, {}
    for crop in CROPS:
        keys = [k for k in series if k[0] == crop]
        if not keys:
            continue
        lp = pd.DataFrame({k: np.log(series[k]["price"]) for k in keys})
        arr = pd.DataFrame({k: series[k]["arrivals"] for k in keys})
        nat[crop] = pd.DataFrame({"med": lp.median(axis=1), "n": lp.notna().sum(axis=1),
                                  "arr": np.log1p(arr.sum(axis=1, min_count=1))})
        for s in {k[1] for k in keys}:
            cols = [k for k in keys if k[1] == s]
            st[(crop, s)] = lp[cols].median(axis=1)

    rows = []
    for (crop, state, market), d in series.items():
        lp = np.log(d["price"])
        f = pd.DataFrame(index=d.index)
        f["log_price"] = lp
        for k in [1, 2, 4, 8, 13, 26, 52]:
            f[f"ret_{k}"] = lp - lp.shift(k)
        for k in [4, 13, 52]:
            f[f"dev_ma{k}"] = lp - np.log(d["price"].rolling(k, min_periods=max(2, k // 3)).mean())
        dl = lp.diff()
        f["vol_8"] = dl.rolling(8, min_periods=4).std()
        f["vol_26"] = dl.rolling(26, min_periods=10).std()
        f["range_13"] = np.log(d["price"].rolling(13, min_periods=4).max() / d["price"].rolling(13, min_periods=4).min())
        f["weeks_since_obs"] = d["weeks_since_obs"]
        f["obs_last_13"] = d["observed"].rolling(13, min_periods=1).sum()
        f["trading_days"] = d["trading_days"]
        # how long this mandi has been reporting
        f["history_weeks"] = ((d.index - first_week[(crop, state, market)]).days / 7).astype(float)

        la = np.log1p(d["arrivals"])
        f["log_arrivals"] = la
        f["arr_chg_1"] = la - la.shift(1)
        f["arr_chg_4"] = la - la.shift(4)
        f["arr_dev_ma13"] = la - la.rolling(13, min_periods=4).mean()
        f["arr_yoy"] = la - la.shift(52)

        n = nat[crop].reindex(d.index)
        f["nat_ret_1"] = n["med"] - n["med"].shift(1)
        f["nat_ret_4"] = n["med"] - n["med"].shift(4)
        f["nat_ret_13"] = n["med"] - n["med"].shift(13)
        f["rel_to_nat"] = lp - n["med"]
        f["nat_arr_chg_4"] = n["arr"] - n["arr"].shift(4)
        f["nat_arr_yoy"] = n["arr"] - n["arr"].shift(52)
        f["n_markets"] = n["n"]
        sm = st[(crop, state)].reindex(d.index)
        f["state_ret_4"] = sm - sm.shift(4)
        f["rel_to_state"] = lp - sm
        # this mandi's usual premium/discount vs the national median over the past year
        f["premium_52"] = (lp - n["med"]).rolling(52, min_periods=13).mean()

        wk = d.index.isocalendar().week.astype(float).values
        f["week_sin"], f["week_cos"] = np.sin(2 * np.pi * wk / 52.18), np.cos(2 * np.pi * wk / 52.18)
        f["month"] = d.index.month
        f["crop_code"] = CROPS.index(crop)
        f["state_code"] = state_code.get(state, -1)

        fresh = d["observed"]
        for h in HORIZONS:
            f[f"y_{h}"] = lp.where(fresh).shift(-h) - lp

        f["crop"], f["state"], f["market"], f["district"] = crop, state, market, d["district"]
        f["price"], f["arrivals"] = d["price"], d["arrivals"]
        rows.append(f[d["observed"].values])

    out = pd.concat(rows).rename_axis("week").reset_index()
    out[FEATURES] = out[FEATURES].astype("float32")
    return out.sort_values(["week", "crop", "state", "market"]).reset_index(drop=True)
