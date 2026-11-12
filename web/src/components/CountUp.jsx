import { useEffect, useRef, useState } from 'react';

const fmt = (v, decimals, separator) => {
  const s = v.toFixed(decimals);
  if (!separator) return s;
  const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, separator) + (d ? `.${d}` : '');
};

// Counts up to a number the first time it scrolls into view (no animation library; respects reduced motion).
export default function CountUp({ to, decimals = 0, prefix = '', suffix = '', separator = '', duration = 1 }) {
  const ref = useRef(null);
  const [v, setV] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(to); return undefined; }
    let raf = 0;
    setV(0);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / (duration * 1000));
        setV(to * (1 - (1 - p) ** 3));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);
  return <span ref={ref} aria-label={`${prefix}${fmt(to, decimals, separator)}${suffix}`}>{prefix}{fmt(v, decimals, separator)}{suffix}</span>;
}
