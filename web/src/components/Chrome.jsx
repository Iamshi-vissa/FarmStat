import { useEffect, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';

const KEY = 'farmstat-notice-v1';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

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

// Sidebar frame. On phones it collapses to a header with a button showing the current choice;
// the list opens below it and closes again once something is picked.
export function SideShell({ label, current, footer, children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [current]);
  return (
    <aside className="side" aria-label={label} data-open={open}>
      <div className="side-head">
        <Brand />
        {current && (
          <button type="button" className="side-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <span>{current}</span><ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="side-body">
        {children}
        <div className="side-foot">{footer}<SideLinks /></div>
      </div>
    </aside>
  );
}

// Shown once: forecasts are estimates, with a link to the risks. Closing it is remembered in this browser.
export function Notice() {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } setOpen(false); };
  return (
    <div className="notice" role="note">
      <Info size={16} aria-hidden="true" />
      <p>FarmStat’s prices are estimates from past data, not guarantees or official rates. Check the day’s rate at the mandi
        before you sell. <a href="#view=about&section=risks">Read the risks</a> and <a href="#view=about&section=terms">terms of use</a>.</p>
      <button type="button" onClick={close}>Got it</button>
    </div>
  );
}
