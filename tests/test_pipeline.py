import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import clean_market_name, load_prices, load_weather, remove_outliers  # noqa: E402
from farmstat.features import FEATURES, build_dataset  # noqa: E402
from farmstat.forecast import DEFAULT_MODEL_PATH, Forecaster  # noqa: E402


@pytest.fixture(scope="module")
def data():
    prices = load_prices()
    return prices, build_dataset(prices, load_weather())


def test_market_names_merged():
    assert clean_market_name("Pune(Manjri) APMC") == "Pune(Manjri)"
    assert clean_market_name("Pune APMC ") == "Pune"


def test_typo_removed_but_spike_kept():
    # a real spike builds up and lasts for weeks (like tomato in July 2023)
    spike = [1000] * 15 + [1500, 2000, 3000, 3500, 4000, 4500, 5000, 5000, 5000, 4500, 4000, 3500, 3000, 2000] + [1000] * 15
    dates = pd.date_range("2023-01-01", periods=len(spike))
    df = pd.DataFrame({"crop": "Tomato", "market": "X", "date": dates, "modal": spike})
    df.loc[5, "modal"] = 10000  # a typo: one day 10x its neighbours
    kept, removed = remove_outliers(df)
    assert list(removed["modal"]) == [10000]
    assert kept["modal"].max() == 5000


def test_one_row_per_day_and_no_bad_prices(data):
    prices, _ = data
    assert not prices.duplicated(["crop", "market", "date"]).any()
    assert (prices["modal"] > 0).all()


def test_features_use_only_the_past(data):
    """Changing a future price must not change today's features (no leakage)."""
    prices, ds = data
    row = ds[(ds.crop == "Onion") & (ds.market == "Pune") & (ds.date == "2020-06-15")]
    future = prices.copy()
    m = (future.crop == "Onion") & (future.market == "Pune") & (future.date > "2020-06-15")
    future.loc[m, "modal"] *= 5
    ds2 = build_dataset(future, load_weather())
    row2 = ds2[(ds2.crop == "Onion") & (ds2.market == "Pune") & (ds2.date == "2020-06-15")]
    assert len(row) == 1
    np.testing.assert_allclose(row[FEATURES].to_numpy(), row2[FEATURES].to_numpy(), equal_nan=True)
    assert row2["y_14"].iloc[0] != row["y_14"].iloc[0]   # ...but the target does look ahead


@pytest.mark.skipif(not DEFAULT_MODEL_PATH.exists(), reason="model not trained")
def test_forecasts_are_sane(data):
    _, ds = data
    fc = Forecaster.load()
    latest = ds.sort_values("date").groupby(["crop", "market"]).tail(1)
    pred = fc.predict(latest)
    for h in fc.horizons:
        assert (pred[f"p10_{h}"] <= pred[f"p50_{h}"]).all() and (pred[f"p50_{h}"] <= pred[f"p90_{h}"]).all()
        ratio = pred[f"p50_{h}"] / latest["price"]
        assert ratio.between(0.3, 3).all()
    assert pred["prob_rise_14"].between(0, 1).all()
    advice = fc.advise("Tomato", 1000.0, pd.Series({**{f"p{q}_{h}": 2000.0 for q in (10, 50, 90) for h in (7, 14, 30)},
                                                    "prob_rise_14": 0.9}))
    assert advice.action == "Hold" and advice.hold_days == 7   # never hold tomatoes for more than a week
