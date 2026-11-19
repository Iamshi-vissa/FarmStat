import { useEffect, useRef } from 'react';

// React Bits ClickSpark (David Haz, MIT + Commons Clause; see LICENSE.md): short lines burst out from a click.
// FarmStat changes: only clicks on elements matching `selector` spark; the canvas is one viewport-sized layer that
// draws only while sparks are flying (never a page-tall canvas, never an idle loop); reduced motion turns it off.
export default function ClickSpark({ selector, colors = ['#fff'], size = 10, radius = 26, count = 8, duration = 480, children }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let sparks = [];
    let raf = 0;
    const fit = () => {
      const r = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * r);
      canvas.height = Math.round(window.innerHeight * r);
      ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    const draw = now => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      sparks = sparks.filter(s => now - s.start < duration);
      for (const s of sparks) {
        const p = (now - s.start) / duration;
        const eased = 1 - (1 - p) ** 3;
        const dist = eased * radius;
        const len = size * (1 - eased);
        const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x + dist * cos, s.y + dist * sin);
        ctx.lineTo(s.x + (dist + len) * cos, s.y + (dist + len) * sin);
        ctx.stroke();
      }
      raf = sparks.length ? requestAnimationFrame(draw) : 0;
    };
    const onClick = e => {
      if (!e.target.closest?.(selector) || (e.clientX === 0 && e.clientY === 0)) return;   // keyboard "clicks" have no point
      if (!raf) fit();
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (2 * Math.PI * i) / count, start, color: colors[i % colors.length] });
      }
      if (!raf) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('click', onClick); cancelAnimationFrame(raf); };
  }, [selector, colors, size, radius, count, duration]);

  return (
    <>
      {children}
      <canvas ref={canvasRef} aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 80 }} />
    </>
  );
}
