import { useEffect, useLayoutEffect, useRef } from 'react';

// Ported from React Bits CountUp (David Haz, MIT + Commons Clause; see LICENSE.md). Same idea: the number counts up
// when it scrolls into view. FarmStat changes: requestAnimationFrame instead of the `motion` library (about 30 kB),
// and when `to` changes it counts from the number on screen to the new one, like a rate board being updated.
// The text is written straight to the element, so React never re-renders per frame; with reduced motion it just shows.
const reduced = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
const ease = t => 1 - Math.pow(1 - t, 3);

export default function CountUp({ to, from = 0, format = v => String(Math.round(v)), duration = 0.9, className }) {
  const ref = useRef(null);
  const fmt = useRef(format);
  fmt.current = format;
  const shown = useRef(null);       // the number currently on screen (null = never animated)

  // before the first paint: show the final number, so nothing flashes and it reads correctly without animation
  useLayoutEffect(() => {
    if (ref.current && shown.current === null) ref.current.textContent = fmt.current(to);
  }, [to]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(to)) return undefined;
    if (reduced()) { el.textContent = fmt.current(to); shown.current = to; return undefined; }
    const start = shown.current ?? from;
    if (start === to) { el.textContent = fmt.current(to); shown.current = to; return undefined; }
    let raf = 0, t0 = 0;
    const step = now => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / (duration * 1000));
      const v = start + (to - start) * ease(p);
      shown.current = v;
      el.textContent = fmt.current(p < 1 ? v : to);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    // the first count waits until the number is on screen; later changes count straight away
    if (shown.current === null) {
      el.textContent = fmt.current(start);
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); raf = requestAnimationFrame(step); }
      });
      io.observe(el);
      return () => { io.disconnect(); cancelAnimationFrame(raf); if (shown.current !== to) el.textContent = fmt.current(to); shown.current = to; };
    }
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [to, from, duration]);

  return <span ref={ref} className={className} />;
}
