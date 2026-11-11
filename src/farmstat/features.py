"""
Turn the price history into model features.

Every feature for day t uses ONLY information available at the end of day t
(prices up to t, weather up to t). The targets look H days ahead. This is what stops
the model from "seeing the future" during training (data leakage).

Target for horizon H:  y_H = log(price on day t+H) - log(price on day t)
i.e. the % change in price over the next H days (in log form). Predicting the change,
not the price itself, lets one model work for cheap and expensive crops alike.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .data import CROPS, weather_location

HORIZONS = [7, 14, 30]
FFILL_LIMIT = 10      # carry a price forward over at most 10 days with no trading (holidays, strikes)
TARGET_MAX_AGE = 3    # the price on day t+H must have been reported within 3 days of t+H

PRICE_FEATURES = [
    "log_price", "ret_1", "ret_3", "ret_7", "ret_14", "ret_30", "ret_60", "ret_90", "ret_365",
    "dev_ma7", "dev_ma30", "dev_ma90", "dev_ma365", "vol_14", "vol_30", "range_30",
    "spread", "days_since_obs", "obs_last_30",
    "crop_ret_7", "crop_ret_30", "rel_to_crop", "n_markets_today",
]
SEASON_FEATURES = ["doy_sin", "doy_cos", "month"]
WEATHER_FEATURES = ["rain_7", "rain_30", "rain_90", "rain_90_anom", "tmax_7", "tmean_30", "humidity_30"]
CAT_FEATURES = ["crop_code", "market_code"]
FEATURES = PRICE_FEATURES + SEASON_FEATURES + WEATHER_FEATURES + CAT_FEATURES


def _daily_series(g: pd.DataFrame) -> pd.DataFrame:
    """Re-index one crop-mandi series to every calendar day and carry prices forward."""
    g = g.set_index("date").sort_index()
    idx = pd.date_range(g.index.min(), g.index.max(), freq="D")
    d = pd.DataFrame(index=idx)
    d["observed"] = g["modal"].reindex(idx).notna()
    d["price"] = g["modal"].reindex(idx).ffill(limit=FFILL_LIMIT)
    d["spread"] = ((g["max_price"] - g["min_price"]) / g["modal"]).reindex(idx).ffill(limit=FFILL_LIMIT)
    last_obs = pd.Series(np.where(d["observed"], np.arange(len(d)), np.nan), index=idx).ffill()
    d["days_since_obs"] = np.arange(len(d)) - last_obs.values
    return d


def _weather_features(weather: pd.DataFrame) -> pd.DataFrame:
    w = pd.DataFrame(index=weather.index)
    w["rain_7"] = weather["rain"].rolling(7, min_periods=5).sum()
    w["rain_30"] = weather["rain"].rolling(30, min_periods=20).sum()
    w["rain_90"] = weather["rain"].rolling(90, min_periods=60).sum()
    # Anomaly: this season's rain compared with the usual amount for this time of year (2001-2020 average)
    clim = w.loc["2001":"2020", "rain_90"].groupby(w.loc["2001":"2020"].index.dayofyear).mean()
    w["rain_90_anom"] = w["rain_90"] - clim.reindex(w.index.dayofyear).values
    w["tmax_7"] = weather["tmax"].rolling(7, min_periods=5).mean()
    w["tmean_30"] = weather["tmean"].rolling(30, min_periods=20).mean()
    w["humidity_30"] = weather["humidity"].rolling(30, min_periods=20).mean()
    return w


def build_dataset(prices: pd.DataFrame, weather: dict[str, pd.DataFrame],
                  markets: list[str] | None = None) -> pd.DataFrame:
    """Feature table: one row per crop, mandi and trading day, plus targets for each horizon."""
    markets = markets or sorted(prices["market"].unique())
    market_code = {m: i for i, m in enumerate(markets)}
    wfeat = {loc: _weather_features(w) for loc, w in weather.items()}

    # Daily series for every crop-mandi pair
    series = {}
    for (crop, market), g in prices.groupby(["crop", "market"]):
        series[(crop, market)] = _daily_series(g)

    # Crop-wide signal: median log price across all mandis that day
    crop_median = {}
    for crop in CROPS:
        cols = {m: np.log(s["price"]) for (c, m), s in series.items() if c == crop}
        if cols:
            wide = pd.DataFrame(cols)
            crop_median[crop] = pd.DataFrame({"med": wide.median(axis=1), "n": wide.notna().sum(axis=1)})

    rows = []
    for (crop, market), d in series.items():
        lp = np.log(d["price"])
        f = pd.DataFrame(index=d.index)
        f["log_price"] = lp
        for k in [1, 3, 7, 14, 30, 60, 90, 365]:
            f[f"ret_{k}"] = lp - lp.shift(k)
        for k in [7, 30, 90, 365]:
            f[f"dev_ma{k}"] = lp - np.log(d["price"].rolling(k, min_periods=max(3, k // 3)).mean())
        dl = lp.diff()
        f["vol_14"] = dl.rolling(14, min_periods=7).std()
        f["vol_30"] = dl.rolling(30, min_periods=15).std()
        f["range_30"] = np.log(d["price"].rolling(30, min_periods=10).max() / d["price"].rolling(30, min_periods=10).min())
        f["spread"] = d["spread"]
        f["days_since_obs"] = d["days_since_obs"]
        f["obs_last_30"] = d["observed"].rolling(30, min_periods=1).sum()
        cm = crop_median[crop].reindex(d.index)
        f["crop_ret_7"] = cm["med"] - cm["med"].shift(7)
        f["crop_ret_30"] = cm["med"] - cm["med"].shift(30)
        f["rel_to_crop"] = lp - cm["med"]
        f["n_markets_today"] = cm["n"]
        doy = d.index.dayofyear
        f["doy_sin"], f["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
        f["month"] = d.index.month
        f = f.join(wfeat[weather_location(market)][WEATHER_FEATURES], how="left")
        f["crop_code"] = CROPS.index(crop)
        f["market_code"] = market_code.get(market, -1)

        # Targets: change in log price H days ahead (only if that price is fresh)
        fresh = d["days_since_obs"] <= TARGET_MAX_AGE
        for h in HORIZONS:
            future = lp.where(fresh).shift(-h)
            f[f"y_{h}"] = future - lp

        f["crop"], f["market"], f["price"] = crop, market, d["price"]
        f = f[d["observed"].values]   # only days with a real reported price
        rows.append(f)

    out = pd.concat(rows).rename_axis("date").reset_index()
    out[FEATURES] = out[FEATURES].astype("float32")
    return out.sort_values(["date", "crop", "market"]).reset_index(drop=True)
