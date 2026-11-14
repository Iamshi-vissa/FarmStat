import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Info, Pin, PinOff, X } from 'lucide-react';
import { api } from '../api.js';
import { PANEL } from '../events.js';
import { date } from '../format.js';
import { useAppEvent, useDesktop } from '../hooks.js';
import { readFlag, writeFlag } from '../storage.js';

const NOTICE_KEY = 'farmstat-notice-v1';
const PIN_KEY = 'farmstat-panel-pinned';
const PEEK_GRACE = 220;   // ms the panel stays while the pointer travels from the rail into it
const PEEK_INTENT = 140;  // ms the pointer must rest on the rail before the panel opens (passing over it does nothing)

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-glyph" aria-hidden="true">₹</span>
      <span><span className="brand-mark">FarmStat</span><span className="brand-sub">mandi price forecasts</span></span>
    </div>
  );
}

export function SideLinks() {
  return (
    <nav className="side-links" aria-label="Policies">
      <a href="#view=about&section=terms">Terms</a>
      <a href="#view=about&section=risks">Risks</a>
      <a href="#view=about&section=privacy">Privacy</a>
      <a href="#view=about&section=data">Data</a>
    </nav>
  );
}

// When the live feed last brought in prices (shared by every sidebar; fetched once).
let statusPromise = null;
function LiveStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    statusPromise ??= api('live/status').catch(() => ({ available: false }));
    statusPromise.then(setS);
  }, []);
  if (!s) return null;
  if (!s.available || !s.latest_price_date) return <div className="live-status off">Live feed: not reachable right now</div>;
  const at = s.last_fetch?.finished_at ?? s.last_fetch?.started_at;
  const time = at ? new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="live-status"><i aria-hidden="true" />Live feed: prices to {date(s.latest_price_date)}
      {at && <>, checked {date(at)}{time ? ` at ${time}` : ''}</>}</div>
  );
}

// Sidebar frame.
// Desktop: a slim icon rail (pages, search, mandis). Hovering or focusing it slides the panel with the state picker and
// mandi list out over the page; pinning docks the panel beside the page instead. Ported from the 21st.dev "Rail Panel
// Sidebar" by dhxwhy (hover peek with a grace period, pin to dock, Escape and click-outside to close, a sliding active
// marker on the rail, arrow keys between rail buttons), rebuilt with FarmStat's tokens and CSS transitions.
// Phones: a compact header with a button showing the current choice; the panel opens below it.
export function SideShell({ label, current, placeholder, footer, rail = [], children }) {
  const [open, setOpen] = useState(false);          // phone drop-down
  const [peek, setPeek] = useState(false);          // desktop hover panel
  const [pinned, setPinned] = useState(() => readFlag(PIN_KEY));
  const aside = useRef(null);
  const timer = useRef(0);
  const marker = useRef(null);
  const buttons = useRef({});
  const desktop = useDesktop();

  const clear = () => { window.clearTimeout(timer.current); timer.current = 0; };
  const show = useCallback(() => { clear(); setPeek(true); }, []);
  const hide = useCallback(() => { clear(); setPeek(false); }, []);
  const showSoon = () => { clear(); timer.current = window.setTimeout(() => setPeek(true), PEEK_INTENT); };
  const hideSoon = () => {
    // a native drop-down (the state picker) draws outside the page, so the pointer "leaves" while choosing: stay open
    if (document.activeElement?.tagName === 'SELECT' && aside.current?.contains(document.activeElement)) return;
    clear();
    timer.current = window.setTimeout(() => setPeek(false), PEEK_GRACE);
  };

  useEffect(() => { setOpen(false); setPeek(false); }, [current]);   // a choice was made: get out of the way
  useAppEvent(PANEL, useCallback(() => { setOpen(true); setPeek(true); }, []));
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {   // a click outside, or Escape from anywhere on the page, closes the peek
    if (!peek || pinned) return undefined;
    const onDown = e => { if (aside.current && !aside.current.contains(e.target)) hide(); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.cmdk')) hide(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [peek, pinned, hide]);
  useEffect(() => { document.documentElement.dataset.panel = pinned ? 'pinned' : 'rail'; }, [pinned]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    setPeek(false);
    writeFlag(PIN_KEY, next);
  };

  const active = rail.find(r => r.active)?.id;
  useLayoutEffect(() => {   // slide the marker to the active rail button
    const b = buttons.current[active];
    if (!marker.current) return;
    marker.current.style.opacity = b ? '1' : '0';
    if (b) marker.current.style.transform = `translateY(${b.offsetTop}px)`;
  }, [active, rail.length]);

  const onRailKeys = e => {
    const ids = rail.map(r => r.id);
    const at = ids.indexOf(e.target.dataset?.rail);
    if (at < 0) return;
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    buttons.current[ids[(next + ids.length) % ids.length]]?.focus();
  };

  const hidden = desktop && !(pinned || peek);   // on phones the panel is the header, always there
  return (
    <aside className="side" aria-label={label} ref={aside} data-open={open} data-peek={peek && !pinned} data-pinned={pinned}
      onPointerEnter={e => { if (e.pointerType !== 'touch' && !pinned) (peek ? show() : showSoon()); }}
      onPointerLeave={e => { if (e.pointerType !== 'touch' && !pinned) hideSoon(); }}
      onFocus={e => { if (!pinned && e.target.matches?.('.side-panel :focus-visible, .rail-btn[data-panel]:focus-visible')) show(); }}
      onBlur={e => { if (!pinned && !aside.current?.contains(e.relatedTarget)) hideSoon(); }}
      onKeyDown={e => { if (e.key === 'Escape' && peek && !pinned && aside.current?.contains(document.activeElement)) buttons.current[active]?.focus(); }}>
      <nav className="rail" aria-label="FarmStat pages" onKeyDown={onRailKeys}>
        <span className="brand-glyph rail-brand" aria-hidden="true">₹</span>
        <div className="rail-list">
          <span className="rail-marker" ref={marker} aria-hidden="true" />
          {rail.map(r => (
            <button key={r.id} type="button" className="rail-btn" data-rail={r.id} data-panel={r.panel ? '' : undefined}
              ref={n => { buttons.current[r.id] = n; }} aria-label={r.label} title={r.label}
              aria-current={r.active ? 'page' : undefined} tabIndex={r.active || (!active && r === rail[0]) ? 0 : -1}
              onClick={() => { if (r.panel) show(); r.onClick?.(); }}>
              {r.icon}
              <span className="rail-tip" aria-hidden="true">{r.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="rail-btn rail-pin" aria-pressed={pinned} onClick={togglePin}
          aria-label={pinned ? 'Unpin the side panel' : 'Pin the side panel open'} title={pinned ? 'Unpin panel' : 'Pin panel open'}>
          {pinned ? <Pin size={18} aria-hidden="true" /> : <PinOff size={18} aria-hidden="true" />}
        </button>
      </nav>
      <div className="side-panel" aria-hidden={hidden ? 'true' : undefined} inert={hidden}>
        <div className="side-head">
          <Brand />
          {!pinned && (
            <button type="button" className="side-close" onClick={hide} aria-label="Close the panel" title="Close (Esc)">
              <X size={18} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="side-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <span>{current || placeholder || 'Choose'}</span><ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="side-body">
          {children}
          <div className="side-foot">{footer}<LiveStatus /><SideLinks /></div>
        </div>
      </div>
    </aside>
  );
}

// Shown once: forecasts are estimates, with a link to the risks. Closing it is remembered in this browser.
export function Notice() {
  const [open, setOpen] = useState(() => !readFlag(NOTICE_KEY));
  if (!open) return null;
  const close = () => { writeFlag(NOTICE_KEY, true); setOpen(false); };
  return (
    <div className="notice" role="note">
      <Info size={16} aria-hidden="true" />
      <p>FarmStat’s prices are estimates from past data, not guarantees or official rates. Check the day’s rate at the mandi
        before you sell. <a href="#view=about&section=risks">Read the risks</a> and <a href="#view=about&section=terms">terms of use</a>.</p>
      <button type="button" onClick={close}>Got it</button>
    </div>
  );
}
