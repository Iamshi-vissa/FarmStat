"""
Run the trained models over the latest data and save everything the web app shows to
models/web_snapshot.json.gz. The web app reads that file, so it runs without scikit-learn
(which keeps the Vercel deployment small).

Run this after retraining a model or updating the data, then commit the new snapshot:

    python scripts/build_snapshot.py
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from api.service import SNAPSHOT, build_snapshot, fingerprint, load_prices, read_snapshot, write_snapshot  # noqa: E402

t = time.time()
fp = fingerprint()
snap = build_snapshot(load_prices(), fp)
write_snapshot(snap, SNAPSHOT)
back = read_snapshot(SNAPSHOT, fp)
pd.testing.assert_frame_equal(back["latest"], snap["latest"].reset_index(drop=True), check_dtype=False, rtol=1e-9)
print(f"Wrote {SNAPSHOT.relative_to(ROOT)}: {len(snap['latest']):,} mandi series, "
      f"{SNAPSHOT.stat().st_size / 1e3:.0f} kB, {time.time() - t:.0f}s")
