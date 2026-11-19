import Delta from './Delta.jsx';
import { TrendLine } from './Sparkline.jsx';
import { CallsBar, Count, SPOT } from './RateBoard.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';
import VariableProximity from './reactbits/VariableProximity.jsx';
import { date, rupees } from '../format.js';

const ABOUT = {
  Onion: 'Forecast 1, 2 and 4 weeks ahead, with sell or hold advice',
  Tomato: 'Forecast 1, 2 and 4 weeks ahead; tomatoes are never held more than a week',
  Potato: 'Forecast 1, 2 and 4 weeks ahead, with sell or hold advice',
  Arecanut: 'Today’s price by variety, with its usual range of movement',
};
// The headline's letters thicken and widen under the pointer, along Archivo's weight and width axes.
const HEAD_FROM = { wght: 800, wdth: 118 };
const HEAD_TO = { wght: 900, wdth: 122 };

// The first page: nothing is chosen yet. How FarmStat is used, then the four crops on one ruled board, each with this
// week's India median, its last 26 weeks and this week's calls.
export default function HomeView({ meta, onCrop }) {
  return (
    <>
      <header className="home-head">
        <VariableProximity as="h1" text="Which crop are you selling?" from={HEAD_FROM} to={HEAD_TO} />
        <p className="lede">FarmStat estimates where mandi prices are heading in {meta.n_mandis.toLocaleString('en-IN')} mandis
          across {meta.n_states} states, and says whether to sell now or hold.</p>
        <ol className="home-steps" aria-label="How to use FarmStat">
          <li><b>Choose your crop</b><span>See its price across India this week.</span></li>
          <li><b>Find your mandi</b><span>By state, or search by mandi or district.</span></li>
          <li><b>Read the week’s call</b><span>Sell now or hold, with the price expected and its likely range.</span></li>
        </ol>
      </header>

      <ul className="crop-choice" aria-label="Crops">
        {meta.crops.map(c => {
          const unit = c.id === 'Arecanut' ? 'mandi-varieties' : 'mandis';
          return (
            <li key={c.id}>
              <SpotlightCard className="cp-spot" color={SPOT} size={280}>
                <button type="button" className="crop-pick" onClick={() => onCrop(c.id)}
                  aria-label={`${c.id}: India median ${rupees(c.median)} per quintal. Open`}>
                  <span className="cp-name">{c.id}</span>
                  <span className="cp-about">{ABOUT[c.id] ?? ''}</span>
                  <span className="cp-price num"><Count to={c.median} /><small>/ q</small></span>
                  <span className="cp-sub">
                    {c.median_prev ? <Delta value={c.median / c.median_prev - 1} title="Change from last week" /> : null}
                    <span>India median, week of {date(c.week)}</span>
                  </span>
                  <TrendLine values={c.trend} className="cp-trend" label={`${c.id}: India median over the last ${c.trend?.length ?? 0} weeks`} />
                  {!c.naive && c.calls && <CallsBar calls={c.calls} compact />}
                  <span className="cp-count">{c.series.toLocaleString('en-IN')} {unit} in {c.states.length}{' '}
                    {c.states.length === 1 ? 'state' : 'states'}</span>
                </button>
              </SpotlightCard>
            </li>
          );
        })}
      </ul>

      <p className="home-foot">
        Every forecast was tested on 2023–2026 prices the model never saw. <a href="#view=accuracy">See how accurate it is</a>
        {' '}or <a href="#view=about">read how it works</a>.
      </p>
    </>
  );
}
