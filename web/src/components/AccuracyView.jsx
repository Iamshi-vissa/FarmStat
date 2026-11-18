import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

const luck = p => (p == null ? '–' : p < 0.001 ? 'under 0.1%' : p < 0.01 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

// Weeks grouped by the rise warning's predicted chance, against how often a 5%+ rise followed.
function Reliability({ rw }) {
  const rows = rw.reliability.map(b => ({ predicted: Math.round(b.predicted * 100), observed: Math.round(b.observed * 100), rows: b.rows }));
  return (
    <section className="panel" aria-labelledby="rel-title">
      <div className="panel-head"><div><h2 id="rel-title">Does a “47% chance of a rise” mean 47%?</h2>
        <p className="sub">Predicted chance of a 5%+ rise in 2 weeks against how often it happened. On the dashed line the
          warning is honest. ROC-AUC {rw.roc_auc.toFixed(2)}; a rise follows {pct0(rw.base_rate)} of weeks on average.</p></div></div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke={T.grid} />
          <XAxis type="number" dataKey="predicted" domain={[0, 80]} ticks={[0, 20, 40, 60, 80]} tickFormatter={v => `${v}%`}
            tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false}
            label={{ value: 'Predicted chance', position: 'insideBottom', offset: -8, fontSize: 12, fill: T.ink3 }} />
          <YAxis domain={[0, 80]} ticks={[0, 20, 40, 60, 80]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: T.ink3 }}
            tickLine={false} axisLine={false} width={44} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 80, y: 80 }]} stroke={T.context} strokeDasharray="4 3" />
          <Tooltip isAnimationActive={false} content={({ active, payload }) => active && payload?.[0] ? (
            <div className="chart-tip"><div className="tip-when">Predicted about {payload[0].payload.predicted}%</div>
              <div className="tip-row"><strong>{payload[0].payload.observed}%</strong><span>actually rose 5%+</span></div>
              <div className="tip-row"><span>{payload[0].payload.rows.toLocaleString('en-IN')} mandi-weeks</span></div></div>) : null} />
          <Line dataKey="observed" stroke={T.forest} strokeWidth={2} dot={{ r: 4, fill: T.forest }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

export default function AccuracyView() {
  const [m, setM] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api('accuracy').then(setM).catch(() => setFailed(true)); }, []);
  if (failed) return <div className="loading" role="alert">Couldn’t load the test results. Reload the page to try again.</div>;
  if (!m) return <div className="loading" role="status">Loading test results…</div>;
  const H = m.horizons;
  const hs = Object.keys(H);
  const two = H['2'] ?? H[hs[0]];
  const calibrated = hs.every(h => H[h].coverage_conformal != null);
  const years = `${m.test_years[0]}–${m.test_years.at(-1)}`;

  return (
    <>
      <div className="page-head">
        <h1>How accurate is it?</h1>
        <p>Every number here comes from {years} data the model never trained on. It was retrained at the start of each year,
          as it would be in real use, and compared with the simplest forecast possible: “next week’s price will be the same
          as this week’s”. Onion, tomato and potato, every mandi.</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">Less error than “no change”</div>
          <div className="stat-value num">{pct0(two.skill_vs_naive)}</div>
          <div className="stat-note">2 weeks ahead</div></div>
        <div className="stat"><div className="stat-label">Direction right, up or down</div>
          <div className="stat-value num">{pct0(two.direction_acc)}</div>
          <div className="stat-note">2 weeks ahead</div></div>
        <div className="stat"><div className="stat-label">Likely range held the real price</div>
          <div className="stat-value num">{pct0(calibrated ? two.coverage_conformal : two.coverage_10_90)}</div>
          <div className="stat-note">target 80%, 2 weeks ahead</div></div>
        {m.backtest.Tomato != null && (
          <div className="stat"><div className="stat-label">Extra earned by following the advice</div>
            <div className="stat-value num">{rupees(m.backtest.Tomato)}</div>
            <div className="stat-note">tomato, per quintal, after storage losses</div></div>
        )}
      </div>

      <section className="panel" aria-labelledby="beat-title">
        <div className="panel-head"><div><h2 id="beat-title">Does it beat “no change”?</h2>
          <p className="sub">Average miss in ₹ per quintal. The interval comes from resampling whole weeks; “chance it’s luck”
            is the Diebold–Mariano test’s p-value, the chance of a gain this size if the model were no better.</p></div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ahead</th><th className="r">FarmStat</th><th className="r">No change</th>
              <th className="ci-head">Less error <span>95% interval, 0 = no gain</span></th>
              <th className="r">Chance it’s luck</th><th className="r">Direction right</th></tr></thead>
            <tbody>{hs.map(h => {
              const r = H[h];
              return (
                <tr key={h}><td className="nw">{weeks(+h)}</td><td className="r num">{rupees(r.MAE_Rs)}</td>
                  <td className="r num">{rupees(r.naive_MAE_Rs)}</td>
                  <td>{r.skill_95ci
                    ? <span className="ci-cell"><Interval v={r.skill_vs_naive} lo={r.skill_95ci[0]} hi={r.skill_95ci[1]} />
                      <span className="num">{pct(r.skill_vs_naive)}</span></span>
                    : <span className="num">{pct(r.skill_vs_naive)}</span>}</td>
                  <td className="r num">{luck(r.p_value)}</td><td className="r num">{pct0(r.direction_acc)}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="note">At 1 and 2 weeks the gain is clear. A chance of luck above 5% means the gain at that horizon could
          still be chance.</p>
      </section>

      <div className="grid-2 even">
        <section className="panel" aria-labelledby="range-title">
          <div className="panel-head"><div><h2 id="range-title">Do the likely ranges hold?</h2>
            <p className="sub">A likely range should contain the real price 80% of the time.{calibrated
              ? ' The model’s own ranges were too narrow further ahead, so the app widens each end by what earlier years’ misses call for (split-conformal calibration).'
              : ''}</p></div></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ahead</th><th className="r">Model’s own</th>{calibrated && <th className="r">Shown in the app</th>}</tr></thead>
            <tbody>
              {hs.map(h => (
                <tr key={h}><td className="nw">{weeks(+h)}</td><td className="r num">{pct0(H[h].coverage_10_90)}</td>
                  {calibrated && <td className="r num"><strong>{pct0(H[h].coverage_conformal)}</strong></td>}</tr>
              ))}
            </tbody>
          </table></div>
          {Object.keys(m.arecanut_coverage).length > 0 && (
            <p className="note">Arecanut: no model beat “no change”, so the app shows today’s price with its usual range, which
              held the real price {Object.values(m.arecanut_coverage).map(pct0).join(', ')} of the time at{' '}
              {Object.keys(m.arecanut_coverage).map(h => weeks(+h)).join(', ')}.</p>
          )}
        </section>

        {m.segments.length > 0 && (
          <section className="panel" aria-labelledby="seg-title">
            <div className="panel-head"><div><h2 id="seg-title">Where it works best</h2>
              <p className="sub">2 weeks ahead. “New” mandis have less than 3 years of price history and are marked in the app.</p></div></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Crop and mandis</th><th>vs “no change”</th><th className="r">Range hit</th></tr></thead>
              <tbody>{m.segments.map(g => (
                <tr key={g.group}><td>{g.group.replace(' / ', ', ')}</td>
                  <td><span className="skill-cell"><SkillBar v={g.skill_vs_naive} /><span className="num">{pct(g.skill_vs_naive)}</span></span></td>
                  <td className="r num">{pct0(g.coverage_10_90)}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
        )}
      </div>

      {(m.rise_warning || m.by_year.length > 0) && (
        <div className="grid-2 even">
          {m.rise_warning && <Reliability rw={m.rise_warning} />}
          {m.by_year.length > 0 && (
            <section className="panel" aria-labelledby="year-title">
              <div className="panel-head"><div><h2 id="year-title">Year by year</h2>
                <p className="sub">2 weeks ahead. Hard years happen: in 2025 hundreds of new mandis joined the data.</p></div></div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Year</th><th>vs “no change”</th><th className="r">Direction right</th></tr></thead>
                <tbody>{m.by_year.map(y => (
                  <tr key={y.group}><td>{y.group}</td>
                    <td><span className="skill-cell"><SkillBar v={y.skill_vs_naive} /><span className="num">{pct(y.skill_vs_naive)}</span></span></td>
                    <td className="r num">{pct0(y.direction_acc)}</td></tr>
                ))}</tbody>
              </table></div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
