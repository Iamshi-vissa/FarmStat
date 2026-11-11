"""
FarmStat — all-India mandi price forecasts and sell/hold advice for farmers.
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

from farmstat.data import CROPS, KEY, load_prices  # noqa: E402
from farmstat.features import build_dataset  # noqa: E402
from farmstat.forecast import MAX_HOLD_WEEKS, Forecaster  # noqa: E402

ACTIVE_WEEKS = 8   # a mandi counts as active if it reported in the last 8 weeks of the data

st.set_page_config(page_title="FarmStat — Mandi Price Forecast", page_icon="🌾", layout="wide")


@st.cache_resource
def get_model() -> Forecaster:
    return Forecaster.load()


@st.cache_data(persist="disk", show_spinner="Preparing forecasts for every mandi in India (first run takes about a minute)…")
def get_data(model_version: str):
    prices = load_prices()
    model = get_model()
    ds = build_dataset(prices, states=model.states)
    latest = ds.sort_values("week").groupby(KEY).tail(1)
    latest = latest[latest["week"] >= ds["week"].max() - pd.Timedelta(weeks=ACTIVE_WEEKS)]
    latest = latest.join(model.predict(latest)).reset_index(drop=True)
    return prices, latest


def rs(x: float) -> str:
    return f"₹{x:,.0f}"


def wk(h: int) -> str:
    return f"{h} week" + ("s" if h > 1 else "")


try:
    model = get_model()
    prices, latest = get_data(model.version)
except FileNotFoundError as exc:
    st.error(f"Missing file: {exc}. Run the training notebook first to create models/farmstat_model.joblib.")
    st.stop()

# ── Sidebar ──────────────────────────────────────────────────────────────────
st.sidebar.title("🌾 FarmStat")
st.sidebar.caption("Mandi price forecasts across India")
crop = st.sidebar.selectbox("Crop", [c for c in CROPS if c in set(latest["crop"])])
if crop == "Potato":
    st.sidebar.caption("Potato data covers West Bengal and Uttarakhand only.")
by_crop = latest[latest["crop"] == crop]
counts = by_crop.groupby("state").size()
states = counts.index.tolist()
default_state = states.index("Maharashtra") if "Maharashtra" in states else 0
state = st.sidebar.selectbox("State", states, index=default_state, format_func=lambda s: f"{s} ({counts[s]} mandis)")
in_state = by_crop[by_crop["state"] == state].sort_values("market")
labels = {r.market: f"{r.market} — {r.district}" if r.district and r.district not in r.market else r.market
          for r in in_state.itertuples()}
markets = list(labels)
default_m = next((i for i, m in enumerate(markets) if m in ("Pune", "Lasalgaon", "Kolar", "Azadpur")), 0)
market = st.sidebar.selectbox("Mandi", markets, index=default_m, format_func=labels.get)
qty = st.sidebar.number_input("Your quantity (quintals)", min_value=1.0, max_value=10000.0, value=10.0, step=1.0,
                              help="1 quintal = 100 kg. Used to show the money involved.")
st.sidebar.divider()
st.sidebar.caption(f"{latest.groupby(['state', 'market']).ngroups} active mandis in {latest['state'].nunique()} states · "
                   f"prices up to the week of **{latest['week'].max():%d %b %Y}** · Source: Agmarknet (Govt. of India)")

row = in_state[in_state["market"] == market].iloc[0]
price = float(row["price"])
advice = model.advise(crop, price, row)

tab_fc, tab_cmp, tab_acc, tab_about = st.tabs(["📈 Forecast", "🏪 Compare mandis", "✅ How accurate is it?", "ℹ️ About"])

# ── Forecast tab ─────────────────────────────────────────────────────────────
with tab_fc:
    st.header(f"{crop} at {market}")
    st.caption(f"{row['district']}, {state} · weekly modal price for the week of {row['week']:%d %b %Y} · "
               f"₹ per quintal (100 kg)")

    cols = st.columns(4)
    cols[0].metric("Price this week", rs(price))
    for c, h in zip(cols[1:], model.horizons):
        mid, lo, hi = row[f"p50_{h}"], row[f"p10_{h}"], row[f"p90_{h}"]
        c.metric(f"In {wk(h)} (expected)", rs(mid), f"{mid / price - 1:+.1%}")
        c.caption(f"Likely range {rs(lo)} – {rs(hi)}")

    if row["new_mandi"]:
        st.caption("⚠️ This mandi has less than 3 years of price history, so its forecasts are less reliable "
                   "and are kept close to today's price.")

    box = {"Hold": st.success, "Sell now": st.warning, "Your call": st.info}[advice.action]
    money = ""
    if advice.action == "Hold":
        money = (f" For your {qty:,.0f} quintals that is about "
                 f"**{rs((row[f'p50_{advice.hold_weeks}'] - price) * qty)}** more before storage costs.")
    box(f"**{advice.action}: {advice.headline}.** {advice.detail}{money}")
    st.write(f"Chance the price rises **5% or more in the next 2 weeks**: **{row['prob_rise']:.0%}**")
    if crop == "Tomato":
        st.caption(f"Tomatoes spoil quickly, so advice never suggests holding longer than {wk(MAX_HOLD_WEEKS['Tomato'])}.")

    hist = prices[(prices["crop"] == crop) & (prices["state"] == state) & (prices["market"] == market)].sort_values("week")
    hist = hist[hist["week"] >= row["week"] - pd.Timedelta(weeks=104)]
    w0 = row["week"]
    fx = [w0] + [w0 + pd.Timedelta(weeks=h) for h in model.horizons]
    mid = [price] + [row[f"p50_{h}"] for h in model.horizons]
    lo = [price] + [row[f"p10_{h}"] for h in model.horizons]
    hi = [price] + [row[f"p90_{h}"] for h in model.horizons]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=hist["week"], y=hist["price"], name="Weekly price", line=dict(color="#333", width=1.5)))
    fig.add_trace(go.Scatter(x=fx + fx[::-1], y=hi + lo[::-1], fill="toself", fillcolor="rgba(46,125,91,0.18)",
                             mode="lines", line=dict(width=0), name="Likely range", hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=fx, y=mid, name="Forecast", mode="lines+markers", line=dict(color="#2E7D5B", width=2.5, dash="dot")))
    fig.update_layout(height=420, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="₹ per quintal",
                      legend=dict(orientation="h", y=1.08), hovermode="x unified")
    st.plotly_chart(fig, width="stretch")
    with st.expander("Arrivals at this mandi (tonnes per week)"):
        st.bar_chart(hist.set_index("week")["arrivals_t"], height=220)

# ── Compare tab ──────────────────────────────────────────────────────────────
def compare_table(df: pd.DataFrame, h: int) -> pd.DataFrame:
    adv = [model.advise(crop, r["price"], r) for _, r in df.iterrows()]
    return pd.DataFrame({
        "Mandi": df["market"], "District": df["district"], "State": df["state"],
        "Week": df["week"].dt.strftime("%d %b %Y"), "Price (₹)": df["price"].round(0),
        f"Expected in {wk(h)} (₹)": df[f"p50_{h}"].round(0), "Change": df[f"p50_{h}"] / df["price"] - 1,
        "Chance of 5%+ rise": df["prob_rise"], "Advice": [f"Hold ~{wk(a.hold_weeks)}" if a.action == "Hold" else a.action for a in adv],
    }).sort_values("Price (₹)", ascending=False)

FMT = {"Change": "{:+.1%}", "Chance of 5%+ rise": "{:.0%}", "Price (₹)": "{:,.0f}"}

with tab_cmp:
    h = 1 if crop == "Tomato" else 2
    st.header(f"Where to sell {crop.lower()}?")
    t_state = compare_table(in_state, h)
    best = t_state.iloc[0]
    st.write(f"Highest price in **{state}** this week: **{best['Mandi']}** at **{rs(best['Price (₹)'])}** "
             f"({rs(best['Price (₹)'] - price)} vs {market}). Remember to count transport costs.")
    st.dataframe(t_state.drop(columns="State").style.format(FMT | {f"Expected in {wk(h)} (₹)": "{:,.0f}"}),
                 hide_index=True, width="stretch")

    st.subheader(f"{crop} across India")
    recent = by_crop[by_crop["week"] >= by_crop["week"].max() - pd.Timedelta(weeks=2)]
    smed = recent.groupby("state")["price"].median().sort_values()
    fig2 = go.Figure(go.Bar(x=smed.values, y=smed.index, orientation="h", marker_color="#2E7D5B",
                            text=[rs(v) for v in smed.values], textposition="outside"))
    fig2.update_layout(height=max(300, 26 * len(smed)), margin=dict(l=10, r=40, t=30, b=10),
                       title="Median price by state (last 2 weeks of data)", xaxis_title="₹ per quintal")
    st.plotly_chart(fig2, width="stretch")
    st.write("Highest-paying mandis in India right now")
    st.dataframe(compare_table(recent, h).head(15).style.format(FMT | {f"Expected in {wk(h)} (₹)": "{:,.0f}"}),
                 hide_index=True, width="stretch")

# ── Accuracy tab ─────────────────────────────────────────────────────────────
with tab_acc:
    m = model.metrics
    st.header("How accurate is it?")
    st.write(f"Tested on **{m['test_period'].replace(' to ', ' → ')}**, re-training the model at the start of each year "
             "and never using the test weeks to make any choice. *Skill* = how much smaller the error is than simply "
             "assuming the price will not change.")
    acc = pd.DataFrame(m["horizons"]).T
    acc.index = [wk(int(h)) for h in acc.index]
    st.dataframe(pd.DataFrame({
        "Average error (₹/qtl)": acc["MAE_Rs"].round(0), "Average % error": acc["MAPE"].map("{:.1%}".format),
        "Skill vs 'no change'": acc["skill_vs_naive"].map("{:+.1%}".format),
        "Up/down right": acc["direction_acc"].map("{:.0%}".format),
        "Range contains real price": acc["coverage_10_90"].map("{:.0%}".format),
    }), width="stretch")
    seg = pd.Series(m["by_crop_and_mandi_type_2w"]).map("{:+.1%}".format).rename("2-week skill vs 'no change'")
    st.write("By crop and mandi type (new = started reporting in 2020 or later):")
    st.dataframe(seg, width="stretch")
    bt = m["backtest_extra_Rs_per_quintal"]
    cols = st.columns(1 + len(bt))
    cols[0].metric("Rise classifier ROC-AUC", f"{m['rise_classifier']['ROC_AUC']:.3f}")
    for c, (k, v) in zip(cols[1:], bt.items()):
        c.metric(f"Back-test: {k}", f"{v:+.0f} ₹/qtl", help="Extra rupees per quintal from following the advice "
                 "instead of always selling at once, after storage losses (2023–2026).")
    for img in ["model_comparison.png", "case_studies.png", "rise_classifier.png"]:
        p = ROOT / "figures" / img
        if p.exists():
            st.image(str(p), width="stretch")

# ── About tab ────────────────────────────────────────────────────────────────
with tab_about:
    st.header("About FarmStat")
    st.markdown(
        f"""
**FarmStat** forecasts weekly wholesale prices of onion, tomato and potato in
{latest.groupby(['state', 'market']).ngroups} mandis across {latest['state'].nunique()} states for the next 1, 2 and 4
weeks, and turns the forecast into simple sell / hold advice.

* **Data:** Agmarknet (Government of India) mandi prices and arrivals, 2003–2026, aggregated to weekly.
* **Model:** gradient boosting with quantile loss (a likely range, not just one number) on 38 inputs — recent price
  moves, arrivals, national and state trends and season — plus a classifier for the chance of a 5%+ rise.
* **Limits:** no model can foresee government decisions such as export bans, and mandis that started reporting
  recently are harder to forecast. Forecasts are guidance, not a guarantee — always check today's rate before you sell.
"""
    )
