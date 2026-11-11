"""
FarmStat — mandi price forecasts and sell/hold advice for farmers.
Run:  streamlit run app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import CROPS, load_prices, load_weather  # noqa: E402
from farmstat.features import build_dataset  # noqa: E402
from farmstat.forecast import MAX_HOLD_DAYS, Forecaster  # noqa: E402

ACTIVE_DAYS = 45  # a mandi counts as active if it reported a price in the last 45 days of the data

st.set_page_config(page_title="FarmStat — Mandi Price Forecast", page_icon="🌾", layout="wide")


@st.cache_resource
def get_model() -> Forecaster:
    return Forecaster.load()


@st.cache_data
def get_data():
    prices = load_prices()
    model = get_model()
    ds = build_dataset(prices, load_weather(), markets=model.markets)
    latest = ds.sort_values("date").groupby(["crop", "market"]).tail(1)
    latest = latest[latest["date"] >= ds["date"].max() - pd.Timedelta(days=ACTIVE_DAYS)]
    latest = latest.join(model.predict(latest)).reset_index(drop=True)
    return prices, latest


def rs(x: float) -> str:
    return f"₹{x:,.0f}"


try:
    model = get_model()
    prices, latest = get_data()
except FileNotFoundError as exc:
    st.error(f"Missing file: {exc}. Run the training notebook first to create models/farmstat_model.joblib.")
    st.stop()

# ── Sidebar ──────────────────────────────────────────────────────────────────
st.sidebar.title("🌾 FarmStat")
st.sidebar.caption("Mandi price forecasts for Pune district")
crop = st.sidebar.selectbox("Crop", [c for c in CROPS if c in set(latest["crop"])])
mandis = sorted(latest.loc[latest["crop"] == crop, "market"])
default = mandis.index("Pune") if "Pune" in mandis else 0
market = st.sidebar.selectbox("Mandi", mandis, index=default)
qty = st.sidebar.number_input("Your quantity (quintals)", min_value=1.0, max_value=10000.0, value=10.0, step=1.0,
                              help="1 quintal = 100 kg. Used to show the money involved.")
st.sidebar.divider()
st.sidebar.caption(f"Prices up to **{latest['date'].max():%d %b %Y}** · Source: Agmarknet (Govt. of India) · "
                   "Weather: Open-Meteo")

row = latest[(latest["crop"] == crop) & (latest["market"] == market)].iloc[0]
price = float(row["price"])
advice = model.advise(crop, price, row)

tab_fc, tab_cmp, tab_acc, tab_about = st.tabs(["📈 Forecast", "🏪 Compare mandis", "✅ How accurate is it?", "ℹ️ About"])

# ── Forecast tab ─────────────────────────────────────────────────────────────
with tab_fc:
    st.header(f"{crop} at {market}")
    st.caption(f"Latest modal price reported on {row['date']:%d %b %Y}. All prices in rupees per quintal (100 kg).")

    cols = st.columns(4)
    cols[0].metric("Price now", rs(price))
    for c, h in zip(cols[1:], model.horizons):
        mid, lo, hi = row[f"p50_{h}"], row[f"p10_{h}"], row[f"p90_{h}"]
        c.metric(f"In {h} days (expected)", rs(mid), f"{mid / price - 1:+.1%}")
        c.caption(f"Likely range {rs(lo)} – {rs(hi)}")

    box = {"Hold": st.success, "Sell now": st.warning, "Your call": st.info}[advice.action]
    money = ""
    if advice.action == "Hold":
        gain = (row[f"p50_{advice.hold_days}"] - price) * qty
        money = f" For your {qty:,.0f} quintals that is about **{rs(gain)}** more before storage costs."
    box(f"**{advice.action}: {advice.headline}.** {advice.detail}{money}")
    st.write(f"Chance the price rises **5% or more in the next 14 days**: **{row['prob_rise_14']:.0%}**")
    if crop == "Tomato":
        st.caption(f"Tomatoes spoil quickly, so advice never suggests holding longer than {MAX_HOLD_DAYS['Tomato']} days.")

    hist = prices[(prices["crop"] == crop) & (prices["market"] == market)].sort_values("date")
    hist = hist[hist["date"] >= row["date"] - pd.Timedelta(days=365)]
    d0 = row["date"]
    fx = [d0] + [d0 + pd.Timedelta(days=h) for h in model.horizons]
    mid = [price] + [row[f"p50_{h}"] for h in model.horizons]
    lo = [price] + [row[f"p10_{h}"] for h in model.horizons]
    hi = [price] + [row[f"p90_{h}"] for h in model.horizons]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=hist["date"], y=hist["modal"], name="Actual price", line=dict(color="#333", width=1.5)))
    fig.add_trace(go.Scatter(x=fx + fx[::-1], y=hi + lo[::-1], fill="toself", fillcolor="rgba(46,125,91,0.18)",
                             mode="lines", line=dict(width=0), name="Likely range", hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=fx, y=mid, name="Forecast", mode="lines+markers", line=dict(color="#2E7D5B", width=2.5, dash="dot")))
    fig.update_layout(height=420, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="₹ per quintal",
                      legend=dict(orientation="h", y=1.08), hovermode="x unified")
    st.plotly_chart(fig, use_container_width=True)

# ── Compare tab ──────────────────────────────────────────────────────────────
with tab_cmp:
    st.header(f"Where to sell {crop.lower()}?")
    h = 7 if crop == "Tomato" else 14
    t = latest[latest["crop"] == crop].copy()
    adv = [model.advise(crop, r["price"], r) for _, r in t.iterrows()]
    t["Advice"] = [f"Hold ~{a.hold_days} days" if a.action == "Hold" else a.action for a in adv]
    table = pd.DataFrame({
        "Mandi": t["market"], "Last report": t["date"].dt.strftime("%d %b %Y"), "Price now (₹)": t["price"].round(0),
        f"Expected in {h} days (₹)": t[f"p50_{h}"].round(0), "Change": t[f"p50_{h}"] / t["price"] - 1,
        "Chance of 5%+ rise (14 d)": t["prob_rise_14"], "Advice": t["Advice"],
    }).sort_values("Price now (₹)", ascending=False)
    best = table.iloc[0]
    st.write(f"Highest price today: **{best['Mandi']}** at **{rs(best['Price now (₹)'])}** "
             f"({rs(best['Price now (₹)'] - price)} vs {market}). Remember to count transport costs.")
    st.dataframe(table.style.format({"Change": "{:+.1%}", "Chance of 5%+ rise (14 d)": "{:.0%}",
                                     "Price now (₹)": "{:,.0f}", f"Expected in {h} days (₹)": "{:,.0f}"}),
                 hide_index=True, use_container_width=True)

# ── Accuracy tab ─────────────────────────────────────────────────────────────
with tab_acc:
    m = model.metrics
    st.header("How accurate is it?")
    st.write(f"Tested on **{m['holdout_period'].replace(' to ', ' → ')}**, data the models never saw while training. "
             "*Skill* is how much smaller the error is than simply assuming the price will not change.")
    acc = pd.DataFrame(m["horizons"]).T
    acc.index = [f"{i} days" for i in acc.index]
    st.dataframe(pd.DataFrame({
        "Average error (₹/qtl)": acc["MAE_Rs"].round(0), "Average % error": acc["MAPE"].map("{:.1%}".format),
        "Skill vs 'no change'": acc["skill_vs_naive"].map("{:+.1%}".format),
        "Up/down right": acc["direction_acc"].map("{:.0%}".format),
        "Range contains real price": acc["coverage_10_90"].map("{:.0%}".format),
    }), use_container_width=True)
    c1, c2 = st.columns(2)
    c1.metric("Rise classifier ROC-AUC", f"{m['rise_classifier']['ROC_AUC']:.3f}")
    bt = m["backtest_extra_Rs_per_quintal"]
    c2.metric("Back-test: extra ₹ per quintal from following advice", ", ".join(f"{k} {v:+.0f}" for k, v in bt.items()))
    for img in ["model_comparison.png", "case_studies.png", "rise_classifier.png"]:
        p = ROOT / "figures" / img
        if p.exists():
            st.image(str(p), use_container_width=True)

# ── About tab ────────────────────────────────────────────────────────────────
with tab_about:
    st.header("About FarmStat")
    st.markdown(
        """
**FarmStat** forecasts wholesale mandi prices of onion, tomato and potato in
Pune district for the next 7, 14 and 30 days, and turns the forecast into simple sell / hold advice.

* **Data:** daily modal prices from Agmarknet (Government of India), 2001–2026, 13 mandis; daily weather from Open-Meteo.
* **Model:** gradient boosting with quantile loss (a likely range, not just one number) on 35 features —
  recent price moves, district-wide trend, season and rainfall — plus a classifier for the chance of a 5%+ rise.
* **Limits:** no model can foresee government decisions such as export bans. Forecasts are guidance, not a
  guarantee — always check today's rate at the mandi before you sell.
"""
    )
