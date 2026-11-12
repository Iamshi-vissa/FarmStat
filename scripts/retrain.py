"""
Weekly job: retrain the weekly price models on all data (history + live weeks) and keep the new model only
if it beats the current one on weeks that neither model has seen (champion / challenger).

  1. Holdout = weeks after the current model's training cut-off with known 2-week outcomes (needs >= 4).
  2. Champion = the current model, scored on the holdout.
  3. Challenger = same settings, trained only on data before the holdout, scored on the same holdout.
  4. If the challenger's error is not higher, refit on everything and save it; otherwise keep the champion.
  5. Log the result to Supabase model_runs and refresh the forecasts.

    python scripts/retrain.py            # normal run
    python scripts/retrain.py --force    # retrain even without enough unseen weeks (skips the comparison)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor  # noqa: E402

from farmstat import live  # noqa: E402
from farmstat.data import KEY, load_prices  # noqa: E402
from farmstat.features import CAT_FEATURES, FEATURES, HORIZONS, build_dataset  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, YOUNG_WEEKS, Forecaster  # noqa: E402

TOP = ["Onion", "Tomato", "Potato"]
RISE = np.log(1.05)
SEED = 42
MIN_HOLDOUT_WEEKS = 4


def hgb(params, **kw):
    base = dict(loss="absolute_error", max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200,
                l2_regularization=1.0, categorical_features=CAT_FEATURES, random_state=SEED)
    base.update(params)
    base.update(kw)
    return HistGradientBoostingRegressor(**base)


def qmodels(params, X, y):
    return {q: hgb(params, loss="quantile", quantile=q / 100).fit(X, y) for q in (10, 50, 90)}


def rise_clf():
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=500,
                                          l2_regularization=1.0, categorical_features=CAT_FEATURES, random_state=SEED)


def mae_rs(rows, pred_log_change):
    """Average error in Rs per quintal, 2 weeks ahead."""
    p = rows["price"].to_numpy()
    return float(np.mean(np.abs(p * np.exp(pred_log_change) - p * np.exp(rows["y_2"].to_numpy()))))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    t0 = time.time()

    champ = Forecaster.load()
    bundle = champ.bundle
    params = bundle["metrics"].get("best_params", {})
    cutoff = pd.Timestamp(bundle["metrics"]["data_until"])

    prices = load_prices()
    ds = build_dataset(prices, states=champ.states)
    ds = ds[ds["crop"].isin(TOP)]
    lab = ds[ds["y_2"].notna()]
    hold = lab[lab["week"] > cutoff]
    n_weeks = hold["week"].nunique()
    print(f"Data to {ds['week'].max():%d %b %Y}; current model trained to {cutoff:%d %b %Y}; "
          f"{n_weeks} unseen weeks with known outcomes ({len(hold):,} rows)")

    run = {"version": bundle["version"], "data_until": f"{ds['week'].max():%Y-%m-%d}"}
    if n_weeks < MIN_HOLDOUT_WEEKS and not a.force:
        run.update(promoted=False, notes=f"skipped: only {n_weeks} unseen weeks (need {MIN_HOLDOUT_WEEKS})")
        print(run["notes"])
        _log(run)
        return 0

    promote = True
    if n_weeks >= MIN_HOLDOUT_WEEKS:
        run["holdout_from"] = f"{hold['week'].min():%Y-%m-%d}"
        s = np.where(hold["history_weeks"].to_numpy() < YOUNG_WEEKS, champ.shrink["young"], champ.shrink["established"])
        champ_pred = s * champ.bundle["quantile_models"][2][50].predict(hold[FEATURES])
        train = lab[lab["week"] + pd.Timedelta(weeks=2) < hold["week"].min()]
        chall = hgb(params, loss="quantile", quantile=0.5).fit(train[FEATURES], train["y_2"])
        chall_pred = s * chall.predict(hold[FEATURES])
        naive = mae_rs(hold, np.zeros(len(hold)))
        run["champion_mae"], run["challenger_mae"] = mae_rs(hold, champ_pred), mae_rs(hold, chall_pred)
        promote = run["challenger_mae"] <= run["champion_mae"]
        print(f"Unseen weeks, 2 weeks ahead: current Rs {run['champion_mae']:.0f}, retrained Rs "
              f"{run['challenger_mae']:.0f}, no-change Rs {naive:.0f} -> {'promote' if promote else 'keep current'}")
        run["metrics"] = {"holdout_rows": len(hold), "holdout_weeks": n_weeks, "naive_mae": naive}

    if promote:
        final_q = {h: qmodels(params, ds.loc[ds[f"y_{h}"].notna(), FEATURES], ds.loc[ds[f"y_{h}"].notna(), f"y_{h}"])
                   for h in HORIZONS}
        clf = rise_clf().fit(lab[FEATURES], (lab["y_2"] > RISE).astype(int))
        major, minor, patch = (bundle["version"].split(".") + ["0", "0"])[:3]
        new = dict(bundle, quantile_models=final_q, rise_classifier=clf, sklearn_version=sklearn.__version__,
                   version=f"{major}.{minor}.{int(patch) + 1}")
        m = dict(bundle["metrics"])
        m.update(data_until=f"{ds['week'].max():%Y-%m-%d}", n_rows=int(len(ds)), n_series=int(ds.groupby(KEY).ngroups),
                 last_retrain={k: run.get(k) for k in ("holdout_from", "champion_mae", "challenger_mae")})
        new["metrics"] = m
        joblib.dump(new, DEFAULT_MODEL_PATH, compress=3)
        (ROOT / "models" / "metrics.json").write_text(json.dumps(m, indent=2))
        run.update(version=new["version"], promoted=True, notes=f"retrained in {time.time() - t0:.0f}s")
        print(f"Saved model {new['version']}")

        from api.service import SNAPSHOT, build_snapshot, fingerprint, write_snapshot
        write_snapshot(build_snapshot(load_prices(), fingerprint()), SNAPSHOT)
        print("Forecasts refreshed")
    else:
        run.update(promoted=False, notes="kept the current model: the retrained one was less accurate on unseen weeks")
    _log(run)
    return 0


def _log(run):
    if os.environ.get("SUPABASE_SERVICE_KEY"):
        try:
            live.log_run(run, table="model_runs")
        except Exception as e:  # noqa: BLE001
            print(f"could not log the run: {e}")


if __name__ == "__main__":
    sys.exit(main())
