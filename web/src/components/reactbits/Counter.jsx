import { useEffect, useRef, useState } from 'react';
import './Counter.css';

// React Bits Counter (David Haz, MIT + Commons Clause; see LICENSE.md): every digit is a reel of 0 to 9 that rolls to
// its value, like the flaps of a rate board. FarmStat changes: it rolls any formatted text ("₹2,675", "+2.8%"; signs,
// commas and symbols stay put), with CSS transitions instead of the `motion` library. The first roll starts when the
// number scrolls into view, from `from`; later values roll from the one on screen. Reduced motion shows the value.
const reduced = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export default function Counter({ value, from, format = v => String(v), className = '' }) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(() => from == null || reduced());
  useEffect(() => {
    if (revealed || !ref.current) return undefined;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); requestAnimationFrame(() => setRevealed(true)); }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [revealed]);

  const text = value == null || Number.isNaN(value) ? '–' : format(value);
  const shown = revealed ? text : format(from);
  const chars = [...shown];
  return (
    <span ref={ref} className={`counter ${className}`.trim()}>
      <span className="sr">{text}</span>
      <span className="counter__face" aria-hidden="true">
        {chars.map((c, i) => {
          const key = chars.length - i;   // keyed by place from the right, so units stay units when the length changes
          return /\d/.test(c)
            ? <span key={key} className="counter__reel"><span className="counter__strip" style={{ '--d': c }}>
              {'0123456789'.split('').map(n => <span key={n}>{n}</span>)}</span></span>
            : <span key={key} className="counter__ch">{c}</span>;
        })}
      </span>
    </span>
  );
}
