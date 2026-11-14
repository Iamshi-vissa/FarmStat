import { Suspense, lazy, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import RateBoard, { priceWeek } from './RateBoard.jsx';
import ForecastTiles from './ForecastTiles.jsx';
import { api } from '../api.js';
import { placeName, weeks } from '../format.js';

// The chart (and the charting library) loads in parallel, so the price board and forecasts show first.
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
  return (
    <div className={`page${switching ? ' is-switching' : ''}`} aria-busy={switching}>
      <RateBoard title={placeName(L.market)} where={`${L.district}, ${L.state ?? state}`} priceLabel={priceWeek(L.week)} price={L.price} live={L.live}
        slipKey={`${crop}|${L.market}`}
        advice={{ action: L.advice, headline: L.advice_headline, detail: L.advice_detail, chance: L.prob_rise,
          chanceLabel: naive ? 'Past weeks followed by a 5%+ rise in 2 weeks' : 'Chance of a 5%+ rise in 2 weeks',
          footnote: L.new_mandi && !naive ? 'New mandi: less history, less certain.' : undefined }} />

      <ForecastTiles items={data.forecast.filter(f => f.h > 0)} now={L.price} naive={naive} unitLabel={weeks} />

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
