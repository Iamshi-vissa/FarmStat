import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Info, LayoutDashboard, Search, Store } from 'lucide-react';
import { useScrollEnd } from './useScrollEnd.js';
import CropSwitch from './components/CropSwitch.jsx';
import Sidebar from './components/Sidebar.jsx';
import MarketView, { MarketSkeleton, loadMarketChart } from './components/MarketView.jsx';
import { Notice, SideShell, openSidePanel } from './components/Chrome.jsx';
import Tabs from './components/ui/Tabs.jsx';
import SearchButton from './components/SearchAnywhere.jsx';
import { api } from './api.js';
import { date, monthLabel, rupees } from './format.js';

// Views other than the mandi page load on demand, so the first screen only downloads what it needs.
const CompareView = lazy(() => import('./components/CompareView.jsx'));
const AccuracyView = lazy(() => import('./components/AccuracyView.jsx'));
const CashewView = lazy(() => import('./components/CashewView.jsx'));
const SugarcaneView = lazy(() => import('./components/SugarcaneView.jsx'));
const AboutView = lazy(() => import('./components/AboutView.jsx'));
const OverviewView = lazy(() => import('./components/OverviewView.jsx'));

const WEEKLY = ['Onion', 'Tomato', 'Potato', 'Arecanut'];   // crops with a weekly mandi panel (meta confirms)
const readHash = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const Wait = ({ label = 'Loading…' }) => <div className="loading" role="status">{label}</div>;

export default function App() {
  const init = useMemo(readHash, []);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [crop, setCrop] = useState(init.crop || 'Onion');
  const [state, setState] = useState(init.state || null);
  const [market, setMarket] = useState(init.mandi || null);
  // Nothing is chosen for the visitor: the first screen is the crop across India, until they pick a state or mandi.
  const [view, setView] = useState(init.view || (init.mandi ? 'market' : 'overview'));
  const [section, setSection] = useState(init.section || null);   // About page section
  const [mandis, setMandis] = useState([]);
  const [extra, setExtra] = useState({});                          // cashew / sugarcane payloads
  const tabsRef = useRef(null);
  useScrollEnd(tabsRef);

  useEffect(() => {
    api('meta').then(setMeta).catch(e => setError(e.message));
    // start the first screen's data and code alongside meta instead of after it
    if (init.mandi) loadMarketChart();
    else if (WEEKLY.includes(init.crop || 'Onion')) {
      api('overview', { crop: init.crop || 'Onion' }).catch(() => {});
      import('./components/OverviewView.jsx');
    }
    // the chart code is only needed once a mandi is opened: fetch it when the browser is idle
    const idle = window.requestIdleCallback ?? (f => setTimeout(f, 1500));
    idle(() => loadMarketChart());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {   // follow links that only change the #… part of the address
    const onHash = () => {
      const h = readHash();
      if (h.crop) setCrop(h.crop);
      if (h.state) setState(h.state);
      if (h.mandi) setMarket(h.mandi);
      if (h.view) setView(h.view);
      setSection(h.section || null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const cropMeta = useMemo(() => meta?.crops.find(c => c.id === crop), [meta, crop]);

  // when the crop changes, keep the visitor's state only if the new crop has it (never choose one for them)
  useEffect(() => {
    if (!cropMeta) return;
    if (cropMeta.kind === 'weekly') {
      if (state && !cropMeta.states.some(s => s.name === state)) { setState(null); setMarket(null); }
      if (view === 'market' && !market) setView('overview');
    } else {
      const key = crop.toLowerCase();
      if (!extra[key]) api(key).then(d => setExtra(x => ({ ...x, [key]: d })));
      if (crop === 'Cashew' && extra.cashew && state && !extra.cashew.states.some(s => s.state === state)) setState(null);
      if (!['overview', 'accuracy', 'about'].includes(view)) setView('overview');
    }
  }, [cropMeta, crop, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  // load the mandi list for the chosen state (no mandi is picked automatically)
  useEffect(() => {
    if (cropMeta?.kind !== 'weekly' || !state || !cropMeta.states.some(s => s.name === state)) { setMandis([]); return undefined; }
    let live = true;
    api('mandis', { crop, state }).then(rows => {
      if (!live) return;
      setMandis(rows);
      if (market && !rows.some(r => r.market === market)) {   // that mandi doesn't sell this crop: back to the overview
        setMarket(null);
        setView(v => (v === 'market' ? 'overview' : v));
      }
    });
    return () => { live = false; };
  }, [crop, state, cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseState = s => { setState(s); setMarket(null); };
  const chooseMarket = m => { setMarket(m); if (m) setView(v => (v === 'compare' ? v : 'market')); };
  const goOverview = () => { setMarket(null); setView('overview'); };

  useEffect(() => {
    const p = new URLSearchParams({ crop, view, ...(state ? { state } : {}), ...(market && cropMeta?.kind === 'weekly' ? { mandi: market } : {}),
      ...(view === 'about' && section ? { section } : {}) });
    window.history.replaceState(null, '', `#${p}`);
  }, [crop, state, market, view, cropMeta, section]);

  // start each view at the top, unless a link points into the About page
  useEffect(() => { if (!(view === 'about' && section)) window.scrollTo(0, 0); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="loading"><p>Couldn’t reach the FarmStat API: {error}.</p><p>Start it with <code>python -m uvicorn api.main:app</code> and reload.</p></div>;
  if (!meta || !cropMeta) return <Wait label="Loading FarmStat…" />;

  const weekly = cropMeta.kind === 'weekly';
  // only render a mandi once the list for this crop and state has arrived (avoids a mismatched request)
  const ready = weekly && market && mandis.length > 0 && mandis[0].crop === crop && mandis[0].state === state
    && mandis.some(m => m.market === market);
  const tabs = weekly
    ? [['overview', 'India overview'], ['market', 'Mandi'], ['compare', 'Compare mandis'], ['accuracy', 'Model accuracy'], ['about', 'About']]
    : [['overview', crop === 'Cashew' ? 'Prices by state' : 'FRP and prices'], ['accuracy', 'Model accuracy'], ['about', 'About']];

  // the icon rail on the left (desktop): pages, search and the mandi panel, which also opens on hover
  const rail = [
    { id: 'overview', label: weekly ? 'India overview' : 'Overview', icon: <LayoutDashboard size={20} aria-hidden="true" />,
      active: view === 'overview', onClick: goOverview },
    ...(weekly ? [{ id: 'mandis', label: market ? `Mandi: ${market}` : 'Choose a mandi', icon: <Store size={20} aria-hidden="true" />,
      active: view === 'market' || view === 'compare', panel: true, onClick: () => { if (market) setView('market'); } }] : []),
    { id: 'search', label: 'Search all mandis', icon: <Search size={20} aria-hidden="true" />,
      onClick: () => window.dispatchEvent(new Event('farmstat:search')) },
    { id: 'accuracy', label: 'Model accuracy', icon: <Gauge size={20} aria-hidden="true" />, active: view === 'accuracy', onClick: () => setView('accuracy') },
    { id: 'about', label: 'About, terms and risks', icon: <Info size={20} aria-hidden="true" />, active: view === 'about', onClick: () => setView('about') },
  ];

  let side;
  if (weekly) {
    side = <Sidebar crop={crop} states={cropMeta.states} state={state} onState={chooseState} rail={rail}
      mandis={mandis} market={market} onMarket={chooseMarket} unit={crop === 'Arecanut' ? 'mandi-varieties' : 'mandis'}
      footer={<>Prices to the week of {date(cropMeta.data_until)}. Source: Agmarknet, Government of India.</>} />;
  } else if (crop === 'Cashew') {
    side = (
      <SideShell label="Choose a state" current={state} placeholder="Choose a state" rail={rail} footer="Monthly state averages from Agmarknet. No mandi-level cashew history is available.">
        <nav className="mandi-list" aria-label="Cashew states">
          {extra.cashew?.states.map(s => (
            <button key={s.state} className="mandi-row" aria-current={s.state === state} onClick={() => setState(s.state)}>
              <span className="mandi-name">{s.state}</span><span className="mandi-price">{rupees(s.price)}</span>
              <span className="mandi-dist">{s.product}, {monthLabel(s.month)}</span><span />
            </button>
          ))}
        </nav>
      </SideShell>
    );
  } else {
    side = (
      <SideShell label="About sugarcane prices" rail={rail} placeholder="Sugarcane" footer="FRP: Cabinet Committee on Economic Affairs. Mandi prices: Agmarknet.">
        <div className="side-controls"><p className="note" style={{ margin: 0 }}>Most sugarcane is sold to sugar mills at the Fair and
          Remunerative Price (FRP) set by the Government of India, so FarmStat shows the FRP instead of a forecast.</p></div>
        <div style={{ flex: 1 }} />
      </SideShell>
    );
  }

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      {side}
      <main className="main" id="main">
        <div className="topbar">
          <CropSwitch items={meta.crops.map(c => ({ value: c.id, label: c.id }))} value={crop} onChange={setCrop} />
          <Tabs items={tabs.map(([value, label]) => ({ value, label }))} value={view} onChange={setView} label="View"
            className="tabs" tabRef={tabsRef} />
          <SearchButton crops={meta.crops} onPick={pick => {
            if (pick.crop) { setCrop(pick.crop); setState(pick.state ?? null); setMarket(pick.market ?? null); }
            setView(pick.view);
          }} />
        </div>
        <Notice />
        <Suspense fallback={view === 'market' || view === 'overview' ? <MarketSkeleton label="Loading" /> : <Wait />}>
          {view === 'about' && <AboutView meta={meta} section={section} onSection={setSection} />}
          {view === 'accuracy' && <AccuracyView />}
          {weekly && view === 'overview' && <OverviewView crop={crop} onState={chooseState}
            onPick={(s, m) => { setState(s); setMarket(m); setView('market'); }} />}
          {weekly && view === 'market' && !market && <ChooseFirst what="mandi" crop={crop} state={state} />}
          {weekly && view === 'compare' && !state && <ChooseFirst what="state" crop={crop} states={cropMeta.states} onState={chooseState} />}
          {weekly && market && !ready && view === 'market' && <MarketSkeleton label={`Loading ${market}`} />}
          {weekly && state && mandis[0]?.state !== state && view === 'compare' && <Wait label={`Loading ${crop.toLowerCase()} mandis…`} />}
          {ready && view === 'market' && <MarketView crop={crop} state={state} market={market} meta={meta} />}
          {weekly && state && mandis.length > 0 && mandis[0].crop === crop && mandis[0].state === state && view === 'compare' &&
            <CompareView crop={crop} state={state} market={market} mandis={mandis} onMarket={chooseMarket} />}
          {crop === 'Cashew' && view === 'overview' && (extra.cashew ? <CashewView data={extra.cashew} state={state} onState={setState} /> : <MarketSkeleton label="Loading cashew prices" />)}
          {crop === 'Sugarcane' && view === 'overview' && (extra.sugarcane ? <SugarcaneView data={extra.sugarcane} /> : <MarketSkeleton label="Loading" />)}
        </Suspense>
      </main>
    </div>
  );
}

// Shown when a page needs a choice the visitor hasn't made yet. Nothing is picked for them.
function ChooseFirst({ what, crop, state, states = [], onState }) {
  return (
    <section className="panel choose-first">
      <h2>{what === 'mandi' ? `Choose a ${crop.toLowerCase()} mandi` : 'Choose a state to compare its mandis'}</h2>
      <p className="sub">{what === 'mandi'
        ? (state ? `Pick one of the ${state} mandis from the list on the left, or search all of India.`
          : 'Choose a state and a mandi from the panel on the left, or search all of India.')
        : 'Each state’s mandis are compared on their latest weekly price.'}</p>
      {what === 'state' && (
        <div className="chips">{[...states].sort((a, b) => b.count - a.count).map(s => (
          <button key={s.name} type="button" className="chip" onClick={() => onState(s.name)}>{s.name}<span>{s.count}</span></button>
        ))}</div>
      )}
      {what === 'mandi' && (
        <div className="choose-actions">
          <button type="button" className="btn primary" onClick={openSidePanel}>Open the mandi list</button>
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('farmstat:search'))}>Search all mandis</button>
        </div>
      )}
    </section>
  );
}
