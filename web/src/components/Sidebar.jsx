import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import Sparkline from './Sparkline.jsx';
import Delta from './Delta.jsx';
import { SideShell } from './Chrome.jsx';
import { monthLabel, placeName, rupees, weeks } from '../format.js';

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'price', label: 'Price' },
  { id: 'change', label: 'Outlook' }
];

export default function Sidebar({ crop, states, state, onState, mandis, market, onMarket, footer, rail, unit = 'mandis' }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const naive = mandis.length > 0 && mandis.every(m => m.naive);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = state ? mandis.filter(m => m.state === state && (!term || `${m.market} ${m.district}`.toLowerCase().includes(term))) : [];
    const by = {
      name: (a, b) => a.market.localeCompare(b.market),
      price: (a, b) => b.price - a.price,
      change: (a, b) => (b.change ?? -9) - (a.change ?? -9)
    }[sort];
    return [...rows].sort(by);
  }, [mandis, q, sort, state]);

  const horizon = mandis[0]?.horizon ?? 2;
  const listRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {   // "/" jumps to the mandi search
    const onKey = e => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || /input|select|textarea/i.test(document.activeElement?.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {   // keep the selected mandi visible in the list
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [market, mandis]);
  return (
    <SideShell label="Choose a mandi" current={placeName(market)} placeholder="Choose a mandi" footer={footer} rail={rail}>
      <div className="side-controls">
        <label className="field">
          <span>State</span>
          <select className="select" value={state ?? ''} onChange={e => { onState(e.target.value || null); e.target.blur(); }}>
            <option value="">Choose a state</option>
            {states.map(s => (
              <option key={s.name} value={s.name}>{s.name} ({s.count} {unit})</option>
            ))}
          </select>
        </label>
        {state && <>
        <div className="search-wrap">
          <Search size={16} aria-hidden="true" />
          <input className="search" type="search" placeholder="Search by mandi or district" ref={searchRef}
            value={q} onChange={e => setQ(e.target.value)} aria-label="Search mandis" aria-keyshortcuts="/"
            onKeyDown={e => { if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && list[0]) onMarket(list[0].market); }} />
          {!q && <kbd aria-hidden="true">/</kbd>}
        </div>
        <div className="sortbar" role="group" aria-label="Sort mandis">
          Sort by
          {SORTS.filter(s => !(naive && s.id === 'change')).map(s => (
            <button key={s.id} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}
              title={s.id === 'change' ? `Expected change in ${weeks(horizon)}` : undefined}>{s.label}</button>
          ))}
          <span className="list-count" aria-live="polite">{list.length} of {mandis.length}</span>
        </div>
        </>}
      </div>
      <nav className="mandi-list" aria-label={`${crop} mandis`} ref={listRef}>
        {!state && (
          <div className="empty pick-state">
            <p>Choose a state to see its {crop.toLowerCase()} {unit}, or pick one here:</p>
            <div className="chips">{[...states].sort((a, b) => b.count - a.count).slice(0, 8).map(s => (
              <button key={s.name} type="button" className="chip" onClick={() => onState(s.name)}>{s.name}<span>{s.count}</span></button>
            ))}</div>
          </div>
        )}
        {state && list.length === 0 && q && <p className="empty">No mandi matches “{q}”. Try a district name.</p>}
        {list.map(m => (
          <button key={m.market} className="mandi-row" aria-current={m.market === market} onClick={() => onMarket(m.market)}>
            <span className="mandi-name">{placeName(m.market)}</span>
            <span className="mandi-price num">{rupees(m.price)}</span>
            <span className="mandi-dist">
              {m.district}
              {m.new_mandi && !m.naive && <span className="badge" title="Less than 3 years of price history">new</span>}
            </span>
            <span className="mandi-meta">
              <Sparkline values={m.spark} />
              {!m.naive && <Delta value={m.change} title={`Expected change in ${weeks(m.horizon)}`} />}
            </span>
          </button>
        ))}
      </nav>
    </SideShell>
  );
}

// Cashew has no mandi-level history: the panel lists states with their latest monthly average.
export function CashewSidebar({ states = [], state, onState, rail }) {
  return (
    <SideShell label="Choose a state" current={state} placeholder="Choose a state" rail={rail}
      footer="Monthly state averages from Agmarknet. No mandi-level cashew history is available.">
      <nav className="mandi-list" aria-label="Cashew states">
        {states.map(s => (
          <button key={s.state} type="button" className="mandi-row" aria-current={s.state === state} onClick={() => onState(s.state)}>
            <span className="mandi-name">{s.state}</span><span className="mandi-price num">{rupees(s.price)}</span>
            <span className="mandi-dist">{s.product}, {monthLabel(s.month)}</span><span />
          </button>
        ))}
      </nav>
    </SideShell>
  );
}

// Sugarcane is sold to mills at a government price, so there is nothing to choose: the panel explains why.
export function SugarcaneSidebar({ rail }) {
  return (
    <SideShell label="About sugarcane prices" placeholder="Sugarcane" rail={rail}
      footer="FRP: Cabinet Committee on Economic Affairs. Mandi prices: Agmarknet.">
      <div className="side-controls side-grow">
        <p className="note">Most sugarcane is sold to sugar mills at the Fair and Remunerative Price (FRP) set by the Government of India,
          so FarmStat shows the FRP instead of a forecast.</p>
      </div>
    </SideShell>
  );
}
