import { pct0 } from '../format.js';

const STAMP = { Hold: 'hold', 'Sell now': 'sell', 'Your call': 'call' };

// The parchi: a paper slip pinned to the rate board with the week's advice, stamped with the verdict.
export default function AdviceSlip({ action, headline, detail, chance, chanceLabel, footnote, label = 'This week’s call' }) {
  return (
    <div className="slip-wrap">
      <article className="slip" role="status" aria-label={`Advice: ${action}. ${headline}`}>
        <div className="slip-paper" aria-hidden="true" />
        <div className="slip-top">
          <span className="slip-label"><b>{label}</b>FarmStat estimate</span>
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
