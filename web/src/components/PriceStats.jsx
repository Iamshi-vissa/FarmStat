import { useMemo } from 'react';
import Delta from './Delta.jsx';
import { priceStats } from '../stats.js';
import { compactRupees, pct, pct0, placeName, rupees } from '../format.js';

// How this week compares for one mandi: where today's price sits in the past year, the change from a year ago, how much
// prices usually move, and what happened in the same weeks of earlier years.
export default function PriceStats({ crop, market, data }) {
  const L = data.latest;
  const s = useMemo(() => priceStats(data.history, L.week, L.price), [data, L.week, L.price]);
  if (!s) return null;
  const pos = s.hi > s.lo ? (L.price - s.lo) / (s.hi - s.lo) : 0.5;

  return (
    <section className="panel" aria-labelledby="stats-title">
      <div className="panel-head"><div>
        <h2 id="stats-title">How this week compares</h2>
        <p className="sub">This week’s {crop.toLowerCase()} price at {placeName(market)} against its own history.</p>
      </div></div>

      <div className="mini-stats">
        <div className="mini">
          <div className="mini-label">52-week range</div>
          <div className="mini-value">{compactRupees(s.lo)} – {compactRupees(s.hi)}</div>
          <div className="range52" role="img" aria-label={`Today ${rupees(L.price)}, ${pct0(pos)} of the way from low to high`}>
            <span className="range52-track" /><span className="range52-dot" style={{ left: `${pos * 100}%` }} />
          </div>
          <div className="mini-note">Higher than {pct0(s.rank)} of the past year’s weeks</div>
        </div>
        <div className="mini">
          <div className="mini-label">vs same week last year</div>
          <div className="mini-value">{s.yoy == null ? '–' : <Delta value={s.yoy} big />}</div>
          <div className="mini-note">{s.yearAgo ? `It was ${rupees(s.yearAgo)} a year ago` : 'No report a year ago'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Typical weekly move</div>
          <div className="mini-value">{s.typicalMove == null ? '–' : `±${(s.typicalMove * 100).toFixed(1)}%`}</div>
          <div className="mini-note">Median change from one week to the next, last 6 months</div>
        </div>
        <div className="mini">
          <div className="mini-label">Same 4 weeks in past years</div>
          <div className="mini-value">{s.seasonal4w ? <Delta value={s.seasonal4w.median} big /> : '–'}</div>
          <div className="mini-note">{s.seasonal4w
            ? `Median of ${s.seasonal4w.years.length} years; from ${pct(s.seasonal4w.min, 0)} to ${pct(s.seasonal4w.max, 0)}`
            : 'Needs at least 2 earlier years'}</div>
        </div>
      </div>

    </section>
  );
}
