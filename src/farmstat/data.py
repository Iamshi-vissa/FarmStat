"""
Load and clean the mandi price data and the weather data.

Prices: daily wholesale prices (Rs per quintal) from Agmarknet for onion, tomato and
potato in the mandis of Pune district, Maharashtra.
Weather: daily weather for Pune and Junnar from Open-Meteo.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
WEATHER_DIR = ROOT / "data" / "weather"

CROPS = ["Onion", "Tomato", "Potato"]

# Mandis in the Junnar / Ambegaon area use Junnar weather; the rest use Pune weather
_JUNNAR_AREA = ("Junnar", "Manchar", "Narayangaon", "Otur", "Alephata")

MIN_OBSERVATIONS = 600   # a crop-mandi series needs this many trading days to be modelled
OUTLIER_RATIO = 3.0      # a price 3x above or below its neighbours is treated as a typo


def weather_location(market: str) -> str:
    return "junnar" if market.startswith(_JUNNAR_AREA) else "pune"


def clean_market_name(name: str) -> str:
    """'Pune(Manjri) APMC' and 'Pune(Manjri)' are the same mandi."""
    return re.sub(r"\s*APMC\s*$", "", str(name)).strip()


def load_raw_prices(raw_dir: Path = RAW_DIR) -> pd.DataFrame:
    frames = []
    for path in sorted(Path(raw_dir).glob("*.csv")):
        df = pd.read_csv(path)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df["date"] = pd.to_datetime(df["Arrival_Date"], dayfirst=True, format="mixed")
    df = df.rename(columns={"Commodity": "crop", "Market": "market", "Modal_Price": "modal",
                            "Min_Price": "min_price", "Max_Price": "max_price", "Variety": "variety"})
    return df[["date", "crop", "market", "variety", "min_price", "max_price", "modal"]]


def remove_outliers(df: pd.DataFrame, ratio: float = OUTLIER_RATIO) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Drop prices that are `ratio` times above/below the median of the 21 surrounding trading days.

    Real spikes (like the 2023 tomato surge) build up over several days, so their neighbours
    are high too and they are kept. Single typos (an extra zero) stand alone and are removed.
    """
    df = df.sort_values(["crop", "market", "date"]).copy()
    local_median = (df.groupby(["crop", "market"])["modal"]
                      .transform(lambda s: s.rolling(21, center=True, min_periods=5).median()))
    r = df["modal"] / local_median
    bad = (r > ratio) | (r < 1 / ratio)
    return df[~bad].copy(), df[bad].copy()


def load_prices(raw_dir: Path = RAW_DIR, min_obs: int = MIN_OBSERVATIONS) -> pd.DataFrame:
    """Clean price table: one row per crop, mandi and trading day."""
    df = load_raw_prices(raw_dir)
    df["market"] = df["market"].map(clean_market_name)
    df = df[(df["modal"] > 0) & (df["min_price"] <= df["modal"]) & (df["modal"] <= df["max_price"])]
    # Some days have more than one row (different varieties): take the median
    df = (df.groupby(["crop", "market", "date"], as_index=False)
            .agg(modal=("modal", "median"), min_price=("min_price", "min"), max_price=("max_price", "max")))
    df, _ = remove_outliers(df)
    counts = df.groupby(["crop", "market"])["date"].transform("size")
    df = df[counts >= min_obs]
    return df.reset_index(drop=True)


def load_weather(weather_dir: Path = WEATHER_DIR) -> dict[str, pd.DataFrame]:
    out = {}
    for loc in ["pune", "junnar"]:
        w = pd.read_csv(Path(weather_dir) / f"{loc}_daily_weather.csv", parse_dates=["time"])
        w = w.rename(columns={"time": "date", "precipitation_sum": "rain", "temperature_2m_max": "tmax",
                              "temperature_2m_mean": "tmean", "relative_humidity_2m_mean": "humidity"})
        out[loc] = w.set_index("date")[["rain", "tmax", "tmean", "humidity"]].asfreq("D")
    return out


def series_summary(prices: pd.DataFrame) -> pd.DataFrame:
    """One line per crop-mandi series (used by the app's drop-downs)."""
    g = prices.groupby(["crop", "market"])
    return pd.DataFrame({"first": g["date"].min(), "last": g["date"].max(), "days": g.size(),
                         "last_price": g["modal"].last()}).reset_index()


__all__ = ["CROPS", "load_prices", "load_weather", "weather_location", "series_summary",
           "remove_outliers", "load_raw_prices", "clean_market_name"]
