"""
Build the data files used by FarmStat.

1. data/mandi_weekly.csv.gz  - weekly mandi prices (onion, tomato, potato, arecanut)
   * onion / tomato / potato: `top_weekly_panel_longhistory.csv` from the TOP Digital Twin project
     (https://github.com/masroor01/TOP-Digital-Twin, data/agmarknet_weekly/longhistory/)
   * arecanut: daily Agmarknet rows from Malabar Mandi Prices
     (https://github.com/achuthpv/malabar-mandi-prices, data/prices/arecanut/*.csv)
2. data/state_monthly.csv.gz - monthly state prices for cashew and sugarcane
   * `state_monthly.csv.gz` from India Mandi Arrivals
     (https://github.com/herrrickshaw/india-mandi-arrivals, data/agmarknet/)

All three are compiled from Agmarknet (Government of India, Open Government Data License - India).

Usage:
    python scripts/prepare_data.py TOP_PANEL.csv ARECANUT_DIR STATE_MONTHLY.csv.gz
"""

import sys
from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
FIX_STATE = {"Keralam": "Kerala", "Chattisgarh": "Chhattisgarh"}
ARECANUT_STATE = {"Uttara Kannada": "Karnataka", "Shivamogga": "Karnataka", "Kasargod": "Kerala", "Kannur": "Kerala",
                  "Ernakulam": "Kerala", "Wayanad": "Kerala", "Kozhikode": "Kerala", "Malappuram": "Kerala",
                  "Coimbatore": "Tamil Nadu"}
COLS = ["crop", "state", "district", "market", "week", "price", "arrivals_t", "trading_days"]


def top_crops(src: str) -> pd.DataFrame:
    d = pd.read_csv(src, parse_dates=["week_start"])
    d = d[d["imputed"] == 0]                                        # real reports only
    d["state"] = d["state"].replace(FIX_STATE)
    d["market"] = (d["market"].str.replace(r"\bAPMC\b", "", regex=True)   # 'APMC Azadpur' = 'Azadpur APMC' = 'Azadpur'
                   .str.replace(r"\s+", " ", regex=True).str.strip())
    d["crop"] = d["crop"].str.capitalize()
    d = d.rename(columns={"week_start": "week", "modal_price_weighted": "price", "arrivals_tonnes_week": "arrivals_t"})
    return (d.groupby(["crop", "state", "district", "market", "week"], as_index=False)
              .agg(price=("price", "median"), arrivals_t=("arrivals_t", "sum"), trading_days=("trading_days", "max")))


def arecanut(folder: str) -> pd.DataFrame:
    a = pd.concat(pd.read_csv(f) for f in sorted(Path(folder).glob("*.csv")))
    a = a[(a["source"] == "agmarknet") & (a["modal_price"] > 0)].copy()
    a["date"] = pd.to_datetime(a["date"])
    a["state"] = a["district"].map(ARECANUT_STATE)
    # Each variety (Rashi, Chali, Bette, ...) is a different product with its own price level,
    # so every mandi-variety pair becomes its own series, e.g. "Sirsi (Rashi)".
    name = a["market"].str.replace(r"\b(APMC|Market)\b", "", regex=True).str.strip()
    a["market"] = name + " (" + a["variety"].str.strip().replace({"api": "Api"}) + ")"
    a["week"] = a["date"] - pd.to_timedelta(a["date"].dt.weekday, unit="D")
    w = a.groupby(["state", "district", "market", "week"], as_index=False).agg(
        price=("modal_price", "median"), trading_days=("date", "nunique"))
    return w.assign(crop="Arecanut", arrivals_t=float("nan"))       # this source has no arrival quantities


def state_monthly(src: str) -> pd.DataFrame:
    s = pd.read_csv(src)
    s = s[s["commodity_id"].isin([33, 122])].copy()                 # 33 = Cashewnuts, 122 = Sugarcane
    s["crop"] = s["commodity_id"].map({33: "Cashew", 122: "Sugarcane"})
    s["state"] = s["state"].replace(FIX_STATE)
    return s.rename(columns={"price_rs_qtl": "price"})[["crop", "state", "month", "price", "arrivals_t"]]


def main(top_src: str, arecanut_dir: str, monthly_src: str) -> None:
    w = pd.concat([top_crops(top_src), arecanut(arecanut_dir)])[COLS]
    w["price"], w["arrivals_t"] = w["price"].round(1), w["arrivals_t"].round(2)
    w.sort_values(["crop", "state", "market", "week"]).to_csv(DATA / "mandi_weekly.csv.gz", index=False, compression="gzip")
    print(f"mandi_weekly: {len(w):,} rows, {w.groupby(['crop', 'state', 'market']).ngroups} series")
    m = state_monthly(monthly_src).sort_values(["crop", "state", "month"])
    m.to_csv(DATA / "state_monthly.csv.gz", index=False, compression="gzip")
    print(f"state_monthly: {len(m):,} rows")


if __name__ == "__main__":
    main(*sys.argv[1:4])
