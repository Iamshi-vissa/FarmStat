import { useEffect, useState } from 'react';
import CountUp from './reactbits/CountUp.jsx';
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

export default function AccuracyView() {
  const [m, setM] = useState(null);
  useEffect(() => { api('accuracy').then(setM); }, []);
  if (!m) return <div className="loading">Loading test results…</div>;
  const H = m.horizons;
  const seg = Object.entries(m.by_crop_and_mandi_type_2w);
  const [from, to] = m.test_period.split(' to ');

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
