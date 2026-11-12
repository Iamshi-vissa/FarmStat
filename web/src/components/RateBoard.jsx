import { Suspense, lazy, memo, useEffect, useRef, useState } from 'react';
import SplitFlapText from './reactbits/SplitFlapText.jsx';
import AdviceSlip from './AdviceSlip.jsx';
import { date, plain } from '../format.js';
import { T } from '../theme.js';

// The mandi rate board: the current modal price on split-flap tiles over a faint contour map,
// with the week's advice on a paper slip (parchi) pinned to it.
export default function RateBoard({ title, where, priceLabel, price, advice, slipKey, live }) {
  const text = plain(price);
  return (
    <section className="board" aria-label="Current price and advice">
      <BoardBackground />
      <div className="board-left">
        <div className="board-place">
          <h1 className="board-market">{title}</h1>
          <span className="board-where">{where}</span>
        </div>
        <div className="board-price">
          <span className="board-rupee" aria-hidden="true">₹</span>
          <SplitFlapText key={title} text={text} loop={false} padTo={text.length} align="right"
            charset="0123456789" fontSize={50} tileColor={T.boardTile} textColor={T.chalk} tileRadius={6} gap={4}
            flipsPerChar={6} stagger={0.05} glare={0.15} aria-label={`₹${text}`} />
          <span className="board-unit"><strong>per quintal</strong>{priceLabel}</span>
          {live && <span className="live-chip" title="This week's price comes from the live daily feed"><i aria-hidden="true" />Live</span>}
        </div>
      </div>
      {advice && <AdviceSlip key={slipKey ?? title} {...advice} />}
    </section>
  );
}

// The contour map is decoration. React Bits Topography draws it once with WebGL after the page has painted; the
// result is kept as a still image and the WebGL canvas is closed, so nothing keeps running or slowing repaints.
// Skipped when the visitor asks for reduced motion or less data.
let contourImage = null;   // shared by every board in this visit
const Topography = lazy(() => import('./reactbits/Topography.jsx'));   // only downloaded when it's time to draw

const BoardBackground = memo(function BoardBackground() {
  const [img, setImg] = useState(contourImage);
  const [drawing, setDrawing] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (img) return undefined;
    const skip = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData;
    if (skip) return undefined;
    const idle = window.requestIdleCallback ?? (cb => setTimeout(cb, 200));
    let id = 0;
    const t = setTimeout(() => { id = idle(() => setDrawing(true), { timeout: 2000 }); }, 1200);
    return () => { clearTimeout(t); (window.cancelIdleCallback ?? clearTimeout)(id); };
  }, [img]);

  useEffect(() => {   // once drawn, keep a still image and close WebGL
    if (!drawing) return undefined;
    let tries = 0;
    const iv = setInterval(() => {
      const canvas = ref.current?.querySelector('canvas');
      tries += 1;
      if (!canvas) return;
      let url = '';
      try { url = canvas.toDataURL('image/webp', 0.85); } catch { /* unavailable */ }
      if (url.length > 8000 || tries > 12) {
        clearInterval(iv);
        if (url.length > 8000) { contourImage = url; setImg(url); }
        setDrawing(false);
      }
    }, 300);
    return () => clearInterval(iv);
  }, [drawing]);

  return (
    <div className={`board-bg${img ? ' on' : ''}`} aria-hidden="true" ref={ref}
      style={img ? { backgroundImage: `url(${img})` } : undefined}>
      {drawing && <Suspense fallback={null}><Topography dpr={1} color={T.contour} lineCount={16} lineWidth={1} elevation={0.8} speed={0} tilt={38}
        glow={0.25} fog={0.5} morph={0.12} mouseInteraction={false} clickEffect="none" intro={false} brightness={0.8}
        style={{ opacity: 0 }} /></Suspense>}
    </div>
  );
});

export const priceWeek = w => `week of ${date(w)}`;
