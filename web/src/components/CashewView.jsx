import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import RateBoard from './RateBoard.jsx';
import ForecastTiles from './ForecastTiles.jsx';
import PriceChart, { buildRows } from './PriceChart.jsx';
import { cashewProduct, monthLabel, months, pct, rupees } from '../format.js';
import { T } from '../theme.js';

const STALE_DAYS = 120;   // a state this far behind the newest report is flagged as out of date
const newest = states => states.reduce((a, b) => (a.month > b.month ? a : b)).month;
const isStale = (row, latest) => (new Date(latest) - new Date(row.month)) / 864e5 > STALE_DAYS;

export default function CashewView({ data, state, onState }) {
  const s = data.states.find(x => x.state === state);
  if (!s) return <CashewStart data={data} onState={onState} />;
  const stale = isStale(s, newest(data.states));
  return (
    <>
      <RateBoard title={`Cashew in ${s.state}`} where={s.product === 'raw nuts' ? 'Raw cashew nuts, state average' : 'Cashew kernels (processed), state average'}
        priceLabel={`month of ${monthLabel(s.month)}`} price={s.price}
        advice={{ action: 'Information', headline: 'Treat the forecast as a rough guide',
          detail: 'Cashew only has monthly state averages. In testing the model was about as accurate as assuming no change.' }} />
      {stale && <div className="callout warn"><Info size={16} aria-hidden="true" />{s.state} last reported in {monthLabel(s.month)}, so this price may be out of date.</div>}
      <ForecastTiles items={s.forecast.filter(f => f.h > 0)} now={s.price} naive={false} unitLabel={months} />
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><div><h2>Monthly price in {s.state}</h2>
            <p className="sub">₹ per quintal, with a rough 3-month guide and its likely range.</p></div>
            <div className="legend"><span className="key"><i />Monthly price</span><span className="key"><i className="fc" />Rough guide</span>
              <span className="key"><i className="band" />Likely range</span></div></div>
          <PriceChart rows={buildRows({ history: s.history, forecast: s.forecast, dateKey: 'month' }).rows} period="month"
            horizonLabel="in 3 months" height={300} />
        </section>
        <SeasonPanel season={data.season} />
      </div>
      <section className="panel">
        <div className="panel-head"><div><h2>All states</h2><p className="sub">Latest monthly average reported by each state.</p></div></div>
        <table className="table">
          <thead><tr><th>State</th><th>Product</th><th>Month</th><th className="r">Price</th></tr></thead>
          <tbody>{[...data.states].sort((a, b) => b.price - a.price).map(x => (
            <tr key={x.state} className={x.state === s.state ? 'me' : ''}><td>{x.state}</td><td>{cashewProduct(x.product)}</td>
              <td className="num">{monthLabel(x.month)}</td><td className="r num">{rupees(x.price)}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}

// Before a state is chosen: every state's latest price as a card to pick from, plus the all-states season.
function CashewStart({ data, onState }) {
  const rows = [...data.states].sort((a, b) => b.price - a.price);
  const latest = newest(rows);
  const mixed = new Set(rows.map(r => r.product)).size > 1;
  return (
    <>
      <div className="page-head">
        <h1>Cashew prices by state</h1>
        <p>Monthly state averages from {rows.length} states. Choose a state for its price history and a rough 3-month guide.</p>
      </div>
      <div className="kpis">
        {rows.map(x => (
          <button key={x.state} type="button" className="kpi kpi-button" onClick={() => onState(x.state)}
            aria-label={`${x.state}: ${rupees(x.price)} for ${cashewProduct(x.product).toLowerCase()}, ${monthLabel(x.month)}. Show its prices`}>
            <span className="kpi-label">{x.state}</span>
            <span className="kpi-value num">{rupees(x.price)}</span>
            <span className={`kpi-note${isStale(x, latest) ? ' old' : ''}`}>
              {cashewProduct(x.product)}, {monthLabel(x.month)}{isStale(x, latest) ? ' (out of date)' : ''}</span>
          </button>
        ))}
      </div>
      {mixed && <p className="cashew-note">Kernels are processed cashew and cost several times more than raw nuts, so compare states selling the same product.</p>}
      <SeasonPanel season={data.season} />
    </>
  );
}

// When cashew is usually dear or cheap, across all states (needs no choice, so it also fills the start page).
function SeasonPanel({ season }) {
  const peak = season.reduce((a, b) => (b.pct > a.pct ? b : a));
  const low = season.reduce((a, b) => (b.pct < a.pct ? b : a));
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Seasonal pattern</h2>
        <p className="sub">% above or below the yearly average, all states. Usually highest in {peak.month}, lowest in {low.month}.</p></div></div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={season} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} width={40} />
          <ReferenceLine y={0} stroke={T.context} />
          <Tooltip formatter={v => [pct(v / 100, Number.isInteger(v) ? 0 : 1), 'vs yearly average']} cursor={{ fill: 'rgba(22,24,19,0.05)' }} />
          <Bar dataKey="pct" maxBarSize={22} isAnimationActive={false}>
            {season.map(d => <Cell key={d.month} fill={d.pct >= 0 ? T.forecast : T.drop} radius={d.pct >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
