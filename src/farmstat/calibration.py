"""
Range calibration: make the app's 10th-90th percentile ranges hold the real price about 80% of the time.

The quantile models' ranges are too narrow on new data, and too narrow mostly at the low end (prices fall below the
10th percentile more often than 10% of the time). Split-conformal calibration fixes this without retraining: from
out-of-sample forecasts (the yearly walk-forward test), find how far each end of the range would have to move so that
only 10% of real outcomes fall below the low end and 10% above the high end, and apply those shifts (in log-return
space) to new forecasts. Pooling the CAL_YEARS most recent test years keeps one unusual year from over-widening them.

Tested on 2025 and 2026, each calibrated only on earlier years: coverage 76-85% at every horizon, against 61-82% before.
scripts/calibrate_ranges.py writes the shifts to models/range_calibration.json from scripts/evaluate.py's back-tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CALIBRATION_FILE = ROOT / "models" / "range_calibration.json"
CAL_YEARS = 3          # out-of-sample years pooled to learn the shifts
TAIL = 0.10            # target share of outcomes beyond each end of the range


def conformal_quantile(scores, alpha: float = TAIL) -> float:
    """The finite-sample split-conformal quantile: the ceil((n+1)(1-alpha))-th smallest score."""
    s = np.sort(np.asarray(scores, dtype=float))
    s = s[np.isfinite(s)]
    if len(s) == 0:
        return 0.0
    k = int(np.ceil((len(s) + 1) * (1 - alpha))) - 1
    return float(s[min(max(k, 0), len(s) - 1)])


def tail_shifts(q10, q90, y) -> tuple[float, float]:
    """How far to move the low and high ends (log returns) so ~10% of outcomes fall beyond each."""
    q10, q90, y = (np.asarray(v, dtype=float) for v in (q10, q90, y))
    return conformal_quantile(q10 - y), conformal_quantile(y - q90)


def load_shifts(path: Path = CALIBRATION_FILE) -> dict[int, tuple[float, float]]:
    """{horizon: (low_shift, high_shift)}; empty (no adjustment) if the file isn't there."""
    if not Path(path).exists():
        return {}
    data = json.loads(Path(path).read_text())
    return {int(h): (float(v["low"]), float(v["high"])) for h, v in data["shifts"].items()}
