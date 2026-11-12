import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import KEY, load_prices, remove_outliers  # noqa: E402
from farmstat.features import FEATURES, build_dataset  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, Forecaster  # noqa: E402


@pytest.fixture(scope="module")
def prices():
    return load_prices()


@pytest.fixture(scope="module")
def onion_mh(prices):
    """A smaller slice so the tests run fast: onion in Maharashtra."""
    return prices[(prices.crop == "Onion") & (prices.state == "Maharashtra")]


def test_coverage_is_all_india(prices):
    assert prices["state"].nunique() >= 20
    assert prices.groupby(["state", "market"]).ngroups >= 500
    assert not prices.duplicated(KEY + ["week"]).any()


def test_typo_removed_but_spike_kept():
    spike = [1000] * 10 + [1500, 2500, 3500, 4500, 5000, 5000, 4500, 3500, 2500, 1500] + [1000] * 10
    df = pd.DataFrame({"crop": "Tomato", "state": "X", "market": "Y",
                       "week": pd.date_range("2023-01-02", periods=len(spike), freq="W-MON"), "price": spike})
    df.loc[3, "price"] = 10000   # one week 10x its neighbours
    kept, removed = remove_outliers(df)
    assert list(removed["price"]) == [10000]
    assert kept["price"].max() == 5000


def test_features_use_only_the_past(onion_mh):
    """Changing future prices must not change this week's features (no leakage)."""
    ds = build_dataset(onion_mh)
    t = pd.Timestamp("2021-06-07")
    key = (ds.market == "Lasalgaon") & (ds.week == t)
    future = onion_mh.copy()
    future.loc[future.week > t, "price"] *= 5
    ds2 = build_dataset(future)
    a, b = ds.loc[key, FEATURES].to_numpy(), ds2.loc[(ds2.market == "Lasalgaon") & (ds2.week == t), FEATURES].to_numpy()
    assert a.shape[0] == 1
    np.testing.assert_allclose(a, b, equal_nan=True)


@pytest.mark.skipif(not DEFAULT_MODEL_PATH.exists(), reason="model not trained")
def test_forecasts_are_sane(onion_mh):
    fc = Forecaster.load()
    ds = build_dataset(onion_mh, states=fc.states)
    latest = ds.sort_values("week").groupby(KEY).tail(1)
    pred = fc.predict(latest)
    for h in fc.horizons:
        assert (pred[f"p10_{h}"] <= pred[f"p50_{h}"]).all() and (pred[f"p50_{h}"] <= pred[f"p90_{h}"]).all()
        assert (pred[f"p50_{h}"] / latest["price"]).between(0.3, 3).all()
    assert pred["prob_rise"].between(0, 1).all()
    row = pd.Series({**{f"p{q}_{h}": 2000.0 for q in (10, 50, 90) for h in (1, 2, 4)}, "prob_rise": 0.9})
    advice = fc.advise("Tomato", 1000.0, row)
    assert advice.action == "Hold" and advice.hold_weeks == 1   # never hold tomatoes for more than a week


def test_arecanut_series_are_per_variety(prices):
    a = prices[prices.crop == "Arecanut"]
    assert a.groupby(["state", "market"]).ngroups >= 30
    assert a["market"].str.contains(r"\(.+\)$").all()          # e.g. "Sirsi (Rashi)"
    assert set(a["state"]) <= {"Karnataka", "Kerala", "Tamil Nadu"}


@pytest.mark.skipif(not DEFAULT_MODEL_PATH.exists(), reason="model not trained")
def test_arecanut_is_shown_as_no_change_with_a_range(prices):
    fc = Forecaster.load()
    ds = build_dataset(prices[prices.crop == "Arecanut"], states=fc.states)
    latest = ds.sort_values("week").groupby(KEY).tail(1)
    pred = fc.predict(latest)
    assert pred["naive"].all()
    np.testing.assert_allclose(pred["p50_2"], latest["price"])
    assert (pred["p10_2"] < latest["price"]).all() and (pred["p90_2"] > latest["price"]).all()
    assert fc.advise("Arecanut", 40000.0, pred.iloc[0]).action == "Your call"


def test_cashew_monthly_features():
    from farmstat.monthly import M_FEATURES, build_monthly, load_monthly
    c = load_monthly("Cashew")
    assert c["state"].nunique() >= 4
    d = build_monthly(c)
    assert set(M_FEATURES) <= set(d.columns) and d["y_1"].notna().sum() > 200
