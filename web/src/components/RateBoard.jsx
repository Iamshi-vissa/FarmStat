import { CircleCheck, CircleHelp, CircleAlert, Info } from 'lucide-react';
import SplitFlapText from './reactbits/SplitFlapText.jsx';
import Topography from './reactbits/Topography.jsx';
import { date, plain } from '../format.js';

const ADVICE = {
  Hold: { cls: 'hold', Icon: CircleCheck },
  'Sell now': { cls: 'sell', Icon: CircleAlert },
  'Your call': { cls: 'call', Icon: CircleHelp },
  Information: { cls: 'info', Icon: Info }
};

// The mandi rate board: the current modal price on split-flap tiles over a faint contour map.
export default function RateBoard({ title, where, priceLabel, price, advice, children }) {
  const text = plain(price);
  const a = advice ? ADVICE[advice.action] ?? ADVICE['Your call'] : null;
  return (
    <section className="board" aria-label="Current price">
      <div className="board-bg" aria-hidden="true">
        <Topography color="#8fc3a3" lineCount={18} lineWidth={1} elevation={0.8} speed={0.08} tilt={38}
          glow={0.25} fog={0.5} morph={0.12} mouseInteraction={false} clickEffect="none" intro={false} brightness={0.8} />
      </div>
      <div className="board-place">
        <span className="board-market">{title}</span>
        <span className="board-where">{where}</span>
      </div>
      <div>
        <div className="board-price">
          <span className="board-rupee" aria-hidden="true">₹</span>
          <SplitFlapText key={title} text={text} loop={false} padTo={text.length} align="right"
            charset="0123456789" fontSize={50} tileColor="#0b241d" textColor="#f1e8cf" tileRadius={6} gap={4}
            flipsPerChar={6} stagger={0.05} glare={0.15} aria-label={`₹${text}`} />
          <span className="board-unit"><strong>per quintal</strong>{priceLabel}</span>
        </div>
      </div>
      {a && (
        <div className="board-advice" role="status">
          <div className="advice-head">
            <span className={`advice-pill ${a.cls}`}><a.Icon size={15} aria-hidden="true" />{advice.action}</span>
          </div>
          <strong>{advice.headline}</strong>
          <p>{advice.detail}</p>
          {children}
        </div>
      )}
    </section>
  );
}

export const priceWeek = w => `week of ${date(w)}`;
