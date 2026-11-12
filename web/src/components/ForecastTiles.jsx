import SpotlightCard from './reactbits/SpotlightCard.jsx';
import Delta from './Delta.jsx';
import { compactRupees, rupees } from '../format.js';

// One tile per horizon: expected price, change vs now, and a range bar (10th-90th percentile).
function RangeBar({ lo, mid, hi, now, min, max }) {
  const pos = v => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="rangebar" role="img"
      aria-label={`Likely between ${rupees(lo)} and ${rupees(hi)}; today ${rupees(now)}`}>
      <div className="rangebar-track" />
      <div className="rangebar-band" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
      {mid != null && <div className="rangebar-mid" style={{ left: pos(mid) }} />}
      <div className="rangebar-now" style={{ left: pos(now) }} title="Today" />
    </div>
  );
}

export default function ForecastTiles({ items, now, naive, unitLabel }) {
  // shared scale so the three ranges can be compared at a glance
  const min = Math.min(now, ...items.map(i => i.p10)) * 0.98;
  const max = Math.max(now, ...items.map(i => i.p90)) * 1.02;
  return (
    <div className="tiles">
      {items.map(it => (
        <SpotlightCard key={it.h} className="tile" theme="light" spotlightColor="rgba(42,120,214,0.14)"
          intensity={0.5} spotlightSize={220} borderGlow={0.25} flare={false}>
          <div className="tile-label">{naive ? `Usual range in ${unitLabel(it.h)}` : `Expected in ${unitLabel(it.h)}`}</div>
          {naive ? (
            <div className="tile-value num">{compactRupees(it.p10)} – {compactRupees(it.p90)}</div>
          ) : (
            <div className="tile-row">
              <span className="tile-value num">{rupees(it.p50)}</span>
              <Delta value={it.p50 / now - 1} />
            </div>
          )}
          <RangeBar lo={it.p10} mid={naive ? null : it.p50} hi={it.p90} now={now} min={min} max={max} />
          <div className="tile-range num">
            {naive ? 'Range of real moves in the past (8 in 10 weeks)' : `Likely ${rupees(it.p10)} to ${rupees(it.p90)}`}
          </div>
        </SpotlightCard>
      ))}
    </div>
  );
}
