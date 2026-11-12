import { useRef } from 'react';
import Noise from './reactbits/Noise.jsx';
import { pct0 } from '../format.js';

const STAMP = { Hold: 'hold', 'Sell now': 'sell', 'Your call': 'call', Information: 'info' };

// The parchi: an opaque paper slip with the week's advice. Animated grain (React Bits Noise) and a soft light
// that follows the pointer make the paper feel physical; the verdict is stamped on whenever the mandi changes.
export default function AdviceSlip({ action, headline, detail, chance, chanceLabel, footnote, label }) {
  const ref = useRef(null);
  const onMove = e => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    ref.current.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    ref.current.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  return (
    <div className="slip-wrap">
      <article className="slip" ref={ref} onPointerMove={onMove} role="status" aria-label={`Advice: ${action}. ${headline}`}>
        <div className="slip-paper" aria-hidden="true" />
        <Noise opacity={0.07} size={1} fps={6} blendMode="multiply" contrast={0.45} dust={0.05} />
        <div className="slip-top">
          <span className="slip-label"><b>{label ?? (action === 'Information' ? 'Good to know' : 'This week’s call')}</b>FarmStat {action === 'Information' ? 'note' : 'estimate'}</span>
          <span className={`stamp ${STAMP[action] ?? 'call'}`}>{action}</span>
        </div>
        <div className="slip-headline">{headline}</div>
        <p>{detail}</p>
        {chance != null && (
          <div className="slip-meter">
            <div className="slip-meter-row"><span>{chanceLabel}</span><strong className="num">{pct0(chance)}</strong></div>
            <div className="slip-meter-track" role="img" aria-label={`${chanceLabel}: ${pct0(chance)}`}>
              <div className="slip-meter-fill" style={{ width: `${Math.round(chance * 100)}%` }} />
            </div>
          </div>
        )}
        <div className="slip-foot">
          <span>{footnote ?? 'An estimate, not a guarantee.'}</span>
          <a href="#view=about&section=risks">Read the risks</a>
        </div>
      </article>
    </div>
  );
}
