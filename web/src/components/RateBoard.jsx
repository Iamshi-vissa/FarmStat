import { date, pct0, rupees } from '../format.js';
import { T } from '../theme.js';
import BlurText from './reactbits/BlurText.jsx';
import CountUp from './reactbits/CountUp.jsx';
import ShinyText from './reactbits/ShinyText.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';

// React Bits on the board: the title comes into focus (BlurText), a marigold light follows the pointer across the
// cells (SpotlightCard), the figures count to their value (CountUp) and the week's call shines once (ShinyText).

// The rate board, modelled on the bhav board at a mandi gate: the place and the week's call on top, then one ruled row
// of big condensed figures (this week's price first, then what's expected). It is the one loud element on a page.
export default function RateBoard({ title, where = [], verdict, cells, busy = false }) {
  return (
    <section className="board" aria-label="Price and advice" aria-busy={busy || undefined}>
      <div className="board-head">
        <div className="board-title">
          <BlurText key={title} as="h1" text={title} />
          <p className="board-where">{where.filter(Boolean).map((w, i) => <span key={i}>{w}</span>)}</p>
        </div>
        {verdict}
      </div>
      <div className="board-grid" style={{ '--cols': cells.length - 1 }}>
        {cells.map((c, i) => (
          <SpotlightCard key={c.key ?? i} className={`board-cell${i === 0 ? ' lead' : ''}`} theme="light" spotlightColor={T.forecast}
            intensity={0.5} spotlightSize={220} borderGlow={0} proximity={0} flare={false}>
            <div className="board-label">{c.label}</div>
            <div className={`board-value${c.range ? ' range' : ''}`} aria-label={c.valueLabel}>{c.value}</div>
            {c.sub && <div className="board-sub">{c.sub}</div>}
            {c.extra}
            {c.note && <div className="board-note">{c.note}</div>}
          </SpotlightCard>
        ))}
      </div>
    </section>
  );
}

// The price as it's painted on the board: the figure, then "per quintal" in small type.
export const Price = ({ v, unit = '/ q' }) => (
  <><Count to={v} /><small>{unit}</small></>
);
// A rupee figure that counts to its value (from a little below it the first time, then from the last value shown).
export const Count = ({ to, format = rupees }) => <CountUp to={to} from={to * 0.88} format={format} />;

const TONE = { Hold: 'hold', 'Sell now': 'sell' };
const SHINE = { hold: [T.forest, '#8fe0a8'], sell: [T.drop, '#ffc2ad'], call: [T.ink, '#b8c2ba'] };

// The week's call: one word in the tone colour (green hold, brick sell, ink otherwise), the reason, and the chance of a rise.
export function Verdict({ action, word, headline, detail, chance, chanceLabel, footnote, label = 'This week’s call', children }) {
  const tone = TONE[action] ?? 'call';
  const [color, shine] = SHINE[tone];
  return (
    <div className={`verdict ${tone}`} role="status" aria-label={`${label}: ${word ?? action}. ${headline}`}>
      <span className="verdict-label">{label}</span>
      <strong className="verdict-word">
        <ShinyText key={word ?? action} text={word ?? action} color={color} shineColor={shine} trigger="view" speed={1.6} shineWidth={30} />
      </strong>
      <p className="verdict-head">{headline}</p>
      {detail && <p className="verdict-detail">{detail}</p>}
      {children}
      {chance != null && (
        <div className="meter">
          <div className="meter-row"><span>{chanceLabel}</span><strong className="num">{pct0(chance)}</strong></div>
          <div className="meter-track" role="img" aria-label={`${chanceLabel}: ${pct0(chance)}`}>
            <div className="meter-fill" style={{ width: `${Math.round(chance * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="verdict-foot">
        <span>{footnote ?? 'An estimate, not a guarantee.'}</span>
        <a href="#view=about&section=risks">Read the risks</a>
      </div>
    </div>
  );
}

// Likely range on a shared scale: marigold band = 10th to 90th percentile, tick = forecast, dot = today.
export function RangeBar({ lo, mid, hi, now, min, max }) {
  const pos = v => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="rangebar" role="img" aria-label={`Likely between ${rupees(lo)} and ${rupees(hi)}; today ${rupees(now)}`}>
      <div className="rangebar-track" />
      <div className="rangebar-band" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
      {mid != null && <div className="rangebar-mid" style={{ left: pos(mid) }} />}
      <div className="rangebar-now" style={{ left: pos(now) }} title="Today" />
    </div>
  );
}

export const priceWeek = w => `Week of ${date(w)}`;
