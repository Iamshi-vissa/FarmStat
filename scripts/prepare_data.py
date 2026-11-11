"""
Build data/mandi_weekly.csv.gz from the all-India weekly Agmarknet panel.

Source panel: `top_weekly_panel_longhistory.csv` from the TOP Digital Twin project
(https://github.com/masroor01/TOP-Digital-Twin, data/agmarknet_weekly/longhistory/),
compiled from Agmarknet (Government of India, Open Government Data License - India).

Usage:
    python scripts/prepare_data.py path/to/top_weekly_panel_longhistory.csv
"""

import sys
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "data" / "mandi_weekly.csv.gz"


def main(src: str) -> None:
    d = pd.read_csv(src, parse_dates=["week_start"])
    d = d[d["imputed"] == 0]                                        # keep real reports only
    d["state"] = d["state"].replace({"Keralam": "Kerala", "Chattisgarh": "Chhattisgarh"})
    d["market"] = (d["market"].str.replace(r"\bAPMC\b", "", regex=True)   # 'APMC Azadpur' = 'Azadpur APMC' = 'Azadpur'
                   .str.replace(r"\s+", " ", regex=True).str.strip())
    d["crop"] = d["crop"].str.capitalize()
    d = d.rename(columns={"week_start": "week", "modal_price_weighted": "price", "arrivals_tonnes_week": "arrivals_t"})
    out = (d.groupby(["crop", "state", "district", "market", "week"], as_index=False)
             .agg(price=("price", "median"), arrivals_t=("arrivals_t", "sum"), trading_days=("trading_days", "max")))
    out["price"], out["arrivals_t"] = out["price"].round(1), out["arrivals_t"].round(2)
    out.sort_values(["crop", "state", "market", "week"]).to_csv(OUT, index=False, compression="gzip")
    print(f"wrote {OUT} ({len(out):,} rows, {out.groupby(['state', 'market']).ngroups} mandis)")


if __name__ == "__main__":
    main(sys.argv[1])
