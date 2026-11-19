import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Store } from 'lucide-react';
import CropSwitch from './components/CropSwitch.jsx';
import Sidebar from './components/Sidebar.jsx';
import MarketView, { MarketSkeleton, loadMarketChart } from './components/MarketView.jsx';
import { Brand, Notice } from './components/Chrome.jsx';
import HomeView from './components/HomeView.jsx';
import ClickSpark from './components/reactbits/ClickSpark.jsx';
import { T } from './theme.js';
import Tabs from './components/ui/Tabs.jsx';
import SearchButton from './components/SearchAnywhere.jsx';
import { api } from './api.js';
import { openSearch, openSidePanel } from './events.js';
import { date, placeName } from './format.js';
import { useScrollEnd } from './hooks.js';

// Pages other than the mandi page load on demand, so the first screen only downloads what it needs.
const CompareView = lazy(() => import('./components/CompareView.jsx'));
const AccuracyView = lazy(() => import('./components/AccuracyView.jsx'));
const AboutView = lazy(() => import('./components/AboutView.jsx'));
const loadOverview = () => import('./components/OverviewView.jsx');
const OverviewView = lazy(loadOverview);

const VIEWS = ['home', 'overview', 'market', 'compare', 'accuracy', 'about'];
const NEEDS_CROP = ['overview', 'market', 'compare'];   // pages about one crop; without a crop they show the home page
// Pages in the top bar. The mandi page has no tab: a mandi is opened from the list, search, a table or a ranking.
const TABS = [['home', 'All crops'], ['overview', 'India overview'], ['compare', 'Compare mandis'], ['accuracy', 'Model accuracy'], ['about', 'About']];
const viewFor = h => (VIEWS.includes(h.view) ? h.view : h.mandi ? 'market' : h.crop ? 'overview' : 'home');
const readHash = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const Wait = ({ label = 'Loading…' }) => <div className="loading" role="status">{label}</div>;
const SPARKS = [T.forecast, T.forest];   // marigold and mandi green

export default function App() {
  const init = useMemo(readHash, []);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [crop, setCrop] = useState(init.crop || null);   // nothing is chosen for the visitor: the first page asks
  const [state, setState] = useState(init.state || null);
  const [market, setMarket] = useState(init.mandi || null);
  const [view, setView] = useState(() => viewFor(init));
  const [section, setSection] = useState(init.section || null);   // About page section
  const [mandis, setMandis] = useState([]);                         // the chosen state's mandis for this crop
  const userMove = useRef(false);   // set by the visitor's clicks: the next address change gets its own history entry
  const tabsRef = useScrollEnd();

  // First paint: fetch meta and, alongside it, the first screen's data and code. The chart code follows when idle.
  useEffect(() => {
    api('meta').then(setMeta).catch(e => setError(e.message));
    if (init.mandi) loadMarketChart();
    else if (init.crop) loadOverview();
    // the next pages' code loads when the browser is idle, so the first click after the home page is instant
    (window.requestIdleCallback ?? (f => setTimeout(f, 1500)))(() => { loadOverview(); loadMarketChart(); });
  }, [init]);

  // Links that set part of the address (#view=about&section=risks) change just those parts. Back and Forward return to
  // an address FarmStat wrote itself, so they restore all of it, including clearing a state or mandi that isn't there.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h.view === 'home') { setCrop(null); setState(null); setMarket(null); }
      if (h.crop) setCrop(h.crop);
      if (h.state) setState(h.state);
      if (h.mandi) setMarket(h.mandi);
      if (VIEWS.includes(h.view)) setView(h.view);
      setSection(h.section || null);
    };
    const onPop = e => {
      if (!e.state?.farmstat) return;   // a link's own entry: hashchange handles it
      const h = readHash();
      setCrop(h.crop || null);
      setState(h.state || null);
      setMarket(h.mandi || null);
      setView(viewFor(h));
      setSection(h.section || null);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onPop); };
  }, []);

  const cropMeta = useMemo(() => meta?.crops.find(c => c.id === crop), [meta, crop]);

  // An address naming a crop FarmStat doesn't cover (an old link, a typo) opens the home page instead.
  useEffect(() => {
    if (meta && crop && !cropMeta) { setCrop(null); setState(null); setMarket(null); }
  }, [meta, crop, cropMeta]);
  // A page about one crop with no crop chosen (or an unknown one) shows the home page.
  const page_ = !cropMeta && NEEDS_CROP.includes(view) ? 'home' : view;

  // A crop change keeps the visitor's state only if the new crop has it (never chooses one for them).
  useEffect(() => {
    if (cropMeta && state && !cropMeta.states.some(s => s.name === state)) { setState(null); setMarket(null); }
  }, [cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps -- runs on crop change only, by design

  // The chosen state's mandi list (no mandi is picked automatically).
  useEffect(() => {
    if (!cropMeta || !state || !cropMeta.states.some(s => s.name === state)) { setMandis([]); return undefined; }
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
  }, [crop, state, cropMeta]); // eslint-disable-line react-hooks/exhaustive-deps -- `market` is checked, not a trigger

  // Keep the address in step, so any screen can be bookmarked or shared. The visitor's own moves (a tab, a crop, a mandi,
  // a search result) add a history entry, so Back returns to the last page instead of leaving the site; the app's own
  // corrections (a mandi that doesn't sell this crop) only replace the current entry, so Back can't loop.
  useEffect(() => {
    if (!meta || (crop && !cropMeta)) return;   // until meta arrives (or an unknown crop is cleared) choices may change
    const p = new URLSearchParams();
    if (cropMeta) p.set('crop', crop);
    p.set('view', page_);
    if (cropMeta && state) p.set('state', state);
    if (cropMeta && market) p.set('mandi', market);
    if (page_ === 'about' && section) p.set('section', section);
    const next = `#${p}`;
    const push = userMove.current && window.history.state?.farmstat;
    userMove.current = false;
    if (next === window.location.hash && window.history.state?.farmstat) return;
    window.history[push ? 'pushState' : 'replaceState']({ farmstat: true }, '', next);
  }, [meta, crop, cropMeta, state, market, page_, section]);

  // Start each page at the top, unless a link points into the About page.
  useEffect(() => { if (!(view === 'about' && section)) window.scrollTo(0, 0); }, [view, crop]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = fn => (...args) => {
    userMove.current = true;
    fn(...args);
    setTimeout(() => { userMove.current = false; }, 0);   // a click that changed nothing mustn't mark a later change
  };
  const chooseState = s => { setState(s); setMarket(null); };
  const chooseMarket = move(m => { setMarket(m); if (m) setView(v => (v === 'compare' ? v : 'market')); });
  const openMarket = move((s, m) => { setState(s); setMarket(m); setView('market'); });
  const goTo = move(v => {
    if (v === 'home') { setCrop(null); setState(null); setMarket(null); }
    setView(v);
  });
  const pickCrop = move(setCrop);
  const startCrop = move(c => { setCrop(c); setState(null); setMarket(null); setView('overview'); });

  if (error) {
    return (
      <div className="loading" role="alert">
        <p>Couldn’t reach the FarmStat API: {error}.</p>
        <p>Start it with <code>python -m uvicorn api.main:app</code> and reload.</p>
      </div>
    );
  }
  if (!meta || (crop && !cropMeta)) return <Wait label="Loading FarmStat…" />;

  // The icon rail on the left (desktop) holds only what the tabs don't: the mandi panel (which also opens on hover) and search.
  const rail = [
    { id: 'mandis', label: market ? `Mandi: ${placeName(market)}` : 'Choose a mandi', icon: <Store size={20} aria-hidden="true" />,
      panel: true, active: view === 'market' || view === 'compare',
      onClick: () => (market && view !== 'market' ? goTo('market') : openSidePanel()) },
    { id: 'search', label: `Search ${(crop ?? '').toLowerCase()} mandis`, icon: <Search size={20} aria-hidden="true" />, onClick: openSearch },
  ];
  const side = cropMeta && <Sidebar crop={crop} states={cropMeta.states} state={state} onState={chooseState} rail={rail}
    mandis={mandis} market={market} onMarket={chooseMarket} unit={crop === 'Arecanut' ? 'mandi-varieties' : 'mandis'}
    footer={<>Prices to the week of {date(cropMeta.data_until)}. Source: Agmarknet, Government of India.</>} />;

  // The mandi list for this crop and state has arrived (it lags a state change by one request).
  const listReady = mandis.length > 0 && mandis[0].crop === crop && mandis[0].state === state;

  function page() {
    switch (page_) {
      case 'home': return <HomeView meta={meta} onCrop={startCrop} />;
      case 'about': return <AboutView meta={meta} section={section} onSection={setSection} />;
      case 'accuracy': return <AccuracyView />;
      case 'market':
        if (!market) return <ChooseFirst what="mandi" crop={crop} state={state} />;
        if (!listReady || !mandis.some(m => m.market === market)) return <MarketSkeleton label={`Loading ${placeName(market)}`} />;
        return <MarketView crop={crop} state={state} market={market} meta={meta} />;
      case 'compare':
        if (!state) return <ChooseFirst what="state" crop={crop} states={cropMeta.states} onState={chooseState} />;
        if (!listReady) return <Wait label={`Loading ${crop.toLowerCase()} mandis…`} />;
        return <CompareView crop={crop} state={state} market={market} mandis={mandis} onMarket={chooseMarket}
          onOpen={m => openMarket(state, m)} />;
      default:
        return <OverviewView crop={crop} onState={chooseState} onPick={openMarket} />;
    }
  }

  // Pages that aren't about one crop (home, accuracy, about) stand on their own: no crop switcher, mandi panel or search.
  const plain = !cropMeta || page_ === 'about' || page_ === 'accuracy';
  const tabs = TABS.filter(([v]) => cropMeta || !NEEDS_CROP.includes(v)).map(([value, label]) => ({ value, label }));
  const pageTabs = <Tabs items={tabs} value={page_} onChange={goTo} label="Page" className="tabs" tabRef={tabsRef} />;

  return (
    // React Bits ClickSpark: marigold sparks when a crop is picked (on the home page or the crop switch), nowhere else
    <ClickSpark selector=".crop-pick, .crops button" colors={SPARKS} size={9} radius={26} count={10}>
    <div className={`app${plain ? ' app-plain' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      {!plain && side}
      <main className="main" id="main">
        <header className="topbar">
          <Brand />
          {pageTabs}
          {!plain && <SearchButton crop={crop} onPick={openMarket} />}
        </header>
        {!plain && (
          <div className="context">
            <CropSwitch items={meta.crops.map(c => ({ value: c.id, label: c.id }))} value={crop} onChange={pickCrop} />
            <Crumbs view={page_} state={state} market={market} onIndia={() => goTo('overview')}
              onMandi={() => (market && view !== 'market' ? goTo('market') : openSidePanel())} />
          </div>
        )}
        {page_ !== 'about' && page_ !== 'accuracy' && <Notice />}
        <div className="page">
          <Suspense fallback={page_ === 'market' || page_ === 'overview' ? <MarketSkeleton label="Loading" /> : <Wait />}>
            {page()}
          </Suspense>
        </div>
      </main>
    </div>
    </ClickSpark>
  );
}

// Shown when a page needs a choice the visitor hasn't made yet. Nothing is picked for them.
function ChooseFirst({ what, crop, state, states = [], onState }) {
  if (what === 'state') {
    return (
      <section className="panel choose-first">
        <h2>Choose a state to compare its mandis</h2>
        <p className="sub">Each state’s mandis are compared on their latest weekly price.</p>
        <div className="chips">{[...states].sort((a, b) => b.count - a.count).map(s => (
          <button key={s.name} type="button" className="chip" onClick={() => onState(s.name)}>{s.name}<span>{s.count}</span></button>
        ))}</div>
      </section>
    );
  }
  return (
    <section className="panel choose-first">
      <h2>Choose a {crop.toLowerCase()} mandi</h2>
      <p className="sub">{state
        ? `Pick one of the ${state} mandis from the list on the left, or search all of India.`
        : 'Choose a state and a mandi from the panel on the left, or search all of India.'}</p>
      <div className="choose-actions">
        <button type="button" className="btn primary" onClick={openSidePanel}>Open the mandi list</button>
        <button type="button" className="btn" onClick={openSearch}>Search {crop.toLowerCase()} mandis</button>
      </div>
    </section>
  );
}

// Where the visitor is: India, then the state and mandi they chose (each opens the mandi list to change it).
function Crumbs({ view, state, market, onIndia, onMandi }) {
  return (
    <nav className="crumbs" aria-label="Where you are">
      <button type="button" className="crumb" aria-current={view === 'overview' && !state ? 'page' : undefined} onClick={onIndia}>
        <span>All India</span></button>
      <span aria-hidden="true">/</span>
      <button type="button" className={`crumb${state ? '' : ' empty-crumb'}`} onClick={openSidePanel}
        aria-label={state ? `State: ${state}. Change` : 'Choose a state'}>
        <span>{state ?? 'Choose a state'}</span><ChevronDown size={14} aria-hidden="true" /></button>
      {state && <>
        <span aria-hidden="true">/</span>
        <button type="button" className={`crumb${market ? '' : ' empty-crumb'}`} onClick={onMandi}
          aria-current={view === 'market' && market ? 'page' : undefined}
          aria-label={market ? `Mandi: ${placeName(market)}` : 'Choose a mandi'}>
          <span>{market ? placeName(market) : 'Choose a mandi'}</span>{!market && <ChevronDown size={14} aria-hidden="true" />}</button>
      </>}
    </nav>
  );
}
