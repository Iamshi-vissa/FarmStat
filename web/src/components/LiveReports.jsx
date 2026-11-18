import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import Delta from './Delta.jsx';
import { api } from '../api.js';
import { compactRupees, date, placeName, rupees } from '../format.js';

const DAY = 864e5;

// The mandi's latest daily report from the live feed (Agmarknet via data.gov.in, stored in Supabase three times a
// day): the modal price, that day's lowest-to-highest spread, and the change since the previous report.
export default function LiveReports({ crop, state, market }) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    let on = true;
    setLive(null);
    api('live', { crop, state, market }).then(d => on && setLive(d))
      .catch(() => on && setLive({ available: false, reason: 'live feed unreachable' }));
    return () => { on = false; };
  }, [crop, state, market]);

  if (!live) return null;
  if (!live.available) {
    return (
      <p className="live-note"><Radio size={14} aria-hidden="true" />
        <span>{/unreachable/.test(live.reason ?? '')
          ? 'The live daily feed couldn’t be reached just now, so this page shows the weekly data only.'
          : `No daily reports from ${placeName(market)} in the live feed yet. FarmStat checks data.gov.in three times a day.`}</span></p>
    );
  }
  const days = live.days.map(d => ({ ...d, range: d.min != null && d.max != null ? [d.min, d.max] : null }));
  const L = days[days.length - 1];
  const prev = days.length > 1 ? days[days.length - 2] : null;
  const spread = L.range ? (L.range[1] - L.range[0]) / L.modal : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageDays = Math.round((today - new Date(`${L.date}T00:00:00`)) / DAY);   // calendar days, local time

  return (
    <section className="panel live-panel" aria-labelledby="live-title">
      <div className="panel-head"><div>
        <h2 id="live-title"><span className="live-dot" aria-hidden="true" />Latest daily report</h2>
        <p className="sub">Live from Agmarknet (data.gov.in), checked three times a day. The weekly forecast is rebuilt from
          these reports every evening.</p>
      </div></div>
      <div className="mini-stats">
        <div className="mini">
          <div className="mini-label">Latest report</div>
          <div className="mini-value">{rupees(L.modal)}</div>
          <div className="mini-note">{date(L.date)}{ageDays <= 0 ? ', today' : ageDays === 1 ? ', yesterday' : `, ${ageDays} days ago`}</div>
        </div>
        <div className="mini">
          <div className="mini-label">That day’s spread</div>
          <div className="mini-value">{L.range ? `${compactRupees(L.range[0])} – ${compactRupees(L.range[1])}` : '–'}</div>
          <div className="mini-note">{spread != null ? `Lowest to highest lot: ${Math.round(spread * 100)}% of the modal price` : 'Only one price reported'}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Since the previous report</div>
          <div className="mini-value">{prev ? <Delta value={L.modal / prev.modal - 1} big /> : '–'}</div>
          <div className="mini-note">{prev ? `${rupees(prev.modal)} on ${date(prev.date)}` : 'First live report'}
            {L.varieties > 1 ? `. Median of ${L.varieties} varieties or grades` : ''}</div>
        </div>
      </div>
    </section>
  );
}
