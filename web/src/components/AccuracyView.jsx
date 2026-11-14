import { useEffect, useState } from 'react';
import CountUp from './CountUp.jsx';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { T } from '../theme.js';
import { api } from '../api.js';
import { pct, pct0, rupees, weeks } from '../format.js';

// Skill bar: blue to the right when better than "no change", rust to the left when worse.
function SkillBar({ v, scale = 0.15 }) {
  const w = `${Math.min(100, (Math.abs(v) / scale) * 100)}%`;
  return (
    <span className="skill" role="img" aria-label={`${pct(v)} vs no change`}>
      <span className="skill-half">{v < 0 && <span className="neg" style={{ width: w }} />}</span>
      <span className="skill-half">{v > 0 && <span className="pos" style={{ width: w }} />}</span>
    </span>
  );
}


// Skill with its 95% interval on one shared scale: the dot is the estimate, the whisker the interval, 0 = "no change".
function Interval({ v, lo, hi, min = -0.05, max = 0.15 }) {
  const x = t => `${((Math.max(min, Math.min(max, t)) - min) / (max - min)) * 100}%`;
  return (
    <svg className="ci" viewBox="0 0 100 14" preserveAspectRatio="none" role="img"
      aria-label={`${pct(v)}, 95% interval ${pct(lo)} to ${pct(hi)}`}>
      <line x1={x(0)} x2={x(0)} y1="0" y2="14" stroke={T.context} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={x(lo)} x2={x(hi)} y1="7" y2="7" stroke={T.forest} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={x(v)} cy="7" r="3.2" fill={T.forest} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const luck = p => (p < 0.001 ? 'under 0.1%' : p < 0.01 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

// Independent check from scripts/evaluate.py: is the gain real, are the ranges honest, does the rise warning mean what it says?
function Validation({ v }) {
  const H = v.horizons;
  const rel = v.rise_warning.reliability.map(b => ({ predicted: Math.round(b.predicted * 100), observed: Math.round(b.observed * 100), rows: b.rows }));
  const rw = v.rise_warning;
  return (
    <>
      <div className="page-head sub-head">
        <h2>Checked independently</h2>
        <p>A separate script re-ran the whole yearly test from scratch and asked three questions a sceptic would ask.
          Years {v.test_years[0]}–{v.test_years.at(-1)}, onion, tomato and potato, every mandi.</p>
      </div>
      <div className="grid-2">
        <section className="panel" aria-labelledby="real-title">
          <div className="panel-head"><div><h2 id="real-title">Is the gain real, or luck?</h2>
            <p className="sub">Less error than “no change”, with a 95% interval from resampling whole weeks. The
              Diebold–Mariano test gives the chance a gain this size appears when the model is no better.</p></div></div>
          <table className="table">
            <thead><tr><th>Ahead</th><th className="r">Less error</th><th className="ci-head">95% interval <span>0 = no gain</span></th><th className="r">Chance it’s luck</th></tr></thead>
            <tbody>{Object.entries(H).map(([h, r]) => (
              <tr key={h}><td className="nw">{weeks(+h)}</td><td className="r num">{pct(r.skill_vs_naive)}</td>
                <td><span className="ci-cell"><Interval v={r.skill_vs_naive} lo={r.skill_95ci[0]} hi={r.skill_95ci[1]} />
                  <span className="num">{pct(r.skill_95ci[0])} to {pct(r.skill_95ci[1])}</span></span></td>
                <td className="r num">{luck(r.diebold_mariano.p_value)}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section className="panel" aria-labelledby="cal-title">
          <div className="panel-head"><div><h2 id="cal-title">Are the ranges honest?</h2>
            <p className="sub">A 10th–90th percentile range should hold the real price 80% of the time. Moving each end of the
              range by what earlier years’ misses call for (split-conformal calibration) brings it back to about 80%; the app
              shows these calibrated ranges.</p></div></div>
          <table className="table">
            <thead><tr><th>Ahead</th><th className="r">Model range</th><th className="r">Recalibrated</th><th className="r">Missed low / high</th></tr></thead>
            <tbody>{Object.entries(H).map(([h, r]) => (
              <tr key={h}><td className="nw">{weeks(+h)}</td><td className="r num">{pct0(r.coverage_10_90)}</td>
                <td className="r num"><strong>{pct0(r.coverage_10_90_conformal)}</strong></td>
                <td className="r num">{pct0(r.quantile_coverage.below_q10)} / {pct0(1 - r.quantile_coverage.below_q90)}</td></tr>
            ))}</tbody>
          </table>
          <p className="note">Each end should miss about 10% of the time. Real prices fall below the low end too often, most of all at 4 weeks: the model underrates falls.</p>
        </section>
      </div>
      <section className="panel" aria-labelledby="rel-title">
        <div className="panel-head"><div><h2 id="rel-title">Does “47% chance of a rise” mean 47%?</h2>
          <p className="sub">Weeks grouped by the warning’s predicted chance of a 5%+ rise in 2 weeks, against how often it
            happened. On the dashed line the warning is honest. ROC-AUC {rw.roc_auc.toFixed(2)}; Brier score {rw.brier.toFixed(3)} vs{' '}
            {rw.brier_base_rate.toFixed(3)} for always saying the base rate ({pct0(rw.base_rate)}).</p></div>
          <div className="legend"><span className="key"><i style={{ background: T.forest }} />Observed</span><span className="key"><i className="ctx" />Perfectly honest</span></div></div>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={rel} margin={{ top: 12, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid stroke={T.grid} />
            <XAxis type="number" dataKey="predicted" domain={[0, 80]} ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80]} tickFormatter={v => `${v}%`}
              tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false}
              label={{ value: 'Predicted chance', position: 'insideBottom', offset: -8, fontSize: 12, fill: T.ink3 }} />
            <YAxis domain={[0, 70]} ticks={[0, 20, 40, 60]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: T.ink3 }}
              tickLine={false} axisLine={false} width={44} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 70, y: 70 }]} ifOverflow="extendDomain" stroke={T.context} strokeDasharray="4 3" />
            <Tooltip isAnimationActive={false} content={({ active, payload }) => active && payload?.[0] ? (
              <div className="chart-tip"><div className="tip-when">Predicted about {payload[0].payload.predicted}%</div>
                <div className="tip-row"><strong>{payload[0].payload.observed}%</strong><span>actually rose 5%+</span></div>
                <div className="tip-row"><span>{payload[0].payload.rows.toLocaleString('en-IN')} mandi-weeks</span></div></div>) : null} />
            <Line dataKey="observed" stroke={T.forest} strokeWidth={2} dot={{ r: 4, fill: T.forest }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </>
  );
}

export default function AccuracyView() {
  const [m, setM] = useState(null);
  useEffect(() => { api('accuracy').then(setM); }, []);
  if (!m) return <div className="loading">Loading test results…</div>;
  const H = m.horizons;
  const seg = Object.entries(m.by_crop_and_mandi_type_2w);
  const [from, to] = m.test_period.split(' to ');
  const errRows = Object.entries(H).map(([h, r]) => ({ label: weeks(+h), model: Math.round(r.MAE_Rs),
    naive: Math.round(r.MAE_Rs / (1 - r.skill_vs_naive)), skill: r.skill_vs_naive }));
  const covRows = [
    ...Object.entries(H).map(([h, r]) => ({ label: `${weeks(+h)}`, hit: Math.round(r.coverage_10_90 * 100) })),
    ...Object.entries(m.arecanut.range_coverage).map(([h, v]) => ({ label: `Arecanut ${weeks(+h)}`, hit: Math.round(v * 100), crop: true }))
  ];

  return (
    <>
      <div className="page-head">
        <h1>How accurate is it?</h1>
        <p>Every number here comes from {from.slice(0, 4)}–{to.slice(0, 4)} data the model never trained on. It was re-trained at
          the start of each year, as it would be in real use. The benchmark is the simplest forecast possible: “next week’s price
          will be the same as today’s”.</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">Lower error than “no change”, 2 weeks ahead</div>
          <div className="stat-value num"><CountUp to={H['2'].skill_vs_naive * 100} decimals={1} suffix="%" duration={1.2} /></div>
          <div className="stat-note">onion, tomato and potato, all mandis</div></div>
        <div className="stat"><div className="stat-label">Direction right (up or down)</div>
          <div className="stat-value num"><CountUp to={H['2'].direction_acc * 100} decimals={0} suffix="%" duration={1.2} /></div>
          <div className="stat-note">when the price moved more than 2%</div></div>
        <div className="stat"><div className="stat-label">Rise warning quality (ROC-AUC)</div>
          <div className="stat-value num"><CountUp to={m.rise_classifier.ROC_AUC} decimals={2} duration={1.2} /></div>
          <div className="stat-note">0.5 = guessing, 1.0 = perfect</div></div>
        <div className="stat"><div className="stat-label">Extra earned by following advice</div>
          <div className="stat-value num"><CountUp to={m.backtest_extra_Rs_per_quintal.Tomato} prefix="₹" decimals={0} duration={1.2} /></div>
          <div className="stat-note">tomato, per quintal, after storage losses</div></div>
      </div>

      <div className="grid-2 even">
        <section className="panel" aria-labelledby="err-title">
          <div className="panel-head"><div><h2 id="err-title">Error vs “no change”</h2>
            <p className="sub">Average miss in ₹ per quintal. Shorter blue bars than grey mean the model beat the benchmark.</p></div>
            <div className="legend"><span className="key"><i className="sq fc" />FarmStat</span><span className="key"><i className="sq ctx" />No change</span></div></div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={errRows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barGap={4} barCategoryGap="28%">
              <CartesianGrid stroke={T.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} width={48} tickFormatter={v => `₹${v}`} />
              <Tooltip cursor={{ fill: 'rgba(22,24,19,0.05)' }} isAnimationActive={false}
                content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip"><div className="tip-when">{payload[0].payload.label} ahead</div>
                    <div className="tip-row"><strong>{rupees(payload[0].payload.model)}</strong><span>FarmStat</span></div>
                    <div className="tip-row"><strong>{rupees(payload[0].payload.naive)}</strong><span>no change</span></div>
                    <div className="tip-row"><span>{pct(payload[0].payload.skill)} less error</span></div></div>) : null} />
              <Bar dataKey="naive" fill={T.context} radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false} />
              <Bar dataKey="model" fill={T.forecast} radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                <LabelList dataKey="skill" position="top" formatter={v => `−${(v * 100).toFixed(0)}%`} style={{ fontSize: 12, fontWeight: 600, fill: T.ink }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel" aria-labelledby="cov-title">
          <div className="panel-head"><div><h2 id="cov-title">Does the likely range hold?</h2>
            <p className="sub">Share of weeks the real price landed inside the model’s raw range. The aim is 80%; the app widens each range to reach it (see “Are the ranges honest?” below).</p></div>
            <div className="legend"><span className="key"><i className="sq fs" />Onion, tomato, potato</span><span className="key"><i className="sq ar" />Arecanut</span></div></div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={covRows} layout="vertical" margin={{ top: 22, right: 48, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid stroke={T.grid} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={{ fontSize: 12, fill: T.ink3 }}
                tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 12, fill: T.ink2 }} tickLine={false} axisLine={false} />
              <ReferenceLine x={80} stroke={T.ink} strokeWidth={1.5} strokeDasharray="4 3"
                label={{ value: 'target 80%', position: 'top', fontSize: 12, fill: T.ink2 }} />
              <Tooltip cursor={{ fill: 'rgba(22,24,19,0.05)' }} isAnimationActive={false}
                content={({ active, payload }) => active && payload?.[0] ? (
                  <div className="chart-tip"><div className="tip-when">{payload[0].payload.label} ahead</div>
                    <div className="tip-row"><strong>{payload[0].value}%</strong><span>of weeks inside the range</span></div>
                    <div className="tip-row"><span>{payload[0].value >= 80 ? 'on target' : `${80 - payload[0].value} points short of 80%`}</span></div></div>) : null} />
              <Bar dataKey="hit" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive={false}>
                {covRows.map(r => <Cell key={r.label} fill={r.crop ? T.forestLight : T.forest} />)}
                <LabelList dataKey="hit" content={({ x, y, width, height, value, index }) => (
                  <text x={x + width - 8} y={y + height / 2} dy="0.35em" textAnchor="end" fontSize={12} fontWeight={650}
                    fill={covRows[index]?.crop ? T.ink : '#fff'}>{value}%</text>)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><div><h2>By forecast horizon</h2>
            <p className="sub">Average error and how often the likely range contained the real price (target: 80%).</p></div></div>
          <table className="table">
            <thead><tr><th>Horizon</th><th className="r">Avg error</th><th className="r">% error</th><th>vs “no change”</th><th className="r">Range hit</th></tr></thead>
            <tbody>{Object.entries(H).map(([h, r]) => (
              <tr key={h}><td>{weeks(+h)}</td><td className="r num">{rupees(r.MAE_Rs)}</td><td className="r num">{pct0(r.MAPE)}</td>
                <td><span className="skill-cell"><SkillBar v={r.skill_vs_naive} /><span className="num">{pct(r.skill_vs_naive)}</span></span></td>
                <td className="r num">{pct0(r.coverage_10_90)}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>By crop and mandi type</h2>
            <p className="sub">2 weeks ahead. “New” mandis started reporting in 2020 or later.</p></div></div>
          <table className="table">
            <thead><tr><th>Crop</th><th>Mandis</th><th>vs “no change”</th></tr></thead>
            <tbody>{seg.map(([k, v]) => {
              const [crop, type] = k.split(' / ');
              return (<tr key={k}><td>{crop}</td><td>{type.startsWith('new') ? 'New' : 'Established'}</td>
                <td><span className="skill-cell"><SkillBar v={v} /><span className="num">{pct(v)}</span></span></td></tr>);
            })}</tbody>
          </table>
        </section>
      </div>

      {m.validation && <Validation v={m.validation} />}

      <section className="panel">
        <div className="panel-head"><div><h2>Arecanut and cashew</h2>
          <p className="sub">Knowing when a model doesn’t help is part of the result.</p></div></div>
        <table className="table">
          <thead><tr><th>Crop</th><th>What testing showed</th><th>What FarmStat shows</th><th className="r">Range hit</th></tr></thead>
          <tbody>
            <tr><td>Arecanut</td><td>No model beat “no change” at 1, 2 or 4 weeks</td><td>Today’s price with the usual range</td>
              <td className="r num">{Object.values(m.arecanut.range_coverage).map(pct0).join(' / ')}</td></tr>
            <tr><td>Cashew</td><td>Gradient boosting roughly tied with “no change” on monthly state prices</td><td>A rough guide with a range</td>
              <td className="r num">{Object.values(m.cashew.range_coverage).map(pct0).join(' / ')}</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
