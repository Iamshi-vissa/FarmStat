import Delta from './Delta.jsx';
import { date, rupees } from '../format.js';
import { T } from '../theme.js';
import { Count } from './RateBoard.jsx';
import BlurText from './reactbits/BlurText.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';

const ABOUT = {
  Onion: 'Forecast 1, 2 and 4 weeks ahead, with sell or hold advice',
  Tomato: 'Forecast 1, 2 and 4 weeks ahead; tomatoes are never held more than a week',
  Potato: 'Forecast 1, 2 and 4 weeks ahead, with sell or hold advice',
  Arecanut: 'Today’s price by variety, with its usual range of movement',
};

// The first page: nothing is chosen yet. Four crops on one ruled board, each with this week's India median.
export default function HomeView({ meta, onCrop }) {
  return (
    <>
      <header className="home-head">
        <BlurText as="h1" text="Which crop are you selling?" />
        <p>FarmStat estimates where mandi prices are heading in {meta.n_mandis.toLocaleString('en-IN')} mandis across{' '}
          {meta.n_states} states, and says whether to sell now or hold. Choose a crop to see it across India, then pick
          your mandi.</p>
      </header>

      <ul className="crop-choice" aria-label="Crops">
        {meta.crops.map(c => (
          <li key={c.id}>
            <SpotlightCard className="cp-spot" theme="light" spotlightColor={T.forecast} intensity={0.55} spotlightSize={260}
              borderGlow={0} proximity={0}>
            <button type="button" className="crop-pick" onClick={() => onCrop(c.id)}
              aria-label={`${c.id}: India median ${rupees(c.median)} per quintal. Open`}>
              <span className="cp-name">{c.id}</span>
              <span className="cp-about">{ABOUT[c.id] ?? ''}</span>
              <span className="cp-price num"><Count to={c.median} /><small>/ q</small></span>
              <span className="cp-sub">
                {c.median_prev ? <Delta value={c.median / c.median_prev - 1} title="Change from last week" /> : null}
                <span>India median, week of {date(c.week)}</span>
              </span>
              <span className="cp-count">{c.series.toLocaleString('en-IN')} {c.id === 'Arecanut' ? 'mandi-varieties' : 'mandis'} in{' '}
                {c.states.length} {c.states.length === 1 ? 'state' : 'states'}</span>
            </button>
            </SpotlightCard>
          </li>
        ))}
      </ul>

      <p className="home-foot">
        Every forecast was tested on 2023–2026 prices the model never saw. <a href="#view=accuracy">See how accurate it is</a>
        {' '}or <a href="#view=about">read how it works</a>.
      </p>
    </>
  );
}
