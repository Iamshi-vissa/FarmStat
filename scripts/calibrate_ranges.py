"""
Learn the range calibration from the walk-forward back-tests and save it to models/range_calibration.json.

Run after scripts/evaluate.py (which writes reports/backtest_h*.csv.gz):
    python scripts/calibrate_ranges.py
The app applies the shifts the next time the forecasts are rebuilt (scripts/build_snapshot.py).
"""

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.calibration import CAL_YEARS, CALIBRATION_FILE, TAIL, tail_shifts  # noqa: E402


def main() -> None:
    shifts, check = {}, {}
    for f in sorted((ROOT / "reports").glob("backtest_h*.csv.gz")):
        h = int(f.name.split("_h")[1].split(".")[0])
        d = pd.read_csv(f)
        years = sorted(d["year"].unique())[-CAL_YEARS:]
        cal = d[d["year"].isin(years)]
        lo, hi = tail_shifts(cal["q10"], cal["q90"], cal[f"y_{h}"])
        shifts[str(h)] = {"low": round(lo, 5), "high": round(hi, 5)}
        y = cal[f"y_{h}"]
        check[str(h)] = {"coverage_before": round(float(((y >= cal["q10"]) & (y <= cal["q90"])).mean()), 4),
                         "coverage_after": round(float(((y >= cal["q10"] - lo) & (y <= cal["q90"] + hi)).mean()), 4),
                         "rows": int(len(cal))}
        print(f"h={h}: low end moves {-lo:+.3f}, high end {hi:+.3f} (log return), from {len(cal):,} forecasts in "
              f"{[int(y) for y in years]}")
    if not shifts:
        sys.exit("No reports/backtest_h*.csv.gz found: run scripts/evaluate.py first.")
    out = {"method": f"split-conformal, one shift per tail, target {TAIL:.0%} beyond each end",
           "years": [int(y) for y in years], "shifts": shifts, "in_sample_check": check}
    CALIBRATION_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Saved {CALIBRATION_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
