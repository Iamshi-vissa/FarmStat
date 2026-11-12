"""
State-level monthly prices for crops that have no long mandi-level history in the data:
cashew (forecast) and sugarcane (shown for information only).

Source: Agmarknet state-wise monthly weighted-average price (Rs per quintal) and arrivals (tonnes).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .data import ROOT

MONTHLY_FILE = ROOT / "data" / "state_monthly.csv.gz"
M_HORIZONS = [1, 2, 3]   # months ahead
MIN_MONTHS = 36
KERNEL_LEVEL = 30000     # Rs/qtl: states whose typical price is above this report cashew kernels, not raw nuts

M_FEATURES = ["log_price", "ret_1", "ret_3", "ret_6", "ret_12", "dev_ma3", "dev_ma12", "vol_6",
              "log_arrivals", "arr_chg_1", "arr_yoy", "nat_ret_1", "nat_ret_3", "month_sin", "month_cos",
              "months_since_obs"]


def load_monthly(crop: str, path: Path = MONTHLY_FILE, min_months: int = MIN_MONTHS) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df[(df["crop"] == crop) & df["price"].notna() & (df["price"] > 0)].copy()
    df["month"] = pd.to_datetime(df["month"])
    df = df.sort_values(["state", "month"])
    # Some months a state reports a different product (e.g. kernels instead of raw nuts) at 3-8x the price:
    # drop prices more than 2.5x away from the median of the 5 surrounding reported months.
    med = df.groupby("state")["price"].transform(lambda s: s.rolling(5, center=True, min_periods=3).median())
    r = df["price"] / med
    df = df[(r < 2.5) & (r > 1 / 2.5)]
    n = df.groupby("state")["month"].transform("size")
    return df[n >= min_months].reset_index(drop=True)


def product_label(crop: str, typical_price: float) -> str:
    if crop == "Cashew":
        return "kernels (processed)" if typical_price > KERNEL_LEVEL else "raw nuts"
    return crop.lower()


def build_monthly(df: pd.DataFrame) -> pd.DataFrame:
    """One row per state and reported month, past-only features, targets 1-3 months ahead."""
    series = {}
    for state, g in df.groupby("state"):
        g = g.set_index("month").sort_index()
        idx = pd.date_range(g.index.min(), g.index.max(), freq="MS")
        d = pd.DataFrame(index=idx)
        d["observed"] = g["price"].reindex(idx).notna()
        d["price"] = g["price"].reindex(idx).ffill(limit=2)
        d["arrivals"] = g["arrivals_t"].reindex(idx)
        last = pd.Series(np.where(d["observed"], np.arange(len(d)), np.nan), index=idx).ffill()
        d["months_since_obs"] = np.arange(len(d)) - last.values
        series[state] = d
    lp_all = pd.DataFrame({s: np.log(d["price"]) for s, d in series.items()})
    nat = lp_all.diff().median(axis=1)   # typical monthly change across states

    rows = []
    for state, d in series.items():
        lp = np.log(d["price"])
        f = pd.DataFrame(index=d.index)
        f["log_price"] = lp
        for k in [1, 3, 6, 12]:
            f[f"ret_{k}"] = lp - lp.shift(k)
        f["dev_ma3"] = lp - np.log(d["price"].rolling(3, min_periods=2).mean())
        f["dev_ma12"] = lp - np.log(d["price"].rolling(12, min_periods=6).mean())
        f["vol_6"] = lp.diff().rolling(6, min_periods=3).std()
        la = np.log1p(d["arrivals"])
        f["log_arrivals"], f["arr_chg_1"], f["arr_yoy"] = la, la - la.shift(1), la - la.shift(12)
        n = nat.reindex(d.index)
        f["nat_ret_1"], f["nat_ret_3"] = n, n.rolling(3, min_periods=2).sum()
        f["month_sin"], f["month_cos"] = np.sin(2 * np.pi * d.index.month / 12), np.cos(2 * np.pi * d.index.month / 12)
        f["months_since_obs"] = d["months_since_obs"]
        for h in M_HORIZONS:
            f[f"y_{h}"] = lp.where(d["observed"]).shift(-h) - lp
        f["state"], f["price"] = state, d["price"]
        rows.append(f[d["observed"].values])
    out = pd.concat(rows).rename_axis("month").reset_index()
    out[M_FEATURES] = out[M_FEATURES].astype(float)
    return out.sort_values(["month", "state"]).reset_index(drop=True)


class MonthlyForecaster:
    """Median forecast from a regression model + a range from past forecast errors (split-conformal)."""

    def __init__(self, bundle: dict):
        self.bundle = bundle
        self.models = bundle["models"]           # {h: fitted model or None (= no change)}
        self.err_q = bundle["error_quantiles"]   # {h: (q10, q90)} of log errors on the validation years
        self.metrics = bundle.get("metrics", {})

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        out = pd.DataFrame(index=rows.index)
        price = rows["price"].to_numpy()
        for h in M_HORIZONS:
            m = self.models[h]
            mid = m.predict(rows[M_FEATURES]) if m is not None else np.zeros(len(rows))
            lo, hi = self.err_q[h]
            out[f"p50_{h}"] = price * np.exp(mid)
            out[f"p10_{h}"], out[f"p90_{h}"] = price * np.exp(mid + lo), price * np.exp(mid + hi)
        return out
