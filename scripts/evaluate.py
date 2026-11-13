"""
Independent evaluation and validation of the weekly price models (onion, tomato, potato).

Re-creates the honest test from the training notebook and adds statistical validation:

  1. Walk-forward test, retrained every year: for each year 2022-2026 the models are trained only on data whose
     target week falls before 1 January of that year, then forecast every week of that year. 2022 is used only to
     calibrate the ranges (step 6); 2023-2026 is the reported test, as in the notebook.
  2. Accuracy per horizon (1, 2, 4 weeks): MAE in Rs per quintal, RMSE, MAPE, skill vs "no change", direction
     accuracy, pinball loss, range coverage and width.
  3. Significance: Diebold-Mariano test of the model vs "no change" on weekly average absolute errors, with a
     Newey-West variance (lag = horizon), plus a 95% block-bootstrap interval (blocks of weeks) for the skill.
  4. Breakdowns: by crop and mandi type, by year, by state.
  5. Rise warning (chance of a 5%+ rise in 2 weeks), retrained yearly: ROC-AUC, Brier score vs base rate, and a
     reliability table.
  6. Range calibration: each quantile's empirical coverage, and split-conformal widening learned from the previous
     year's out-of-sample errors (so 2023 uses 2022, and so on), to fix the too-narrow 4-week range.

Writes reports/evaluation.json, reports/model_evaluation.md and charts in docs/eval/.

    python scripts/evaluate.py            # about 30-60 minutes on a laptop
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor  # noqa: E402
from sklearn.metrics import brier_score_loss, roc_auc_score  # noqa: E402
from farmstat.calibration import CAL_YEARS, tail_shifts  # noqa: E402

from farmstat.data import load_prices  # noqa: E402
from farmstat.features import CAT_FEATURES, FEATURES, HORIZONS, build_dataset  # noqa: E402
from farmstat.forecast import YOUNG_WEEKS, Forecaster  # noqa: E402

TOP = ["Onion", "Tomato", "Potato"]
YEARS = [2022, 2023, 2024, 2025, 2026]      # 2022 = calibration year only
TEST_YEARS = YEARS[1:]
RISE = np.log(1.05)
SEED = 42
OUT = ROOT / "reports"
FIG = ROOT / "docs" / "eval"
CACHE = OUT / ".cache"   # per (horizon, year) predictions, so an interrupted run resumes
INK, FC, DROP, GREY, FOREST = "#242620", "#2a78d6", "#c2410c", "#a3a69e", "#2b7b47"


def hgb(params, **kw):
    base = dict(loss="absolute_error", max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200,
                l2_regularization=1.0, categorical_features=CAT_FEATURES, random_state=SEED)
    base.update(params)
    base.update(kw)
    return HistGradientBoostingRegressor(**base)


def split(df, year, h):
    start, end = pd.Timestamp(f"{year}-01-01"), pd.Timestamp(f"{year + 1}-01-01")
    return df[df["week"] + pd.Timedelta(weeks=h) < start], df[(df["week"] >= start) & (df["week"] < end)]


def newey_west_var(d: np.ndarray, lag: int) -> float:
    d = d - d.mean()
    n = len(d)
    v = np.dot(d, d) / n
    for k in range(1, lag + 1):
        v += 2 * (1 - k / (lag + 1)) * np.dot(d[k:], d[:-k]) / n
    return v / n


def diebold_mariano(e_model: pd.Series, e_naive: pd.Series, weeks: pd.Series, h: int) -> dict:
    """DM test on the weekly cross-sectional mean of absolute errors (model minus naive)."""
    w = pd.DataFrame({"week": weeks, "d": e_model - e_naive}).groupby("week")["d"].mean().sort_index().to_numpy()
    stat = w.mean() / np.sqrt(newey_west_var(w, max(h, 1)))
    # small-sample correction (Harvey, Leybourne and Newbold 1997)
    n = len(w)
    stat *= np.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    p = 2 * stats.t.sf(abs(stat), df=n - 1)
    return {"weeks": n, "mean_diff_Rs": float(w.mean()), "dm_stat": float(stat), "p_value": float(p)}


def block_bootstrap_skill(err_m, err_n, weeks, reps=1000, seed=SEED) -> tuple[float, float]:
    """95% interval for skill = 1 - MAE_model / MAE_naive, resampling whole weeks."""
    g = pd.DataFrame({"week": weeks, "m": err_m, "n": err_n}).groupby("week").agg(m=("m", "sum"), n=("n", "sum"))
    m, n = g["m"].to_numpy(), g["n"].to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(g), size=(reps, len(g)))
    s = 1 - m[idx].sum(1) / n[idx].sum(1)
    return float(np.percentile(s, 2.5)), float(np.percentile(s, 97.5))


def metrics(df: pd.DataFrame, h: int, lo="lo", hi="hi") -> dict:
    y, mid, p = df[f"y_{h}"].to_numpy(), df["mid"].to_numpy(), df["price"].to_numpy()
    actual, fc = p * np.exp(y), p * np.exp(mid)
    e_m, e_n = np.abs(fc - actual), np.abs(p - actual)
    moved = np.abs(y) > 0.02
    inside = (y >= df[lo].to_numpy()) & (y <= df[hi].to_numpy())
    pin = {}
    for q, col in [(0.1, "q10"), (0.5, "mid"), (0.9, "q90")]:
        r = y - df[col].to_numpy()
        pin[q] = float(np.mean(np.maximum(q * r, (q - 1) * r)))
    return {
        "rows": int(len(df)), "MAE_Rs": float(e_m.mean()), "naive_MAE_Rs": float(e_n.mean()),
        "RMSE_Rs": float(np.sqrt(np.mean((fc - actual) ** 2))), "MAPE": float(np.mean(e_m / actual)),
        "skill_vs_naive": float(1 - e_m.mean() / e_n.mean()),
        "direction_acc": float(np.mean(np.sign(mid[moved]) == np.sign(y[moved]))),
        "coverage_10_90": float(inside.mean()),
        "range_width_pct": float(np.median(np.exp(df[hi].to_numpy()) - np.exp(df[lo].to_numpy()))),
        "pinball_log": pin,
    }


def main() -> int:
    t0 = time.time()
    OUT.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    FIG.mkdir(parents=True, exist_ok=True)
    model = Forecaster.load()
    params = model.metrics.get("best_params", {})
    shrink = model.shrink
    print(f"Model {model.version}; params {params}; shrink {shrink}")

    ds = build_dataset(load_prices(), states=model.states)
    ds = ds[ds["crop"].isin(TOP)]
    print(f"{len(ds):,} rows, {ds['week'].min():%Y} to {ds['week'].max():%d %b %Y} ({time.time() - t0:.0f}s)")

    # 1. walk-forward predictions -----------------------------------------------------------------------------
    preds, clf_rows = {}, []
    for h in HORIZONS:
        lab = ds[ds[f"y_{h}"].notna()]
        parts = []
        for yr in YEARS:
            tr, te = split(lab, yr, h)
            if te.empty:
                continue
            ck = CACHE / f"h{h}_{yr}.pkl"
            if ck.exists():   # resume an interrupted run
                part, crow = pd.read_pickle(ck)
                parts.append(part)
                if crow is not None:
                    clf_rows.append(crow)
                print(f"  h={h} {yr}: cached", flush=True)
                continue
            q = {k: hgb(params, loss="quantile", quantile=k / 100).fit(tr[FEATURES], tr[f"y_{h}"]).predict(te[FEATURES])
                 for k in (10, 50, 90)}
            s = np.where(te["history_weeks"].to_numpy() < YOUNG_WEEKS, shrink["young"], shrink["established"])
            mid = s * q[50]
            parts.append(te[["week", "crop", "state", "market", "price", "history_weeks", f"y_{h}"]].assign(
                year=yr, mid=mid, q10=mid - np.maximum(q[50] - q[10], 0), q90=mid + np.maximum(q[90] - q[50], 0)))
            crow = None
            if h == 2:
                c = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=500,
                                                   l2_regularization=1.0, categorical_features=CAT_FEATURES, random_state=SEED)
                c.fit(tr[FEATURES], (tr["y_2"] > RISE).astype(int))
                crow = pd.DataFrame({"year": yr, "p": c.predict_proba(te[FEATURES])[:, 1],
                                     "y": (te["y_2"] > RISE).astype(int).to_numpy()})
                clf_rows.append(crow)
            pd.to_pickle((parts[-1], crow), ck)
            print(f"  h={h} {yr}: train {len(tr):,} test {len(te):,} ({time.time() - t0:.0f}s)", flush=True)
        preds[h] = pd.concat(parts, ignore_index=True)
        preds[h].to_csv(OUT / f"backtest_h{h}.csv.gz", index=False, float_format="%.5f")
    clf = pd.concat(clf_rows, ignore_index=True)

    # 6. range calibration (split-conformal, one shift per tail), learned only from the out-of-sample errors of up to
    #    CAL_YEARS earlier years -- the same rule the app uses (src/farmstat/calibration.py)
    for h in HORIZONS:
        p = preds[h]
        p["lo"], p["hi"] = p["q10"], p["q90"]
        p["lo_cal"], p["hi_cal"] = np.nan, np.nan
        for yr in TEST_YEARS:
            prev, cur = p["year"].between(yr - CAL_YEARS, yr - 1), p["year"] == yr
            lo_shift, hi_shift = tail_shifts(p.loc[prev, "q10"], p.loc[prev, "q90"], p.loc[prev, f"y_{h}"])
            p.loc[cur, "lo_cal"] = p.loc[cur, "q10"] - lo_shift
            p.loc[cur, "hi_cal"] = p.loc[cur, "q90"] + hi_shift

    test = {h: preds[h][preds[h]["year"].isin(TEST_YEARS)].copy() for h in HORIZONS}

    # 2-3. headline metrics, significance, bootstrap ---------------------------------------------------------
    res = {"model_version": model.version, "test_years": TEST_YEARS, "params": params, "shrink": shrink, "horizons": {}}
    for h in HORIZONS:
        t = test[h]
        m = metrics(t, h)
        m["coverage_10_90_conformal"] = float(np.mean((t[f"y_{h}"] >= t["lo_cal"]) & (t[f"y_{h}"] <= t["hi_cal"])))
        m["range_width_pct_conformal"] = float(np.median(np.exp(t["hi_cal"]) - np.exp(t["lo_cal"])))
        m["quantile_coverage"] = {"below_q10": float(np.mean(t[f"y_{h}"] < t["q10"])),
                                  "below_median": float(np.mean(t[f"y_{h}"] < t["mid"])),
                                  "below_q90": float(np.mean(t[f"y_{h}"] < t["q90"]))}
        actual = t["price"] * np.exp(t[f"y_{h}"])
        e_m = np.abs(t["price"] * np.exp(t["mid"]) - actual)
        e_n = np.abs(t["price"] - actual)
        m["diebold_mariano"] = diebold_mariano(e_m, e_n, t["week"], h)
        m["skill_95ci"] = block_bootstrap_skill(e_m.to_numpy(), e_n.to_numpy(), t["week"])
        res["horizons"][str(h)] = m
        print(f"h={h}: MAE Rs {m['MAE_Rs']:.0f} vs naive {m['naive_MAE_Rs']:.0f}, skill {m['skill_vs_naive']:.3f} "
              f"[{m['skill_95ci'][0]:.3f}, {m['skill_95ci'][1]:.3f}], DM p={m['diebold_mariano']['p_value']:.2g}, "
              f"coverage {m['coverage_10_90']:.3f} -> {m['coverage_10_90_conformal']:.3f}")

    # 4. breakdowns (2 weeks ahead) --------------------------------------------------------------------------
    t2 = test[2].assign(mandi_type=np.where(test[2]["history_weeks"] >= YOUNG_WEEKS, "established", "new"))
    def table(df, by):
        rows = []
        for k, g in df.groupby(by):
            r = metrics(g, 2)
            rows.append({"group": " / ".join(map(str, k)) if isinstance(k, tuple) else str(k), "rows": r["rows"],
                         "MAE_Rs": r["MAE_Rs"], "skill_vs_naive": r["skill_vs_naive"],
                         "direction_acc": r["direction_acc"], "coverage_10_90": r["coverage_10_90"]})
        return rows
    res["by_crop_and_type"] = table(t2, ["crop", "mandi_type"])
    res["by_year"] = table(t2, "year")
    res["by_state"] = sorted(table(t2, "state"), key=lambda r: -r["rows"])[:12]

    # 5. rise warning ----------------------------------------------------------------------------------------
    ct = clf[clf["year"].isin(TEST_YEARS)]
    base = ct["y"].mean()
    bins = pd.cut(ct["p"], [0, .1, .2, .3, .4, .5, .6, 1.0], include_lowest=True)
    rel = ct.groupby(bins, observed=True).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size")).reset_index()
    res["rise_warning"] = {
        "roc_auc": float(roc_auc_score(ct["y"], ct["p"])), "brier": float(brier_score_loss(ct["y"], ct["p"])),
        "brier_base_rate": float(brier_score_loss(ct["y"], np.full(len(ct), base))), "base_rate": float(base),
        "reliability": [{"bin": str(r["p"]), "predicted": float(r["predicted"]), "observed": float(r["observed"]),
                         "rows": int(r["rows"])} for _, r in rel.iterrows()],
    }
    rw = res["rise_warning"]
    print(f"rise warning: AUC {rw['roc_auc']:.3f}, Brier {rw['brier']:.4f} vs base-rate {rw['brier_base_rate']:.4f}")

    # charts -------------------------------------------------------------------------------------------------
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": GREY})
    fig, ax = plt.subplots(1, 3, figsize=(14, 3.8))
    hs = [str(h) for h in HORIZONS]
    ax[0].bar([f"{h} wk" for h in hs], [res["horizons"][h]["naive_MAE_Rs"] for h in hs], color=GREY, width=.6, label="No change")
    ax[0].bar([f"{h} wk" for h in hs], [res["horizons"][h]["MAE_Rs"] for h in hs], color=FC, width=.35, label="FarmStat")
    ax[0].set_title("Average error, Rs per quintal"); ax[0].legend(frameon=False)
    sk = [res["horizons"][h]["skill_vs_naive"] * 100 for h in hs]
    ci = np.array([res["horizons"][h]["skill_95ci"] for h in hs]) * 100
    ax[1].errorbar([f"{h} wk" for h in hs], sk, yerr=[np.array(sk) - ci[:, 0], ci[:, 1] - np.array(sk)], fmt="o", color=FOREST, capsize=5)
    ax[1].axhline(0, color=GREY, lw=1); ax[1].set_title("Less error than no change, % (95% interval)")
    cov = [res["horizons"][h]["coverage_10_90"] * 100 for h in hs]
    covc = [res["horizons"][h]["coverage_10_90_conformal"] * 100 for h in hs]
    x = np.arange(len(hs))
    ax[2].bar(x - .18, cov, .36, color=GREY, label="Model range"); ax[2].bar(x + .18, covc, .36, color=FC, label="After conformal widening")
    ax[2].axhline(80, color=INK, lw=1, ls="--"); ax[2].set_xticks(x, [f"{h} wk" for h in hs]); ax[2].set_ylim(50, 90)
    ax[2].set_title("Range contains the real price, % (target 80)"); ax[2].legend(frameon=False, fontsize=8)
    plt.tight_layout(); plt.savefig(FIG / "accuracy.png", dpi=150); plt.close()

    fig, ax = plt.subplots(1, 2, figsize=(10, 3.8))
    yrs = [r["group"] for r in res["by_year"] if int(r["group"]) in TEST_YEARS]
    ax[0].bar(yrs, [r["skill_vs_naive"] * 100 for r in res["by_year"] if int(r["group"]) in TEST_YEARS], color=FC, width=.55)
    ax[0].axhline(0, color=GREY, lw=1); ax[0].set_title("2-week skill vs no change by year, %")
    r = res["rise_warning"]["reliability"]
    ax[1].plot([0, 1], [0, 1], color=GREY, ls="--", lw=1)
    ax[1].plot([b["predicted"] for b in r], [b["observed"] for b in r], "o-", color=FOREST)
    ax[1].set_xlabel("Predicted chance of a 5%+ rise"); ax[1].set_ylabel("Observed share")
    ax[1].set_title(f"Rise warning reliability (AUC {res['rise_warning']['roc_auc']:.2f})")
    plt.tight_layout(); plt.savefig(FIG / "by_year_reliability.png", dpi=150); plt.close()

    res["runtime_s"] = round(time.time() - t0)
    (OUT / "evaluation.json").write_text(json.dumps(res, indent=2))
    write_report(res)
    print(f"Done in {res['runtime_s']}s -> reports/evaluation.json, reports/model_evaluation.md, docs/eval/")
    return 0


def write_report(r: dict) -> None:
    H = r["horizons"]
    lines = [
        "# FarmStat model evaluation", "",
        f"Model {r['model_version']}. Walk-forward test on {r['test_years'][0]}-{r['test_years'][-1]}: for each year the models "
        "were retrained on data whose outcome is known before 1 January of that year, then forecast every week of it. "
        "Onion, tomato and potato, all mandis. Generated by `scripts/evaluate.py`.", "",
        "## Accuracy", "",
        "| Horizon | Rows | Avg error (Rs/q) | No change (Rs/q) | Skill | 95% interval | Direction right | Range coverage | After conformal |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for h, m in H.items():
        lines.append(f"| {h} week{'s' if h != '1' else ''} | {m['rows']:,} | {m['MAE_Rs']:.0f} | {m['naive_MAE_Rs']:.0f} | "
                     f"{m['skill_vs_naive']:.1%} | {m['skill_95ci'][0]:.1%} to {m['skill_95ci'][1]:.1%} | {m['direction_acc']:.1%} | "
                     f"{m['coverage_10_90']:.1%} | {m['coverage_10_90_conformal']:.1%} |")
    lines += ["", "## Is the gain real? (Diebold-Mariano test vs no change)", "",
              "| Horizon | Weeks | Mean error difference (Rs/q) | DM statistic | p-value |", "|---|---|---|---|---|"]
    for h, m in H.items():
        d = m["diebold_mariano"]
        lines.append(f"| {h} | {d['weeks']} | {d['mean_diff_Rs']:.1f} | {d['dm_stat']:.2f} | {d['p_value']:.2g} |")
    lines += ["", "A negative difference means FarmStat's error is lower. The test uses each week's average error across "
              "mandis, a Newey-West variance and the Harvey small-sample correction.", "",
              "## Range calibration", "",
              "| Horizon | Below 10th pct (target 10%) | Below median (target 50%) | Below 90th pct (target 90%) | Median range width, before -> after conformal |",
              "|---|---|---|---|---|"]
    for h, m in H.items():
        q = m["quantile_coverage"]
        lines.append(f"| {h} | {q['below_q10']:.1%} | {q['below_median']:.1%} | {q['below_q90']:.1%} | "
                     f"{m['range_width_pct']:.1%} -> {m['range_width_pct_conformal']:.1%} |")
    lines += ["", "Recalibrated ranges: each test year's range is adjusted using only the "
              f"out-of-sample errors of up to {CAL_YEARS} earlier years: each end of the range moves by the amount that would "
              "have left 10% of outcomes outside it (split-conformal, one shift per tail).", "",
              "## 2 weeks ahead by crop and mandi type", "", "New = less than 3 years (156 weeks) of price history at the forecast date; established = the rest.", "", "| Group | Rows | Avg error (Rs/q) | Skill | Direction | Coverage |", "|---|---|---|---|---|---|"]
    for t in r["by_crop_and_type"]:
        lines.append(f"| {t['group']} | {t['rows']:,} | {t['MAE_Rs']:.0f} | {t['skill_vs_naive']:.1%} | {t['direction_acc']:.1%} | {t['coverage_10_90']:.1%} |")
    lines += ["", "## By year (2 weeks ahead)", "", "| Year | Rows | Avg error (Rs/q) | Skill | Direction | Coverage |", "|---|---|---|---|---|---|"]
    for t in r["by_year"]:
        lines.append(f"| {t['group']}{' (calibration only)' if int(t['group']) not in r['test_years'] else ''} | {t['rows']:,} | "
                     f"{t['MAE_Rs']:.0f} | {t['skill_vs_naive']:.1%} | {t['direction_acc']:.1%} | {t['coverage_10_90']:.1%} |")
    lines += ["", "## Largest states (2 weeks ahead)", "", "| State | Rows | Avg error (Rs/q) | Skill | Direction |", "|---|---|---|---|---|"]
    for t in r["by_state"]:
        lines.append(f"| {t['group']} | {t['rows']:,} | {t['MAE_Rs']:.0f} | {t['skill_vs_naive']:.1%} | {t['direction_acc']:.1%} |")
    rw = r["rise_warning"]
    lines += ["", "## Rise warning (chance of a 5%+ rise in 2 weeks)", "",
              f"ROC-AUC {rw['roc_auc']:.3f}. Brier score {rw['brier']:.4f} against {rw['brier_base_rate']:.4f} for always "
              f"predicting the base rate ({rw['base_rate']:.1%}).", "",
              "| Predicted | Observed | Rows |", "|---|---|---|"]
    for b in rw["reliability"]:
        lines.append(f"| {b['predicted']:.1%} | {b['observed']:.1%} | {b['rows']:,} |")
    lines += ["", "![Accuracy](../docs/eval/accuracy.png)", "", "![By year and reliability](../docs/eval/by_year_reliability.png)", ""]
    (OUT / "model_evaluation.md").write_text("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
