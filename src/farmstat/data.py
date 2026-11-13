"""
Load and clean the all-India mandi price data.

Source: Agmarknet (Government of India) wholesale prices, one row per mandi per week:
modal price (Rs per quintal), arrivals (tonnes) and trading days.
  * onion, tomato, potato: 24 states, ~980 mandis, 2003-2026 (arrival-weighted weekly price)
  * arecanut: Karnataka and Kerala, one series per mandi and variety, 2021-2026 (no arrivals)
  * live weeks (data/live_weekly.csv.gz): built every day from the daily prices that the scheduled job fetches
    from data.gov.in and stores in Supabase (see farmstat.live). They extend each series past the panel.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_FILE = ROOT / "data" / "mandi_weekly.csv.gz"
LIVE_FILE = ROOT / "data" / "live_weekly.csv.gz"

CROPS = ["Onion", "Tomato", "Potato", "Arecanut"]
KEY = ["crop", "state", "market"]

MIN_WEEKS = 52          # a crop-mandi series needs at least a year of reported weeks
OUTLIER_RATIO = 3.0     # a weekly price 3x above/below its neighbours is treated as a typo


def load_raw(path: Path = DATA_FILE, live: Path | None = LIVE_FILE) -> pd.DataFrame:
    """The weekly panel, extended with live weeks that come after each series' last panel week."""
    df = pd.read_csv(path, parse_dates=["week"])
    df["source"] = "panel"
    if live is not None and Path(live).exists():
        lv = pd.read_csv(live, parse_dates=["week"])
        last = df.groupby(KEY)["week"].max().rename("panel_last")
        lv = lv.join(last, on=KEY)
        lv = lv[lv["panel_last"].isna() | (lv["week"] > lv["panel_last"])].drop(columns="panel_last")
        lv["source"] = "live"
        df = pd.concat([df, lv[df.columns.intersection(lv.columns)]], ignore_index=True)
    return df


def remove_outliers(df: pd.DataFrame, ratio: float = OUTLIER_RATIO) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Drop prices that are `ratio` times above/below the median of the 9 surrounding reported weeks.

    Real price spikes build up over several weeks, so their neighbours are high too and they
    are kept. Single typos (an extra zero) stand alone and are removed.
    """
    df = df.sort_values(KEY + ["week"]).copy()
    # one grouped rolling median (4x faster than a per-series lambda; same result), realigned to the rows
    local = (df.groupby(KEY, sort=False)["price"].rolling(9, center=True, min_periods=4).median()
             .reset_index(level=list(range(len(KEY))), drop=True).reindex(df.index))
    r = df["price"] / local
    bad = (r > ratio) | (r < 1 / ratio)
    return df[~bad].copy(), df[bad].copy()


def load_prices(path: Path = DATA_FILE, min_weeks: int = MIN_WEEKS) -> pd.DataFrame:
    """Clean weekly price table: one row per crop, mandi and week."""
    df = load_raw(path)
    df = df[(df["price"] > 0) & df["crop"].isin(CROPS)]
    df, _ = remove_outliers(df)
    n = df.groupby(KEY)["week"].transform("size")
    return df[n >= min_weeks].reset_index(drop=True)


def mandi_label(market: str, district: str, state: str) -> str:
    return f"{market} ({district})" if district and district.lower() not in market.lower() else market


__all__ = ["CROPS", "KEY", "ROOT", "DATA_FILE", "LIVE_FILE", "load_raw", "load_prices", "remove_outliers", "mandi_label"]
