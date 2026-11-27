"""
Daily job (after the day's prices are in): retrain the weekly price models on all data (history + live weeks) and
keep the new model only if it passes a check on recent weeks it was not trained on.

  1. If the current model hasn't seen at least 6 weeks with known 2-week outcomes (champion / challenger):
     a challenger with the same settings, trained only on data before those weeks, must be no more than 10% less
     accurate there than the current model (a few weeks are too noisy to demand a strict win).
  2. Otherwise (the usual case once it retrains daily): the last 6 weeks with known outcomes are held out, and a
     challenger trained before them must not be broken (error under 1.5x the "no change" forecast).
  3. If the check passes, refit on everything and save it; otherwise keep the current model.
  4. Recent-skill calibration (every run): on the last 6 held-out weeks, for each crop, find how far the model's
     forecast should be trusted (0 = "no change", 1 = as trained) and save that with the model. Where the model has
     had no edge lately, its forecasts sit close to today's price and the call says so.
  5. Log the result to Supabase model_runs and refresh the forecasts.

    python scripts/retrain.py            # normal run
    python scripts/retrain.py --force    # retrain without the check
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
MIN_HOLDOUT_WEEKS = 6
TUNE_WEEKS = 6        # recent weeks used to decide how far to trust the model for each crop
GRID = [round(0.1 * i, 1) for i in range(11)]
MIN_TUNE_ROWS = 200
TOLERANCE = 1.10      # challenger may be up to 10% worse than the current model on a few unseen weeks
SANITY = 1.5          # ...and never worse than 1.5x "no change"


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


def tune_crop_shrink(rows: pd.DataFrame, pred: np.ndarray) -> tuple[dict, dict]:
    """Per crop, how far to trust the model on recent weeks: the multiplier k in GRID (0 = "no change", 1 = the model
    as trained) with the lowest error on `rows`. Ties go to the smaller k. Crops with too few rows keep k = 1."""
    shrink, report = {}, {}
    for crop in TOP:
        m = (rows["crop"] == crop).to_numpy()
        if m.sum() < MIN_TUNE_ROWS:
            shrink[crop] = 1.0
            continue
        g, p = rows[m], pred[m]
        k = min(GRID, key=lambda k: (round(mae_rs(g, k * p), 1), k))
        shrink[crop] = float(k)
        report[crop] = {"shrink": float(k), "model_mae": mae_rs(g, p), "calibrated_mae": mae_rs(g, k * p),
                        "naive_mae": mae_rs(g, np.zeros(len(g))), "rows": int(m.sum()),
                        "rise_rate": float((g["y_2"] > RISE).mean())}
    return shrink, report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    today = time.strftime("%Y-%m-%d")

    champ = Forecaster.load()
    bundle = champ.bundle
    params = bundle["metrics"].get("best_params", {})
    cutoff = pd.Timestamp(bundle["metrics"]["data_until"])

    prices = load_prices()
    ds = build_dataset(prices, states=champ.states)
    ds = ds[ds["crop"].isin(TOP)]
    lab = ds[ds["y_2"].notna()]
    unseen = lab[lab["week"] > cutoff]
    n_weeks = unseen["week"].nunique()
    print(f"Data to {ds['week'].max():%d %b %Y}; current model trained to {cutoff:%d %b %Y}; "
          f"{n_weeks} unseen weeks with known outcomes ({len(unseen):,} rows)")

    # held-out weeks: those the current model hasn't seen (champion / challenger), else the last few with known outcomes
    compare_champion = n_weeks >= MIN_HOLDOUT_WEEKS and not a.force
    if compare_champion:
        hold = unseen
    else:
        hold = lab[lab["week"].isin(np.sort(lab["week"].unique())[-MIN_HOLDOUT_WEEKS:])]
    run = {"version": bundle["version"], "data_until": f"{ds['week'].max():%Y-%m-%d}",
           "holdout_from": f"{hold['week'].min():%Y-%m-%d}"}
    s = np.where(hold["history_weeks"].to_numpy() < YOUNG_WEEKS, champ.shrink["young"], champ.shrink["established"])
    train = lab[lab["week"] + pd.Timedelta(weeks=2) < hold["week"].min()]
    chall = hgb(params, loss="quantile", quantile=0.5).fit(train[FEATURES], train["y_2"])
    chall_pred = s * chall.predict(hold[FEATURES])
    naive = mae_rs(hold, np.zeros(len(hold)))
    run["challenger_mae"] = mae_rs(hold, chall_pred)

    promote = True
    if compare_champion:
        run["champion_mae"] = mae_rs(hold, s * champ.bundle["quantile_models"][2][50].predict(hold[FEATURES]))
        promote = run["challenger_mae"] <= TOLERANCE * run["champion_mae"]
        print(f"Unseen weeks, 2 weeks ahead: current Rs {run['champion_mae']:.0f}, retrained Rs "
              f"{run['challenger_mae']:.0f}, no-change Rs {naive:.0f} -> {'promote' if promote else 'keep current'}")
    elif not a.force:
        promote = run["challenger_mae"] < SANITY * naive
        print(f"Last {MIN_HOLDOUT_WEEKS} weeks with known outcomes, 2 weeks ahead: retrained Rs "
              f"{run['challenger_mae']:.0f}, no-change Rs {naive:.0f} -> {'promote' if promote else 'keep current'}")

    # recent-skill calibration, every day: on the last TUNE_WEEKS held-out weeks, how far does the model (trained
    # before them) beat "no change" for each crop? Forecasts are pulled towards "no change" where it doesn't.
    tune = (hold["week"] >= np.sort(hold["week"].unique())[-TUNE_WEEKS:][0]).to_numpy()
    crop_shrink, recent = tune_crop_shrink(hold[tune], chall_pred[tune])
    tune_rows = hold[tune]
    k = tune_rows["crop"].map(crop_shrink).fillna(1.0).to_numpy()
    run["metrics"] = {"holdout_rows": len(hold), "holdout_weeks": int(hold["week"].nunique()), "naive_mae": naive,
                      "crop_shrink": crop_shrink, "calibrated_mae": mae_rs(tune_rows, k * chall_pred[tune]),
                      "calibrated_naive_mae": mae_rs(tune_rows, np.zeros(len(tune_rows)))}
    for crop, r in recent.items():
        print(f"  {crop}: last {TUNE_WEEKS} weeks, model Rs {r['model_mae']:.0f}, no-change Rs {r['naive_mae']:.0f} "
              f"-> trust {r['shrink']:.1f}")

    m = dict(bundle["metrics"])
    if promote:
        final_q = {h: qmodels(params, ds.loc[ds[f"y_{h}"].notna(), FEATURES], ds.loc[ds[f"y_{h}"].notna(), f"y_{h}"])
                   for h in HORIZONS}
        clf = rise_clf().fit(lab[FEATURES], (lab["y_2"] > RISE).astype(int))
        major, minor, patch = (bundle["version"].split(".") + ["0", "0"])[:3]
        out = dict(bundle, quantile_models=final_q, rise_classifier=clf, sklearn_version=sklearn.__version__,
                   version=f"{major}.{minor}.{int(patch) + 1}")
        m.update(data_until=f"{ds['week'].max():%Y-%m-%d}", retrained_at=today, n_rows=len(ds),
                 n_series=int(ds.groupby(KEY).ngroups),
                 last_retrain={k: run.get(k) for k in ("holdout_from", "champion_mae", "challenger_mae")})
        run.update(version=out["version"], promoted=True, notes=f"retrained in {time.time() - t0:.0f}s")
        print(f"Saved model {out['version']}")
    else:
        out = dict(bundle)
        run.update(promoted=False, notes="kept the current model: the retrained one failed the check on held-out weeks")
    tune_from = np.sort(hold["week"].unique())[-TUNE_WEEKS:][0]
    m["recent_check"] = {"checked_at": today, "weeks_from": f"{pd.Timestamp(tune_from):%Y-%m-%d}",
                         "weeks": TUNE_WEEKS, "horizon_weeks": 2, "crops": recent}
    run["trained_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    m["last_run"] = run   # Supabase copies this into model_runs (farmstat_private.sync_model_runs, every hour)
    out["crop_shrink"], out["metrics"] = crop_shrink, m
    joblib.dump(out, DEFAULT_MODEL_PATH, compress=3)
    (ROOT / "models" / "metrics.json").write_text(json.dumps(m, indent=2))

    from api.service import SNAPSHOT, build_snapshot, fingerprint, write_snapshot
    write_snapshot(build_snapshot(load_prices(), fingerprint()), SNAPSHOT)
    print("Forecasts refreshed")
    _log(run)
    return 0


def _log(run):
    """Optional direct log; without the secret, Supabase picks the run up from models/metrics.json within the hour."""
    if os.environ.get("SUPABASE_SERVICE_KEY"):
        try:
            live.log_run(run, table="model_runs")
        except Exception as e:  # noqa: BLE001
            print(f"could not log the run: {e}")


if __name__ == "__main__":
    sys.exit(main())
