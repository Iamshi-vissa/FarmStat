"""
Use the trained FarmStat models to forecast mandi prices and give selling advice.

Models (trained in notebooks/FarmStat_Training.ipynb):
  * for each horizon (7, 14, 30 days): three gradient-boosting models that predict the
    10th, 50th and 90th percentile of the price change -> a likely range, not just one number
  * a classifier that gives the probability the price rises by 5% or more in 14 days
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .data import ROOT

DEFAULT_MODEL_PATH = ROOT / "models" / "farmstat_model.joblib"

# Tomatoes spoil within days, so we never advise holding them longer than a week.
MAX_HOLD_DAYS = {"Tomato": 7, "Onion": 30, "Potato": 30}
# Rough cost of holding stock (weight loss, storage, spoilage) per 30 days, as a share of value.
HOLDING_COST_30D = {"Tomato": 0.15, "Onion": 0.04, "Potato": 0.03}
RISE_THRESHOLD = 0.05


@dataclass
class Advice:
    action: str          # "Sell now", "Hold", or "Your call"
    hold_days: int       # 0 when the advice is to sell now
    headline: str
    detail: str


class Forecaster:
    def __init__(self, bundle: dict):
        self.bundle = bundle
        self.features = bundle["features"]
        self.markets = bundle["markets"]
        self.horizons = sorted(bundle["quantile_models"])
        self.metrics = bundle.get("metrics", {})
        self.version = bundle.get("version", "unknown")

    @classmethod
    def load(cls, path: str | Path = DEFAULT_MODEL_PATH) -> "Forecaster":
        return cls(joblib.load(path))

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        """Forecasts for each row of the feature table (one row = one crop, mandi and day)."""
        X = rows[self.features]
        out = pd.DataFrame(index=rows.index)
        price = rows["price"].to_numpy()
        for h in self.horizons:
            for q, model in self.bundle["quantile_models"][h].items():
                out[f"p{q}_{h}"] = price * np.exp(model.predict(X))
            # keep the range in order (independent quantile models can cross)
            lo, mid, hi = (out[f"p{q}_{h}"] for q in (10, 50, 90))
            out[f"p10_{h}"], out[f"p90_{h}"] = np.minimum(lo, mid), np.maximum(hi, mid)
        out["prob_rise_14"] = self.bundle["rise_classifier"].predict_proba(X)[:, 1]
        return out

    def advise(self, crop: str, price: float, forecast: pd.Series) -> Advice:
        """Turn a forecast into simple advice for a farmer holding this crop today."""
        best_h, best_gain = 0, 0.0
        for h in self.horizons:
            if h > MAX_HOLD_DAYS.get(crop, 30):
                continue
            cost = HOLDING_COST_30D.get(crop, 0.05) * h / 30
            gain = forecast[f"p50_{h}"] / price - 1 - cost
            if gain > best_gain:
                best_h, best_gain = h, gain
        p_rise = float(forecast["prob_rise_14"])

        if best_h and best_gain >= 0.05 and (best_h < 14 or p_rise >= 0.5):
            low = forecast[f"p10_{best_h}"]
            return Advice(
                "Hold", best_h,
                f"Holding for about {best_h} days looks worth it",
                f"Expected price ₹{forecast[f'p50_{best_h}']:,.0f}/qtl (+{best_gain:.0%} after storage losses). "
                f"Low end of the likely range ₹{low:,.0f}/qtl.",
            )
        drop = forecast[f"p50_{self.horizons[0]}"] / price - 1
        if drop <= -0.03 or best_h == 0:
            return Advice("Sell now", 0, "Selling now looks best",
                          "The model does not expect a rise big enough to cover storage losses.")
        return Advice("Your call", 0, "No clear signal",
                      "A small rise is possible but uncertain; sell if you need cash or storage is tight.")
