import { Suspense, lazy, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import RateBoard, { Price, RangeBar, Verdict, priceWeek } from './RateBoard.jsx';
import Delta from './Delta.jsx';
import { api } from '../api.js';
import { compactRupees, placeName, rupees, weeks } from '../format.js';

// The chart (and the charting library) loads in parallel, so the rate board shows first.
export const loadMarketChart = () => import('./MarketChart.jsx');
const MarketChart = lazy(loadMarketChart);

export default function MarketView({ crop, state, market, meta }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api('series', { crop, state, market, weeks: 260 }).then(d => live && setData(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [crop, state, market]);

  if (error) return <div className="empty">Couldn’t load {placeName(market)}: {error}</div>;
  // first load shows a skeleton; switching mandis keeps the board in place and updates it when the data arrives
  if (!data) return <MarketSkeleton label={`Loading ${placeName(market)}`} />;
  const switching = data.latest.market !== market;

  const L = data.latest;
  const naive = L.naive;
  const ahead = data.forecast.filter(f => f.h > 0);
  // one scale for every range bar, so the three horizons can be compared at a glance
  const min = Math.min(L.price, ...ahead.map(f => f.p10)) * 0.98;
  const max = Math.max(L.price, ...ahead.map(f => f.p90)) * 1.02;
  const cells = [
    { key: 'now', label: 'This week', value: <Price v={L.price} />, valueLabel: `${rupees(L.price)} per quintal`,
      sub: <>{priceWeek(L.week)}{L.live && <span className="live-chip" title="This week's price comes from the live daily feed"><i aria-hidden="true" />Live</span>}</>,
      note: 'Modal price, ₹ per quintal' },
    ...ahead.map(f => naive ? {
      key: f.h, label: <>Usual range in {weeks(f.h)}</>, range: true,
      value: `${compactRupees(f.p10)}–${compactRupees(f.p90)}`, valueLabel: `${rupees(f.p10)} to ${rupees(f.p90)}`,
      extra: <RangeBar lo={f.p10} hi={f.p90} now={L.price} min={min} max={max} />,
      note: 'How far prices moved in 8 of 10 past weeks',
    } : {
      key: f.h, label: <>In {weeks(f.h)}</>, value: rupees(f.p50),
      sub: <Delta value={f.p50 / L.price - 1} title="Change from this week" />,
      extra: <RangeBar lo={f.p10} mid={f.p50} hi={f.p90} now={L.price} min={min} max={max} />,
      note: <><span className="wide-only">Likely {rupees(f.p10)} to {rupees(f.p90)}</span>
        <span className="narrow-only">{compactRupees(f.p10)}–{compactRupees(f.p90)}</span></>,
    }),
  ];
  const word = L.advice === 'Hold' && L.hold_weeks ? `Hold for ${weeks(L.hold_weeks)}` : L.advice;

  return (
    <div className={`page${switching ? ' is-switching' : ''}`} aria-busy={switching}>
      <RateBoard title={placeName(L.market)} where={[`${L.district}, ${L.state ?? state}`, `${crop}`]} cells={cells}
        verdict={<Verdict action={L.advice} word={word} headline={L.advice_headline} detail={L.advice_detail} chance={L.prob_rise}
          chanceLabel={naive ? 'Past weeks followed by a 5%+ rise in 2 weeks' : 'Chance of a 5%+ rise in 2 weeks'}
          footnote={L.new_mandi && !naive ? 'New mandi: less history, less certain.' : undefined} />} />

      {L.new_mandi && !naive && (
        <div className="callout warn" role="note"><Info size={16} aria-hidden="true" />
          This mandi has less than 3 years of price history, so its forecast is kept close to today’s price and is less reliable.
        </div>
      )}

      <Suspense fallback={<div className="sk chart-sk" />}>
        <MarketChart crop={crop} state={state} market={L.market} data={data} maxHold={meta.max_hold_weeks?.[crop]} />
      </Suspense>
    </div>
  );
}

export function MarketSkeleton({ label }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <div className="sk board-sk" />
      <div className="sk-row"><div className="sk" /><div className="sk" /><div className="sk" /></div>
      <div className="sk chart-sk" />
    </div>
  );
}
