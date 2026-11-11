"""
Use the trained FarmStat models to forecast mandi prices and give selling advice.

Models (trained in notebooks/FarmStat_Training.ipynb):
  * for each horizon (1, 2, 4 weeks): three gradient-boosting models that predict the
    10th, 50th and 90th percentile of the price change -> a likely range, not just one number
  * a classifier that gives the probability the price rises by 5% or more in 2 weeks

Shrinkage: markets are noisy, so the predicted change is multiplied by a factor below 1
(pulled towards "no change"). Mandis with less than 3 years of history get a stronger pull,
because their forecasts were less reliable in testing. Both factors were tuned on 2019-2022.
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
MAX_HOLD_WEEKS = {"Tomato": 1, "Onion": 4, "Potato": 4}
# Rough cost of holding stock (weight loss, storage, spoilage) per 4 weeks, as a share of value.
HOLDING_COST_4W = {"Tomato": 0.15, "Onion": 0.04, "Potato": 0.03}
YOUNG_WEEKS = 156   # under 3 years of history = "new mandi"


@dataclass
class Advice:
    action: str          # "Sell now", "Hold", or "Your call"
    hold_weeks: int      # 0 when the advice is to sell now
    headline: str
    detail: str


class Forecaster:
    def __init__(self, bundle: dict):
        self.bundle = bundle
        self.features = bundle["features"]
        self.states = bundle["states"]
        self.horizons = sorted(bundle["quantile_models"])
        self.shrink = bundle["shrink"]            # {"established": s1, "young": s2}
        self.metrics = bundle.get("metrics", {})
        self.version = bundle.get("version", "unknown")

    @classmethod
    def load(cls, path: str | Path = DEFAULT_MODEL_PATH) -> "Forecaster":
        return cls(joblib.load(path))

    def shrink_factor(self, rows: pd.DataFrame) -> np.ndarray:
        young = rows["history_weeks"].to_numpy() < YOUNG_WEEKS
        return np.where(young, self.shrink["young"], self.shrink["established"])

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        """Forecasts for each row of the feature table (one row = one crop, mandi and week)."""
        X = rows[self.features]
        out = pd.DataFrame(index=rows.index)
        price = rows["price"].to_numpy()
        s = self.shrink_factor(rows)
        for h in self.horizons:
            q = {k: m.predict(X) for k, m in self.bundle["quantile_models"][h].items()}
            mid = s * q[50]
            lo = mid - np.maximum(q[50] - q[10], 0)
            hi = mid + np.maximum(q[90] - q[50], 0)
            out[f"p10_{h}"], out[f"p50_{h}"], out[f"p90_{h}"] = price * np.exp(lo), price * np.exp(mid), price * np.exp(hi)
        out["prob_rise"] = self.bundle["rise_classifier"].predict_proba(X)[:, 1]
        out["new_mandi"] = rows["history_weeks"].to_numpy() < YOUNG_WEEKS
        return out

    def advise(self, crop: str, price: float, forecast: pd.Series) -> Advice:
        """Turn a forecast into simple advice for a farmer holding this crop today."""
        best_h, best_gain = 0, 0.0
        for h in self.horizons:
            if h > MAX_HOLD_WEEKS.get(crop, 4):
                continue
            gain = forecast[f"p50_{h}"] / price - 1 - HOLDING_COST_4W.get(crop, 0.05) * h / 4
            if gain > best_gain:
                best_h, best_gain = h, gain
        p_rise = float(forecast["prob_rise"])

        if best_h and best_gain >= 0.04 and (best_h == 1 or p_rise >= 0.5):
            weeks = f"{best_h} week" + ("s" if best_h > 1 else "")
            return Advice(
                "Hold", best_h, f"Holding for about {weeks} looks worth it",
                f"Expected price ₹{forecast[f'p50_{best_h}']:,.0f}/qtl (+{best_gain:.0%} after storage losses). "
                f"Low end of the likely range ₹{forecast[f'p10_{best_h}']:,.0f}/qtl.",
            )
        drop = forecast[f"p50_{self.horizons[0]}"] / price - 1
        if drop <= -0.03 or best_h == 0:
            return Advice("Sell now", 0, "Selling now looks best",
                          "The model does not expect a rise big enough to cover storage losses.")
        return Advice("Your call", 0, "No clear signal",
                      "A small rise is possible but uncertain; sell if you need cash or storage is tight.")
