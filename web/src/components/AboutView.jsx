import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import LineSidebar from './reactbits/LineSidebar.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';
import CountUp from './CountUp.jsx';
import { api } from '../api.js';
import { date, pct0 } from '../format.js';
import { T } from '../theme.js';

const UPDATED = '12 November 2026';
const OWNER = 'Vamshi Bharath';
const REPO = 'https://github.com/Iamshi-vissa/FarmStat';

const SECTIONS = [
  ['overview', 'Overview'],
  ['coverage', 'What it covers'],
  ['method', 'How forecasts are made'],
  ['advice', 'Reading the advice'],
  ['data', 'Data and updates'],
  ['accuracy', 'Accuracy'],
  ['risks', 'Risks and limitations'],
  ['terms', 'Terms of use'],
  ['disclaimer', 'Disclaimer'],
  ['privacy', 'Privacy'],
  ['licences', 'Licences and credits'],
  ['contact', 'Contact']
];

function Section({ id, n, title, children }) {
  return (
    <section id={id} className="doc-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}><span className="sec-no">{String(n).padStart(2, '0')}</span>{title}</h2>
      {children}
    </section>
  );
}

const Level = ({ v }) => <span className={`level ${v.toLowerCase()}`}><i aria-hidden="true" />{v}</span>;

export default function AboutView({ meta, section, onSection }) {
  const [acc, setAcc] = useState(null);
  const [active, setActive] = useState(0);
  const spied = useRef(null);
  useEffect(() => { api('accuracy').then(setAcc).catch(() => {}); }, []);

  const weekly = meta.crops.filter(c => c.kind === 'weekly');
  const until = weekly.map(c => c.data_until).sort().at(-1);
  const series = weekly.reduce((n, c) => n + c.series, 0);

  // jump to a section when one is linked from elsewhere (e.g. "Read the risks" on the advice slip)
  useEffect(() => {
    const i = SECTIONS.findIndex(([id]) => id === section);
    if (i < 0 || spied.current === section) return;
    setActive(i);
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }));
  }, [section]);

  // highlight the section being read: the last one whose heading has passed the top third of the screen (or the last
  // section once the page is scrolled to the bottom, since short closing sections never reach the top)
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let i = 0;
      SECTIONS.forEach(([id], k) => { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= line) i = k; });
      if (atEnd) i = SECTIONS.length - 1;
      setActive(i);
      if (spied.current !== SECTIONS[i][0]) { spied.current = SECTIONS[i][0]; onSection?.(SECTIONS[i][0]); }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- onSection is App's state setter, which never changes

  const go = i => {
    setActive(i);
    document.getElementById(SECTIONS[i][0])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const H = acc?.horizons;
  return (
    <div className="doc">
      <aside className="doc-toc">
        <p className="doc-toc-title">On this page</p>
        <LineSidebar items={SECTIONS.map(s => s[1])} activeIndex={active} onItemClick={i => go(i)}
          accentColor={T.forest} textColor={T.ink3} markerColor="#cccfc8" markerLength={22} markerGap={10}
          itemGap={11} fontSize={0.875} maxShift={6} proximityRadius={60} tickScale={0.4} ariaLabel="About sections" />
        <div className="doc-meta">Last updated {UPDATED}<br />Model version {meta.version}<br />Prices to {date(until)}</div>
      </aside>

      <article className="doc-body">
        <header className="doc-hero" id="overview">
          <h1>Mandi prices, a few weeks ahead</h1>
          <p>FarmStat estimates where onion, tomato and potato prices are heading in {meta.n_mandis.toLocaleString('en-IN')} mandis
            across {meta.n_states} states, and turns the estimate into plain sell or hold advice. It is a free, open-source
            student project built on public Government of India price data.</p>
          <dl className="doc-facts">
            <div><dt>Mandis</dt><dd><CountUp to={meta.n_mandis} duration={1} separator="," /></dd></div>
            <div><dt>States</dt><dd><CountUp to={meta.n_states} duration={1} /></dd></div>
            <div><dt>Price series</dt><dd><CountUp to={series} duration={1} separator="," /></dd></div>
            <div><dt>Years of history</dt><dd><CountUp to={23} duration={1} /></dd></div>
          </dl>
        </header>

        <Section id="coverage" n={2} title="What it covers">
          <p>Each crop is handled in the way its data allows. Where a forecast couldn’t beat “no change” in testing,
            FarmStat says so and shows today’s price instead.</p>
          <div className="crop-grid">
            {[
              ['Onion, tomato, potato', 'Weekly forecast', 'Expected price 1, 2 and 4 weeks ahead with a likely range, the chance of a 5%+ rise, and sell or hold advice after storage losses.'],
              ['Arecanut', 'Price and usual range', 'Today’s price for each mandi and variety in Karnataka and Kerala, with the range real prices moved in 8 of 10 past weeks.'],
              ['Cashew', 'Rough monthly guide', 'Monthly state averages with a 1–3 month guide and the seasonal pattern. Only state-level data exists.'],
              ['Sugarcane', 'Information only', 'The Fair and Remunerative Price (FRP) set by the Government of India, since most cane is sold to mills.']
            ].map(([t, k, d]) => (
              <SpotlightCard key={t} className="crop-card" theme="light" spotlightColor="rgba(43,123,71,0.10)"
                intensity={0.5} spotlightSize={200} borderGlow={0.2} flare={false}>
                <h3>{t}<span>{k}</span></h3><p>{d}</p>
              </SpotlightCard>
            ))}
          </div>
        </Section>

        <Section id="method" n={3} title="How forecasts are made">
          <ol>
            <li><b>Collect.</b> Weekly modal prices and arrivals reported by mandis to Agmarknet since 2003.</li>
            <li><b>Clean.</b> Mandi names are matched across years, obvious typing errors (a price over 3 times the local
              9-week median) are removed, and only weeks with real reports are used.</li>
            <li><b>Describe each week.</b> 38 inputs that use only past data: recent price moves, how much produce is arriving
              compared with normal, national and state trends, the season, and how long the mandi has reported.</li>
            <li><b>Forecast.</b> Gradient-boosting models predict the price {meta.horizons.join(', ')} weeks ahead, plus a low
              and high estimate (the 10th and 90th percentiles). A separate model estimates the chance of a 5%+ rise.</li>
            <li><b>Be cautious.</b> Each forecast is pulled towards today’s price by an amount tuned on 2019–2022 data, because
              week-to-week markets are noisy.</li>
            <li><b>Test honestly.</b> The models are checked on 2023–2026 data they never saw, re-trained at the start of each
              year as they would be in real use.</li>
          </ol>
        </Section>

        <Section id="advice" n={4} title="Reading the advice">
          <p>The advice assumes you already hold the crop and can store it. It compares the expected price with today’s, after
            subtracting typical storage losses.</p>
          <ul>
            <li><b>Hold</b> — the expected price, after storage losses, is at least 4% higher within the advised weeks, and for
              2–4 weeks the chance of a rise is at least half.</li>
            <li><b>Sell now</b> — no rise big enough to cover storage losses is expected, or next week’s price is expected to
              fall by 3% or more.</li>
            <li><b>Your call</b> — the signal is too weak either way, or (for arecanut) no model beat “no change”. Sell if you need
              cash or storage is tight.</li>
            <li><b>Information</b> — shown for cashew and sugarcane, where FarmStat gives context rather than advice.</li>
          </ul>
          <p>Storage losses used: tomato 15%, onion 4%, potato 3% and arecanut 1% per 4 weeks. Tomato advice never suggests
            holding for more than 1 week.</p>
        </Section>

        <Section id="data" n={5} title="Data and updates">
          <ul>
            <li><b>Weekly prices and arrivals</b> for onion, tomato and potato: Agmarknet, through the TOP Digital Twin weekly
              panel (January 2003 onwards).</li>
            <li><b>Arecanut</b> daily prices by mandi and variety: Agmarknet, through Malabar Mandi Prices (July 2021 onwards),
              grouped into weeks.</li>
            <li><b>Cashew and sugarcane</b> monthly state averages: Agmarknet, through India Mandi Arrivals.</li>
            <li><b>Sugarcane FRP</b>: decisions of the Cabinet Committee on Economic Affairs.</li>
          </ul>
          <p>FarmStat is not live. Prices currently run to the week of {date(until)} and are refreshed when the data and the
            forecast snapshot are rebuilt. The date of the latest price is shown on every mandi, so check it before you rely
            on a forecast.</p>
        </Section>

        <Section id="accuracy" n={6} title="Accuracy">
          {H ? (
            <>
              <p>On {acc.test_period.replace(' to ', ' to ')} data, two weeks ahead, the forecasts were off by about
                ₹{Math.round(H['2'].MAE_Rs).toLocaleString('en-IN')} a quintal on average — {pct0(H['2'].skill_vs_naive)} less
                error than assuming the price stays the same. They got the direction right {pct0(H['2'].direction_acc)} of the
                time when the price moved more than 2%.</p>
              <p>Gains are bigger for established mandis than for new ones; for onion in mandis that started reporting after
                2020, the forecast did slightly worse than “no change”. The full breakdown is on the Model accuracy tab.</p>
            </>
          ) : <p>Loading test results…</p>}
        </Section>

        <Section id="risks" n={7} title="Risks and limitations">
          <div className="doc-callout"><AlertTriangle size={18} aria-hidden="true" />
            <p><strong>Prices can move against any forecast.</strong> FarmStat gives estimates based on past patterns. A
              decision to hold or sell can lose money, and storing produce has its own risks.</p>
          </div>
          <table className="risk-table">
            <thead><tr><th scope="col">Risk</th><th scope="col">What can happen</th><th scope="col">Level</th></tr></thead>
            <tbody>
              <tr><td>Government decisions</td><td>Export bans, duties, stock limits or procurement can move prices overnight.
                The model cannot see these coming.</td><td><Level v="High" /></td></tr>
              <tr><td>Weather and crop damage</td><td>Heavy rain, heat or floods change supply quickly. Weather is not one of the
                model’s inputs.</td><td><Level v="High" /></td></tr>
              <tr><td>Your price is not the modal price</td><td>Quality, grade, moisture, lot size, commission, hamali and transport
                all change what you are paid. The modal price is the most common price, not a promise.</td><td><Level v="Medium" /></td></tr>
              <tr><td>Storage losses</td><td>Weight loss, rot, pests and the cost of credit can exceed the typical losses the advice
                assumes, especially for tomato.</td><td><Level v="Medium" /></td></tr>
              <tr><td>Late or wrong data</td><td>Mandi reports can be delayed, missing or mistyped. Obvious errors are removed, but
                some remain, and the latest week may be weeks old.</td><td><Level v="Medium" /></td></tr>
              <tr><td>New mandis</td><td>Mandis with under 3 years of history are harder to forecast. They are marked “new” and
                their forecasts stay close to today’s price.</td><td><Level v="Medium" /></td></tr>
              <tr><td>Ranges that are too narrow</td><td>The 4-week likely range contained the real price about 2 times in 3, not
                the intended 4 in 5.</td><td><Level v="Medium" /></td></tr>
              <tr><td>Changing markets</td><td>Patterns learned from the past can stop holding. Models are re-trained yearly, not
                continuously.</td><td><Level v="Low" /></td></tr>
            </tbody>
          </table>
          <h3>Using FarmStat safely</h3>
          <ul>
            <li>Check the day’s rate at the mandi, or with your commission agent, before you sell.</li>
            <li>Compare two or three nearby mandis, after transport costs, using the Compare mandis tab.</li>
            <li>Only hold if you have safe storage and don’t need the cash. Selling part of a lot spreads the risk.</li>
            <li>Look at the likely range, not just the expected price: the low end is a realistic bad case.</li>
          </ul>
        </Section>

        <Section id="terms" n={8} title="Terms of use">
          <p>Effective {UPDATED}. These terms apply to the FarmStat website and API (“FarmStat”), run by {OWNER} (“we”). By
            using FarmStat you agree to them. If you don’t agree, please don’t use it.</p>
          <ol className="clauses">
            <li data-sec="8"><b>What FarmStat is.</b> An information tool that publishes statistical estimates of agricultural
              market prices. It is not a broker, trading platform or commission agent, and it does not buy or sell produce.</li>
            <li data-sec="8"><b>Not official.</b> FarmStat is independent. It is not run by, endorsed by or affiliated with
              Agmarknet, the Directorate of Marketing &amp; Inspection, any APMC or the Government of India. Forecasts are not
              official prices.</li>
            <li data-sec="8"><b>No advice.</b> Nothing on FarmStat is financial, investment, trading or agricultural advice.
              Labels such as “Hold” and “Sell now” are general model outputs, not recommendations made for your situation.</li>
            <li data-sec="8"><b>Your decisions.</b> You are responsible for your own decisions to sell, hold, buy or transport
              produce, and for checking current prices, quality requirements, charges and rules before acting.</li>
            <li data-sec="8"><b>Accuracy and availability.</b> FarmStat is provided “as is” and “as available”. We do not promise
              that forecasts, prices or other content are accurate, complete or up to date, or that the service will be
              available without interruption. We may change, suspend or withdraw any part of it at any time.</li>
            <li data-sec="8"><b>Limitation of liability.</b> To the fullest extent allowed by law, we are not liable for any loss
              or damage — including lost income, lower sale prices, spoilage or storage costs — arising from use of, or
              reliance on, FarmStat.</li>
            <li data-sec="8"><b>Acceptable use.</b> Don’t overload the service with automated requests, try to break its security,
              or present its forecasts as official or guaranteed prices. Reasonable use of the API for personal, research or
              educational purposes is welcome.</li>
            <li data-sec="8"><b>Content and licences.</b> The source code is available under the MIT License. Price data belongs to
              the Government of India and is used under the Open Government Data License – India. You may quote FarmStat’s
              forecasts if you credit FarmStat and Agmarknet and say they are estimates.</li>
            <li data-sec="8"><b>Other websites.</b> FarmStat links to and is hosted by third parties. We are not responsible for
              their content or practices.</li>
            <li data-sec="8"><b>Changes.</b> We may update these terms. The date above shows the latest version, and using
              FarmStat after a change means you accept the updated terms.</li>
            <li data-sec="8"><b>Law.</b> These terms are governed by the laws of India.</li>
          </ol>
        </Section>

        <Section id="disclaimer" n={9} title="Disclaimer">
          <p>FarmStat’s forecasts are produced automatically by statistical models from historical data. They are estimates of
            what may happen, not predictions that will come true, and past accuracy does not guarantee future accuracy. Always
            confirm prices at the mandi before you sell. FarmStat is an educational project and has not been reviewed by any
            regulator or government body.</p>
        </Section>

        <Section id="privacy" n={10} title="Privacy">
          <ul>
            <li>FarmStat has no accounts and does not ask for your name, phone number or location.</li>
            <li>It sets no advertising or tracking cookies. Your browser remembers only that you closed the welcome notice.</li>
            <li>The crop, state and mandi you choose are kept in the page address so you can bookmark or share it.</li>
            <li>The hosting provider keeps standard server logs, such as IP address and pages requested, to run and protect the
              service.</li>
          </ul>
        </Section>

        <Section id="licences" n={11} title="Licences and credits">
          <ul>
            <li>Price data: Agmarknet, Directorate of Marketing &amp; Inspection, Ministry of Agriculture &amp; Farmers Welfare,
              Government of India, under the Open Government Data License – India.</li>
            <li>Data preparation: TOP Digital Twin, Malabar Mandi Prices and India Mandi Arrivals projects on GitHub.</li>
            <li>Interface components: React Bits by David Haz (MIT + Commons Clause), Recharts, Lucide icons, Archivo typeface
              (SIL Open Font License).</li>
            <li>FarmStat source code: MIT License, © 2026 {OWNER}.</li>
          </ul>
        </Section>

        <Section id="contact" n={12} title="Contact">
          <p>Found a wrong price, a bug or a mandi that’s missing? Open an issue on <a href={`${REPO}/issues`} target="_blank"
            rel="noreferrer">GitHub</a>. The full code, training notebook and test results are in the{' '}
            <a href={REPO} target="_blank" rel="noreferrer">FarmStat repository</a>.</p>
        </Section>

        <p className="doc-end">FarmStat {meta.version}. Last updated {UPDATED}.</p>
      </article>
    </div>
  );
}
