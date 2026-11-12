import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { rupees } from '../format.js';

// "Search all mandis": one box that finds any mandi in India for any crop, or jumps to a page.
// The palette code and the mandi index (one compact list) load only when it is first opened.
const Palette = lazy(() => import('./ui/CommandPalette.jsx'));
const PAGES = [
  { id: 'p-accuracy', label: 'Model accuracy', hint: 'How well the forecasts did on weeks the model never saw', group: 'Pages', keywords: 'error backtest validation skill', view: 'accuracy' },
  { id: 'p-about', label: 'About FarmStat', hint: 'Method, terms and risks', group: 'Pages', keywords: 'terms risks method data', view: 'about' },
];
let indexPromise;
const loadIndex = () => (indexPromise ??= api('index').catch(e => { indexPromise = null; throw e; }));

export default function SearchButton({ crops, onPick }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const mac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), []);

  const show = useCallback(() => {
    setOpen(true);
    loadIndex().then(d => setRows(d.rows)).catch(() => setRows([]));
  }, []);
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  const items = useMemo(() => {
    const cropItems = crops.map(c => ({ id: `c-${c.id}`, label: c.id, group: 'Crops', crop: c.id,
      hint: c.kind === 'weekly' ? `${c.series.toLocaleString('en-IN')} mandi series` : c.kind === 'monthly' ? 'Monthly state prices' : 'Government price (FRP)',
      view: c.kind === 'weekly' ? 'market' : 'overview' }));
    const mandis = (rows ?? []).map(([crop, state, market, district, price]) => ({
      id: `m-${crop}-${state}-${market}`, label: market, hint: `${district}, ${state}`, group: `${crop} mandis`,
      aside: rupees(price), keywords: `${market} ${district} ${state} ${crop}`, crop, state, market, view: 'market' }));
    return [...cropItems, ...PAGES, ...mandis];
  }, [crops, rows]);

  return (
    <>
      <button type="button" className="search-any" onClick={show} onPointerEnter={() => { loadIndex().catch(() => {}); import('./ui/CommandPalette.jsx'); }}
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'} aria-haspopup="dialog">
        <Search size={15} aria-hidden="true" /><span>Search all mandis</span><kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      {open && (
        <Suspense fallback={null}>
          <Palette open={open} items={items} loading={rows === null} placeholder="Mandi, district, state or crop"
            emptyLabel="No mandi matches. Try the district or state name."
            onClose={() => setOpen(false)} onSelect={it => { setOpen(false); onPick(it); }} />
        </Suspense>
      )}
    </>
  );
}
