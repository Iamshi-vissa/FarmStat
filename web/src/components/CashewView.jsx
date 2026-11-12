import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import RateBoard from './RateBoard.jsx';
import ForecastTiles from './ForecastTiles.jsx';
import PriceChart, { buildRows } from './PriceChart.jsx';
import { monthLabel, months, rupees } from '../format.js';
import { T } from '../theme.js';

export default function CashewView({ data, state }) {
  const s = data.states.find(x => x.state === state) ?? data.states[0];
  const stale = (new Date(data.states.reduce((a, b) => (a.month > b.month ? a : b)).month) - new Date(s.month)) / 864e5 > 120;
  const peak = data.season.reduce((a, b) => (b.pct > a.pct ? b : a));
  const low = data.season.reduce((a, b) => (b.pct < a.pct ? b : a));
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
        <section className="panel">
          <div className="panel-head"><div><h2>Seasonal pattern</h2>
            <p className="sub">% above or below the yearly average, all states. Usually highest in {peak.month}, lowest in {low.month}.</p></div></div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.season} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={4}>
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: T.ink3 }} tickLine={false} axisLine={false} width={40} />
              <ReferenceLine y={0} stroke={T.context} />
              <Tooltip formatter={v => [`${v > 0 ? '+' : ''}${v}%`, 'vs yearly average']} cursor={{ fill: 'rgba(22,24,19,0.05)' }} />
              <Bar dataKey="pct" maxBarSize={22} isAnimationActive={false}>
                {data.season.map(d => <Cell key={d.month} fill={d.pct >= 0 ? T.forecast : T.drop} radius={d.pct >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head"><div><h2>All states</h2><p className="sub">Latest monthly average reported by each state.</p></div></div>
        <table className="table">
          <thead><tr><th>State</th><th>Product</th><th>Month</th><th className="r">Price</th></tr></thead>
          <tbody>{[...data.states].sort((a, b) => b.price - a.price).map(x => (
            <tr key={x.state} className={x.state === s.state ? 'me' : ''}><td>{x.state}</td><td>{x.product}</td>
              <td className="num">{monthLabel(x.month)}</td><td className="r num">{rupees(x.price)}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
