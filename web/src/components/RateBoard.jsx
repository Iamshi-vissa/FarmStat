import { memo, useEffect, useState } from 'react';
import contours from '../assets/board-contours.webp';
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
          <span className="board-digits" role="img" aria-label={`₹${text}`}>
            {text.split(',').map((group, i) => (
              <span key={`${title}-${i}`} className="board-group" aria-hidden="true">
                {i > 0 && <span className="board-sep">,</span>}
                <SplitFlapText text={group} loop={false} padTo={group.length} align="right"
                  charset="0123456789" fontSize={50} tileColor={T.boardTile} textColor={T.chalk} tileRadius={6} gap={4}
                  flipsPerChar={6} stagger={0.05} glare={0.15} />
              </span>
            ))}
          </span>
          <span className="board-unit"><strong>per quintal</strong>{priceLabel}</span>
          {live && <span className="live-chip" title="This week's price comes from the live daily feed"><i aria-hidden="true" />Live</span>}
        </div>
      </div>
      {advice && <AdviceSlip key={slipKey ?? title} {...advice} />}
    </section>
  );
}

// The contour map is decoration: a pre-rendered image (drawn once with React Bits Topography) used as a mask and
// tinted with the contour colour, so no WebGL runs in the visitor's browser and nothing blocks the page.
const BoardBackground = memo(function BoardBackground() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (navigator.connection?.saveData) return undefined;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setOn(true); };
    img.src = contours;
    return () => { live = false; };
  }, []);
  return <div className={`board-bg${on ? ' on' : ''}`} aria-hidden="true" />;
});

export const priceWeek = w => `week of ${date(w)}`;
