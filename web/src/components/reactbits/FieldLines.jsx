import { useEffect, useRef } from 'react';

// Ported from React Bits Waves (David Haz, MIT + Commons Clause; see LICENSE.md): lines that drift and bend away from the
// pointer. FarmStat lays them flat, like furrows in a ploughed field, in a faint mandi green behind each page's title.
// Changes: plain sine waves instead of a noise library; about 30 frames a second, and only while the backdrop is on
// screen and the tab is visible; one still frame for reduced motion; the canvas never takes pointer events.
export default function FieldLines({ color = 'rgba(29, 94, 53, 0.11)', gap = 18, step = 14 }) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    const canvas = box?.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!ctx) return undefined;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = 0, onScreen = true;
    const pointer = { x: -1e4, y: -1e4, push: 0 };

    const size = () => {
      const r = Math.min(window.devicePixelRatio || 1, 2);
      w = box.clientWidth; h = box.clientHeight;
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
      ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    const draw = t => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const s = t / 1000;
      for (let y0 = gap / 2; y0 < h + gap; y0 += gap) {
        ctx.beginPath();
        for (let x = -step; x <= w + step; x += step) {
          let y = y0 + 4 * Math.sin(x * 0.006 + s * 0.35 + y0 * 0.04) + 2.5 * Math.sin(x * 0.017 - s * 0.5 + y0 * 0.11);
          const dx = x - pointer.x, dy = y - pointer.y;
          y += pointer.push * Math.sign(dy || 1) * 22 * Math.exp(-(dx * dx + dy * dy) / (2 * 70 * 70));   // part around the pointer
          if (x === -step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    const tick = t => {
      raf = 0;
      if (!onScreen || document.hidden) return;
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      pointer.push += ((pointer.x > -1e3 ? 1 : 0) - pointer.push) * 0.12;
      draw(t);
    };
    const start = () => { if (!still && !raf) raf = requestAnimationFrame(tick); };
    const onMove = e => {
      const b = box.getBoundingClientRect();
      const inside = e.clientY >= b.top && e.clientY <= b.bottom;
      pointer.x = inside ? e.clientX - b.left : -1e4;
      pointer.y = e.clientY - b.top;
    };

    size(); draw(performance.now());
    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) start(); });
    io.observe(box);
    const onVisible = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', onVisible);
    if (!still) window.addEventListener('pointermove', onMove, { passive: true });
    start();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointermove', onMove);
    };
  }, [color, gap, step]);
  return <div ref={ref} className="field-lines" aria-hidden="true"><canvas /></div>;
}
