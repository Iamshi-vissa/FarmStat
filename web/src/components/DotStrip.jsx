import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compactRupees, placeName, rupees } from '../format.js';
import { niceTicks, quantile } from '../stats.js';
import { T } from '../theme.js';

const R = 5, PAD = { l: 12, r: 12, t: 50, b: 28 };

// Every mandi in the state as a dot on one price axis (a beeswarm, so dots never overlap), with the middle half of
// mandis shaded, the median marked and the chosen mandi highlighted. Hover or focus a dot for its name and price.
export default function DotStrip({ rows, market, onPick }) {
  const wrap = useRef(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const { dots, ticks, x, med, q1, q3, h } = useMemo(() => {
    const ps = rows.map(r => r.price).filter(v => v != null).sort((a, b) => a - b);
    const nt = niceTicks(ps[0], ps[ps.length - 1], w < 500 ? 4 : 6);
    const [d0, d1] = nt.domain;
    const sx = v => PAD.l + ((v - d0) / (d1 - d0 || 1)) * (w - PAD.l - PAD.r);
    // beeswarm: place each dot in the lowest lane where it doesn't touch a neighbour
    const lanes = [];
    const placed = [...rows].filter(r => r.price != null).sort((a, b) => a.price - b.price).map(r => {
      const cx = sx(r.price);
      let lane = 0;
      while ((lanes[lane] ?? -1e9) > cx - 2 * R - 1) lane += 1;
      lanes[lane] = cx;
      return { ...r, cx, lane };
    });
    const nLanes = Math.max(1, lanes.length);
    const height = PAD.t + PAD.b + nLanes * (2 * R + 2) + 8;
    const base = PAD.t + 4;
    return {
      dots: placed.map(d => ({ ...d, cy: base + R + d.lane * (2 * R + 2) })),
      ticks: nt.ticks ?? [], x: sx, h: height,
      med: quantile(ps, 0.5), q1: quantile(ps, 0.25), q3: quantile(ps, 0.75)
    };
  }, [rows, w]);

  const me = dots.find(d => d.market === market);
  const tip = hover ?? null;
  return (
    <div className="dotstrip" ref={wrap}>
      <svg width={w} height={h} role="img"
        aria-label={`Prices across ${dots.length} mandis: median ${rupees(med)}, middle half ${rupees(q1)} to ${rupees(q3)}${me ? `; ${placeName(market)} ${rupees(me.price)}` : ''}`}
        onMouseLeave={() => setHover(null)}>
        <rect x={x(q1)} y={PAD.t - 6} width={Math.max(2, x(q3) - x(q1))} height={h - PAD.t - PAD.b + 6} rx={4} fill={T.forest} opacity={0.08} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD.t - 6} y2={h - PAD.b} stroke={T.grid} />
            <text x={x(t)} y={h - 8} textAnchor="middle" fontSize={12} fill={T.ink3}>{compactRupees(t)}</text>
          </g>
        ))}
        <line x1={x(med)} x2={x(med)} y1={PAD.t - 10} y2={h - PAD.b} stroke={T.ink} strokeWidth={1.5} strokeDasharray="4 3" />
        {me && <line x1={me.cx} x2={me.cx} y1={PAD.t - 30} y2={me.cy - R - 3} stroke={T.forest} strokeWidth={1} />}
        <text x={x(med)} y={PAD.t - 14} textAnchor="middle" fontSize={12} fill={T.ink2}
          style={{ paintOrder: 'stroke' }} stroke={T.panel} strokeWidth={4}>median {compactRupees(med)}</text>
        {dots.map(d => (
          <circle key={d.market} cx={d.cx} cy={d.cy} r={d.market === market ? R + 2 : R}
            fill={d.market === market ? T.forest : T.arrivalsHeavy} fillOpacity={d.market === market ? 1 : 0.55}
            stroke={T.panel} strokeWidth={d.market === market ? 2 : 1} tabIndex={0} style={{ cursor: onPick ? 'pointer' : 'default', outline: 'none' }}
            onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onBlur={() => setHover(null)}
            onClick={() => onPick?.(d.market)}>
            <title>{`${d.market}: ${rupees(d.price)}`}</title>
          </circle>
        ))}
        {me && (
          // the chosen mandi's name gets its own row above the median label, with a thin leader down to its dot,
          // so the two labels never collide however close the prices are
          <g>
            <text x={Math.min(Math.max(me.cx, 90), w - 90)} y={PAD.t - 36} textAnchor="middle" fontSize={12} fontWeight={650}
              fill={T.forest} style={{ paintOrder: 'stroke' }} stroke={T.panel} strokeWidth={4}>{placeName(market)} {compactRupees(me.price)}</text>
          </g>
        )}
      </svg>
      {tip && (
        <div className="chart-tip dot-tip" style={{ left: Math.min(Math.max(tip.cx - 95, 0), w - 200), top: tip.cy + 12 }}>
          <div className="tip-when">{tip.district}</div>
          <div className="tip-row"><strong>{tip.market}</strong><span>{rupees(tip.price)}</span></div>
          {me && tip.market !== market && <div className="tip-row"><span>{tip.price >= me.price ? '+' : '−'}{rupees(Math.abs(tip.price - me.price))} vs {placeName(market)}</span></div>}
        </div>
      )}
    </div>
  );
}
