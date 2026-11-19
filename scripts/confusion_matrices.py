"""Confusion matrices and accuracy scores for FarmStat's classifiers and the direction of its price forecast.

Set up exactly as in the training notebook (Section 10): train on weeks before 2023, test on January 2023 to July 2026,
2-week horizon. A "rise" is a 2-week price change of +5% or more; a classifier calls a rise when its probability is
0.5 or more. The direction matrix uses the production regressor's settings and counts only weeks where the price
moved more than 2% (smaller moves are "flat"). About 3 minutes on two cores.

Writes reports/confusion_matrices.json and docs/report/confusion_matrices.png.
    python scripts/confusion_matrices.py
"""
import json
import sys
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from farmstat.data import load_prices  # noqa: E402
from farmstat.features import FEATURES, build_dataset  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.preprocessing import StandardScaler, OneHotEncoder  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier, HistGradientBoostingRegressor  # noqa: E402
from sklearn.metrics import confusion_matrix, accuracy_score, precision_score, recall_score, f1_score, roc_auc_score  # noqa: E402

SEED, H, Y, CAT = 42, 2, 'y_2', ['crop_code', 'state_code']
t0 = time.time()
ds_all = build_dataset(load_prices())
ds = ds_all[ds_all.crop.isin(['Onion', 'Tomato', 'Potato'])]
lab = ds[ds[Y].notna()].reset_index(drop=True)
tr = lab[lab.week + pd.Timedelta(weeks=H) < pd.Timestamp('2023-01-01')]
te = lab[lab.week >= pd.Timestamp('2023-01-01')]
print(f'train {len(tr):,} test {len(te):,} ({time.time()-t0:.0f}s)', flush=True)
NUM = [f for f in FEATURES if f not in CAT]
pre = ColumnTransformer([('num', make_pipeline(SimpleImputer(strategy='median'), StandardScaler()), NUM),
                         ('cat', OneHotEncoder(handle_unknown='ignore'), CAT)])
RISE = np.log(1.05)
ytr, yte = (tr[Y] > RISE).astype(int).values, (te[Y] > RISE).astype(int).values
clfs = {'Gradient Boosting': HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
            min_samples_leaf=500, l2_regularization=1.0, categorical_features=CAT, random_state=SEED),
        'Random Forest': make_pipeline(SimpleImputer(strategy='median'), RandomForestClassifier(
            n_estimators=150, max_samples=0.25, min_samples_leaf=50, max_features=0.4, n_jobs=2, random_state=SEED)),
        'Logistic Regression': make_pipeline(pre, LogisticRegression(max_iter=3000, C=0.3))}
out = {'test_rows': int(len(te)), 'rises': int(yte.sum()), 'classifiers': {}}
for name, m in clfs.items():
    t1 = time.time(); m.fit(tr[FEATURES], ytr); p = m.predict_proba(te[FEATURES])[:, 1]; yh = (p >= .5).astype(int)
    tn, fp, fn, tp = confusion_matrix(yte, yh).ravel()
    out['classifiers'][name] = dict(TN=int(tn), FP=int(fp), FN=int(fn), TP=int(tp), accuracy=accuracy_score(yte, yh),
        precision=precision_score(yte, yh), recall=recall_score(yte, yh), specificity=tn / (tn + fp), F1=f1_score(yte, yh),
        roc_auc=roc_auc_score(yte, p))
    print(name, out['classifiers'][name], f'{time.time()-t1:.0f}s', flush=True)
tn = int((yte == 0).sum())
out['classifiers']['Always "no rise"'] = dict(TN=tn, FP=0, FN=int(yte.sum()), TP=0, accuracy=tn / len(yte), precision=0.0,
                                              recall=0.0, specificity=1.0, F1=0.0, roc_auc=0.5)
# direction of the 2-week price forecast (the production regressor's settings), among weeks that moved more than 2%
reg = HistGradientBoostingRegressor(loss='absolute_error', max_iter=300, learning_rate=0.03, max_leaf_nodes=15,
        min_samples_leaf=1000, l2_regularization=1.0, categorical_features=CAT, random_state=SEED).fit(tr[FEATURES], tr[Y])
pred = reg.predict(te[FEATURES]); y = te[Y].values; moved = np.abs(y) > .02
a, b = (y[moved] > 0).astype(int), (pred[moved] > 0).astype(int)
dn_dn, dn_up, up_dn, up_up = confusion_matrix(a, b).ravel()
out['direction'] = dict(moved_rows=int(moved.sum()), down_called_down=int(dn_dn), down_called_up=int(dn_up),
                        up_called_down=int(up_dn), up_called_up=int(up_up), accuracy=float((a == b).mean()),
                        precision_up=up_up / (up_up + dn_up), recall_up=up_up / (up_up + up_dn),
                        precision_down=dn_dn / (dn_dn + up_dn), recall_down=dn_dn / (dn_dn + dn_up))
print('direction', out['direction'], flush=True)
(ROOT / "reports" / "confusion_matrices.json").write_text(json.dumps(out, indent=1, default=float))

# one figure: the three rise classifiers and the direction of the price forecast. Each cell shows the count and the
# share of its actual row, shaded by that share (one green ramp), so rows read as "of the weeks that really rose...".
panels = [(n, np.array([[c["TN"], c["FP"]], [c["FN"], c["TP"]]]), ["No rise", "Rise 5%+"], f"accuracy {c['accuracy']:.1%}, recall {c['recall']:.1%}")
          for n, c in out["classifiers"].items() if n != 'Always "no rise"']
d = out["direction"]
panels.append(("Price direction, 2 weeks", np.array([[d["down_called_down"], d["down_called_up"]], [d["up_called_down"], d["up_called_up"]]]),
               ["Down", "Up"], f"accuracy {d['accuracy']:.1%} (moves over 2%)"))
plt.rcParams.update({"font.size": 10, "font.family": "DejaVu Sans"})
fig, axes = plt.subplots(1, 4, figsize=(17, 4.4))
for ax, (title, m, labels, note) in zip(axes, panels, strict=True):
    share = m / m.sum(axis=1, keepdims=True)
    ax.imshow(share, cmap="Greens", vmin=0, vmax=1)
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{m[i, j]:,}\n{share[i, j]:.0%} of row", ha="center", va="center", fontsize=10,
                    color="white" if share[i, j] > .55 else "#1f2a22")
    ax.set_xticks([0, 1], [f"Predicted {lab.lower()}" for lab in labels]); ax.set_yticks([0, 1], [f"Actual {lab.lower()}" for lab in labels])
    ax.set_title(f"{title}\n{note}", fontsize=10.5)
    for side in ax.spines.values(): side.set_visible(False)
fig.suptitle(f"FarmStat confusion matrices: trained before 2023, tested Jan 2023 to Jul 2026 ({out['test_rows']:,} forecasts, 2-week horizon)",
             fontsize=12, y=1.02)
plt.tight_layout(); plt.savefig(ROOT / "docs" / "report" / "confusion_matrices.png", dpi=150, bbox_inches="tight"); plt.close()
print(f"done in {time.time()-t0:.0f}s")
