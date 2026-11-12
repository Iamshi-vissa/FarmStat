"""
FarmStat — all-India mandi price forecasts and sell/hold advice for farmers.
Run:  streamlit run app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import joblib
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from farmstat.data import CROPS, KEY, load_prices  # noqa: E402
from farmstat.features import build_dataset  # noqa: E402
from farmstat.forecast import MAX_HOLD_WEEKS, Forecaster  # noqa: E402
from farmstat.monthly import M_HORIZONS, MonthlyForecaster, build_monthly, load_monthly, product_label  # noqa: E402

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
    latest = latest[latest["week"] >= latest.groupby("crop")["week"].transform("max") - pd.Timedelta(weeks=ACTIVE_WEEKS)]
    latest = latest.join(model.predict(latest)).reset_index(drop=True)
    return prices, latest


@st.cache_resource
def get_cashew():
    fc = MonthlyForecaster(joblib.load(ROOT / "models" / "cashew_model.joblib"))
    df = load_monthly("Cashew")
    rows = build_monthly(df)
    last = rows.sort_values("month").groupby("state").tail(1)
    last = last.join(fc.predict(last)).reset_index(drop=True)
    return fc, df, last


@st.cache_data
def get_sugarcane():
    s = pd.read_csv(ROOT / "data" / "state_monthly.csv.gz")
    s = s[(s["crop"] == "Sugarcane") & s["price"].notna()].copy()
    s["month"] = pd.to_datetime(s["month"])
    return s


def rs(x: float) -> str:
    return f"₹{x:,.0f}"


def rs_k(x: float) -> str:
    """Compact rupees for ranges: ₹36.5k."""
    return f"₹{x / 1000:,.1f}k" if x >= 10000 else rs(x)


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
crop = st.sidebar.selectbox("Crop", [c for c in CROPS if c in set(latest["crop"])] + ["Cashew", "Sugarcane"])
if crop == "Potato":
    st.sidebar.caption("Potato data covers West Bengal and Uttarakhand only.")
if crop == "Arecanut":
    st.sidebar.caption("Arecanut data covers Karnataka and Kerala. Each mandi is listed per variety (Rashi, Chali, …).")


# ── Cashew: state-level monthly ──────────────────────────────────────────────
if crop == "Cashew":
    cfc, cdf, clast = get_cashew()
    state = st.sidebar.selectbox("State", sorted(clast["state"]))
    r_ = clast[clast["state"] == state].iloc[0]
    price = float(r_["price"])
    typical = cdf[cdf["state"] == state]["price"].median()
    st.sidebar.divider()
    st.sidebar.caption("Cashew: Agmarknet monthly state average (no mandi-level history available) · "
                       f"up to **{clast['month'].max():%b %Y}**")
    tab1, tab2 = st.tabs(["📈 Price and range", "ℹ️ About cashew data"])
    with tab1:
        st.header(f"Cashew ({product_label('Cashew', typical)}) in {state}")
        st.caption(f"State average for {r_['month']:%B %Y} · ₹ per quintal")
        cols = st.columns(4)
        cols[0].metric("This month", rs(price))
        for c, h in zip(cols[1:], M_HORIZONS):
            mid = r_[f"p50_{h}"]
            c.metric(f"In {h} month{'s' if h > 1 else ''} (rough guide)", rs(mid), f"{mid / price - 1:+.1%}")
            c.caption(f"Likely range {rs(r_[f'p10_{h}'])} – {rs(r_[f'p90_{h}'])}")
        st.info("**Treat this as a rough guide.** Cashew only has monthly state averages, so there is little to learn "
                "from. In testing (2024–2026) the model was about as accurate as simply assuming 'no change' — better "
                "3 months ahead, slightly worse 2 months ahead. The range is calibrated on real past errors.")
        hist = cdf[cdf["state"] == state].sort_values("month")
        m0 = r_["month"]
        fx = [m0] + [m0 + pd.DateOffset(months=h) for h in M_HORIZONS]
        lo = [price] + [r_[f"p10_{h}"] for h in M_HORIZONS]
        hi = [price] + [r_[f"p90_{h}"] for h in M_HORIZONS]
        md_ = [price] + [r_[f"p50_{h}"] for h in M_HORIZONS]
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=hist["month"], y=hist["price"], name="Monthly price", mode="lines+markers",
                                 line=dict(color="#333", width=1.5)))
        fig.add_trace(go.Scatter(x=fx + fx[::-1], y=hi + lo[::-1], fill="toself", fillcolor="rgba(46,125,91,0.18)",
                                 mode="lines", line=dict(width=0), name="Likely range", hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=fx, y=md_, name="Rough guide", mode="lines+markers",
                                 line=dict(color="#2E7D5B", width=2, dash="dot")))
        fig.update_layout(height=400, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="₹ per quintal",
                          legend=dict(orientation="h", y=1.08))
        st.plotly_chart(fig, width="stretch")
        season = pd.Series(cfc.bundle["season"])
        season.index = [pd.Timestamp(2000, int(m), 1).strftime("%b") for m in season.index]
        sfig = go.Figure(go.Bar(x=season.index, y=season.values,
                                marker_color=["#2E7D5B" if v >= 0 else "#B5476B" for v in season.values]))
        sfig.update_layout(height=260, margin=dict(l=10, r=10, t=40, b=10), yaxis_title="% vs yearly average",
                           title=f"Seasonal pattern (all states): usually highest in {season.idxmax()}, lowest in {season.idxmin()}")
        st.plotly_chart(sfig, width="stretch")
        comp = clast.assign(product=[product_label("Cashew", cdf[cdf.state == s_]["price"].median()) for s_ in clast["state"]])
        st.write("**All states (latest month)**")
        st.dataframe(pd.DataFrame({"State": comp["state"], "Product": comp["product"], "Month": comp["month"].dt.strftime("%b %Y"),
                                   "Price (₹/qtl)": comp["price"].round(0)}).sort_values("Price (₹/qtl)", ascending=False),
                     hide_index=True, width="stretch")
    with tab2:
        st.markdown("""
Cashew prices come from Agmarknet's **monthly weighted-average price per state**, 2019–2026. States whose typical
price is above ₹30,000/quintal (Maharashtra) report **kernels** (processed cashew), the rest **raw nuts**. Single months
where a raw-nut state suddenly reports kernel prices are removed. Ridge regression, gradient boosting and "no change"
were compared on 2022–2023; gradient boosting was marginally best and is used, but on 2024–2026 it was roughly tied
with "no change", so the numbers are shown as a rough guide with a wide range.
""")
    st.stop()


# ── Sugarcane: information page ──────────────────────────────────────────────
if crop == "Sugarcane":
    sug = get_sugarcane()
    st.sidebar.divider()
    st.sidebar.caption("Sugarcane is mostly sold to sugar mills at the government FRP, not in mandis.")
    st.header("Sugarcane")
    st.success("**FRP for the 2026–27 sugar season (from 1 Oct 2026): ₹365 per quintal** at a 10.25% sugar recovery rate. "
               "Mills pay ₹3.56/quintal more for every 0.1% recovery above 10.25%, and ₹3.56 less for every 0.1% below; "
               "where recovery is under 9.5% there is no further cut, so farmers get at least ₹338.3/quintal.")
    st.markdown("""
Most sugarcane is **not sold in mandis**: farmers supply sugar mills at the **Fair and Remunerative Price (FRP)** fixed
each season by the Government of India (some states, such as Uttar Pradesh, add a higher *State Advised Price*). The
price a farmer gets depends mainly on the FRP and the mill's sugar recovery, not on weekly market swings — so FarmStat
does not forecast sugarcane. Agmarknet's mandi data for it is thin (a few states, with gaps), shown below for reference.
""")
    frp = pd.Series({"2019-10-01": 275, "2020-10-01": 285, "2021-10-01": 290, "2022-10-01": 305, "2023-10-01": 315,
                     "2024-10-01": 340, "2025-10-01": 355, "2026-10-01": 365})
    frp.index = pd.to_datetime(frp.index)
    fig = go.Figure()
    g = sug[sug["state"] == "Chhattisgarh"].sort_values("month")
    fig.add_trace(go.Scatter(x=g["month"], y=g["price"], mode="lines+markers", name="Chhattisgarh mandi average"))
    fig.add_trace(go.Scatter(x=frp.index, y=frp.values, mode="lines", line=dict(shape="hv", dash="dash", color="black"),
                             name="FRP (mill price)"))
    fig.update_layout(height=400, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="₹ per quintal",
                      legend=dict(orientation="h", y=1.1))
    st.plotly_chart(fig, width="stretch")
    st.caption("Only Chhattisgarh reports sugarcane mandi prices regularly; other states' data is too patchy to chart. "
               "Its mandi price tracks the FRP closely.")
    st.caption("FRP history by sugar season (Oct–Sep): 2019–20 ₹275 · 2020–21 ₹285 · 2021–22 ₹290 · 2022–23 ₹305 · "
               "2023–24 ₹315 · 2024–25 ₹340 · 2025–26 ₹355 · 2026–27 ₹365 per quintal. Source: CCEA decisions.")
    st.stop()
by_crop = latest[latest["crop"] == crop]
counts = by_crop.groupby("state").size()
states = counts.index.tolist()
default_state = states.index("Maharashtra") if "Maharashtra" in states else 0
unit = "mandi-varieties" if crop == "Arecanut" else "mandis"
state = st.sidebar.selectbox("State", states, index=default_state, format_func=lambda s: f"{s} ({counts[s]} {unit})")
in_state = by_crop[by_crop["state"] == state].sort_values("market")
labels = {r.market: f"{r.market} — {r.district}" if r.district and r.district not in r.market else r.market
          for r in in_state.itertuples()}
markets = list(labels)
default_m = next((i for i, m in enumerate(markets)
                  if m in ("Pune", "Lasalgaon", "Kolar", "Azadpur", "Sirsi (Rashi)", "Payyannur (Other)")), 0)
market = st.sidebar.selectbox("Mandi", markets, index=default_m, format_func=labels.get)
qty = st.sidebar.number_input("Your quantity (quintals)", min_value=1.0, max_value=10000.0, value=10.0, step=1.0,
                              help="1 quintal = 100 kg. Used to show the money involved.")
N_MANDIS = latest.assign(base=latest["market"].str.replace(r" \(.*\)$", "", regex=True)).groupby(["state", "base"]).ngroups
st.sidebar.divider()
st.sidebar.caption(f"{N_MANDIS} active mandis in {latest['state'].nunique()} states · "
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

    naive = bool(row["naive"])
    cols = st.columns(4)
    cols[0].metric("Price this week", rs(price))
    for c, h in zip(cols[1:], model.horizons):
        mid, lo, hi = row[f"p50_{h}"], row[f"p10_{h}"], row[f"p90_{h}"]
        if naive:
            c.markdown(f"<div style='font-size:0.875rem'>In {wk(h)}: usual range</div>"
                       f"<div style='font-size:1.6rem;font-weight:600;line-height:2.4rem'>{rs_k(lo)} – {rs_k(hi)}</div>",
                       unsafe_allow_html=True)
        else:
            c.metric(f"In {wk(h)} (expected)", rs(mid), f"{mid / price - 1:+.1%}")
            c.caption(f"Likely range {rs(lo)} – {rs(hi)}")

    if row["new_mandi"] and not naive:
        st.caption("⚠️ This mandi has less than 3 years of price history, so its forecasts are less reliable "
                   "and are kept close to today's price.")

    box = {"Hold": st.success, "Sell now": st.warning, "Your call": st.info}[advice.action]
    money = ""
    if advice.action == "Hold":
        money = (f" For your {qty:,.0f} quintals that is about "
                 f"**{rs((row[f'p50_{advice.hold_weeks}'] - price) * qty)}** more before storage costs.")
    box(f"**{advice.action}: {advice.headline}.** {advice.detail}{money}")
    if naive:
        st.write(f"Historically, arecanut rose **5% or more within 2 weeks** in **{row['prob_rise']:.0%}** of weeks.")
    else:
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
    if not naive:
        fig.add_trace(go.Scatter(x=fx, y=mid, name="Forecast", mode="lines+markers", line=dict(color="#2E7D5B", width=2.5, dash="dot")))
    fig.update_layout(height=420, margin=dict(l=10, r=10, t=30, b=10), yaxis_title="₹ per quintal",
                      legend=dict(orientation="h", y=1.08), hovermode="x unified")
    st.plotly_chart(fig, width="stretch")
    if hist["arrivals_t"].notna().any():
        with st.expander("Arrivals at this mandi (tonnes per week)"):
            st.bar_chart(hist.set_index("week")["arrivals_t"], height=220)

# ── Compare tab ──────────────────────────────────────────────────────────────
def compare_table(df: pd.DataFrame, h: int) -> pd.DataFrame:
    adv = [model.advise(crop, r["price"], r) for _, r in df.iterrows()]
    if crop in model.naive_crops:
        return pd.DataFrame({"Mandi": df["market"], "District": df["district"], "State": df["state"],
                             "Week": df["week"].dt.strftime("%d %b %Y"), "Price (₹)": df["price"].round(0)}
                            ).sort_values("Price (₹)", ascending=False)
    return pd.DataFrame({
        "Mandi": df["market"], "District": df["district"], "State": df["state"],
        "Week": df["week"].dt.strftime("%d %b %Y"), "Price (₹)": df["price"].round(0),
        f"Expected in {wk(h)} (₹)": df[f"p50_{h}"].round(0), "Change": df[f"p50_{h}"] / df["price"] - 1,
        "Chance of 5%+ rise": df["prob_rise"], "Advice": [f"Hold ~{wk(a.hold_weeks)}" if a.action == "Hold" else a.action for a in adv],
    }).sort_values("Price (₹)", ascending=False)

FMT = {"Change": "{:+.1%}", "Chance of 5%+ rise": "{:.0%}", "Price (₹)": "{:,.0f}"}


def fmt(t: pd.DataFrame, h: int):
    return t.style.format({k: v for k, v in (FMT | {f"Expected in {wk(h)} (₹)": "{:,.0f}"}).items() if k in t.columns})


with tab_cmp:
    h = 1 if crop == "Tomato" else 2
    st.header(f"Where to sell {crop.lower()}?")
    if crop == "Arecanut":   # varieties have very different prices, so compare the same variety only
        variety = market[market.rfind("(") + 1:-1] if "(" in market else ""
        st.caption(f"Showing **{variety}** only — arecanut varieties have very different prices.")
        in_state = in_state[in_state["market"].str.endswith(f"({variety})")]
        by_crop = by_crop[by_crop["market"].str.endswith(f"({variety})")]
    t_state = compare_table(in_state, h)
    best = t_state.iloc[0]
    st.write(f"Highest price in **{state}** this week: **{best['Mandi']}** at **{rs(best['Price (₹)'])}** "
             f"({rs(best['Price (₹)'] - price)} vs {market}). Remember to count transport costs.")
    st.dataframe(fmt(t_state.drop(columns="State"), h), hide_index=True, width="stretch")

    st.subheader(f"{crop} across India")
    recent = by_crop[by_crop["week"] >= by_crop["week"].max() - pd.Timedelta(weeks=2)]
    smed = recent.groupby("state")["price"].median().sort_values()
    fig2 = go.Figure(go.Bar(x=smed.values, y=smed.index, orientation="h", marker_color="#2E7D5B",
                            text=[rs(v) for v in smed.values], textposition="outside"))
    fig2.update_layout(height=max(300, 26 * len(smed)), margin=dict(l=10, r=40, t=30, b=10),
                       title="Median price by state (last 2 weeks of data)", xaxis_title="₹ per quintal")
    st.plotly_chart(fig2, width="stretch")
    st.write("Highest-paying mandis in India right now")
    st.dataframe(fmt(compare_table(recent, h).head(15), h), hide_index=True, width="stretch")

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
    st.subheader("Arecanut and cashew")
    st.write("For **arecanut** (weekly, by mandi and variety) no model beat 'no change' in testing, so FarmStat shows "
             "today's price with the usual range of movement. For **cashew** (monthly, by state) the model only tied "
             "with 'no change' on 2024–2026, so it is shown as a rough guide. The ranges held the real price this often "
             "in testing (cashew's final ranges are wider, calibrated on 2022–2026 errors):")
    cov = {f"Arecanut, {wk(int(h))}": v for h, v in m.get("arecanut", {}).get("range_coverage", {}).items()}
    cov |= {f"Cashew, {h} month{'s' if int(h) > 1 else ''}": v for h, v in m.get("cashew", {}).get("range_coverage", {}).items()}
    if cov:
        st.dataframe(pd.Series(cov).map("{:.0%}".format).rename("Range contained the real price"), width="stretch")
    for img in ["model_comparison.png", "case_studies.png", "rise_classifier.png"]:
        p = ROOT / "figures" / img
        if p.exists():
            st.image(str(p), width="stretch")

# ── About tab ────────────────────────────────────────────────────────────────
with tab_about:
    st.header("About FarmStat")
    st.markdown(
        f"""
**FarmStat** covers {N_MANDIS} mandis across {latest['state'].nunique()} states. It forecasts weekly wholesale
prices of onion, tomato and potato for the next 1, 2 and 4 weeks and turns the forecast into simple sell / hold
advice; it also shows arecanut (Karnataka, Kerala), cashew (by state) and sugarcane (government FRP).

* **Data:** Agmarknet (Government of India) mandi prices and arrivals, 2003–2026, aggregated to weekly.
* **Model:** gradient boosting with quantile loss (a likely range, not just one number) on 38 inputs — recent price
  moves, arrivals, national and state trends and season — plus a classifier for the chance of a 5%+ rise.
* **Arecanut:** shown with today's price and the usual range of movement — no model beat "no change" in testing.
  **Cashew:** monthly state forecasts as a rough guide (only tied with "no change" in testing).
  **Sugarcane:** information on the government FRP, since it is mostly sold to mills.
* **Limits:** no model can foresee government decisions such as export bans, and mandis that started reporting
  recently are harder to forecast. Forecasts are guidance, not a guarantee — always check today's rate before you sell.
"""
    )
