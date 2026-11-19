import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import LineSidebar from './reactbits/LineSidebar.jsx';
import { date } from '../format.js';
import { T } from '../theme.js';

const UPDATED = '18 November 2026';
const OWNER = 'Vamshi Bharath';
const REPO = 'https://github.com/Iamshi-vissa/FarmStat';

const SECTIONS = [
  ['overview', 'Overview'],
  ['method', 'How forecasts are made'],
  ['advice', 'Reading the advice'],
  ['data', 'Data and updates'],
  ['risks', 'Risks and limitations'],
  ['terms', 'Terms and disclaimer'],
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
  const [active, setActive] = useState(0);
  const spied = useRef(null);
  const until = meta.crops.map(c => c.data_until).sort().at(-1);
  const series = meta.crops.reduce((n, c) => n + c.series, 0);
  const fmt = n => n.toLocaleString('en-IN');

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

  return (
    <div className="doc">
      <aside className="doc-toc">
        <p className="doc-toc-title">On this page</p>
        <LineSidebar items={SECTIONS.map(s => s[1])} activeIndex={active} onItemClick={i => go(i)}
          accentColor={T.forest} textColor={T.ink3} markerColor="#d4d9d3" markerLength={22} markerGap={10}
          itemGap={11} fontSize={0.875} maxShift={6} proximityRadius={60} tickScale={0.4} ariaLabel="About sections" />
        <div className="doc-meta">Last updated {UPDATED}<br />Model version {meta.version}<br />Prices to {date(until)}</div>
      </aside>

      <article className="doc-body">
        <header className="doc-hero" id="overview">
          <h1>Mandi prices, a few weeks ahead</h1>
          <p>FarmStat estimates where onion, tomato and potato prices are heading in {fmt(meta.n_mandis)} mandis across{' '}
            {meta.n_states} states, and turns the estimate into plain sell or hold advice. It is a free, open-source student
            project built on public Government of India price data.</p>
          <dl className="doc-facts">
            <div><dt>Mandis</dt><dd>{fmt(meta.n_mandis)}</dd></div>
            <div><dt>States</dt><dd>{meta.n_states}</dd></div>
            <div><dt>Price series</dt><dd>{fmt(series)}</dd></div>
            <div><dt>Years of history</dt><dd>23</dd></div>
          </dl>
        </header>
        <div className="crop-grid">
          <div className="crop-card"><h3>Onion, tomato, potato<span>Weekly forecast</span></h3>
            <p>Expected price 1, 2 and 4 weeks ahead with a likely range, the chance of a 5%+ rise, and sell or hold advice
              after storage losses.</p></div>
          <div className="crop-card"><h3>Arecanut<span>Price and usual range</span></h3>
            <p>Today’s price for each mandi and variety in Karnataka and Kerala, with the range real prices moved in 8 of 10
              past weeks. No model beat “no change” for arecanut, so it gets no forecast.</p></div>
        </div>

        <Section id="method" n={2} title="How forecasts are made">
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
            <li><b>Calibrate the range.</b> The likely range is widened by what earlier years’ misses call for, so it holds the
              real price about 8 weeks in 10.</li>
            <li><b>Test honestly.</b> The models are checked on 2023–2026 data they never saw, retrained at the start of each
              year as they would be in real use. The results are on the <a href="#view=accuracy">Model accuracy</a> page.</li>
          </ol>
        </Section>

        <Section id="advice" n={3} title="Reading the advice">
          <p>The advice assumes you already hold the crop and can store it. It compares the expected price with today’s, after
            subtracting typical storage losses.</p>
          <ul>
            <li><b>Hold</b> — the expected price, after storage losses, is at least 4% higher within the advised weeks, and for
              2–4 weeks the chance of a rise is at least half.</li>
            <li><b>Sell now</b> — no rise big enough to cover storage losses is expected, or next week’s price is expected to
              fall by 3% or more.</li>
            <li><b>Your call</b> — the signal is too weak either way, or (for arecanut) no model beat “no change”. Sell if you need
              cash or storage is tight.</li>
          </ul>
          <p>Storage losses used: tomato 15%, onion 4%, potato 3% and arecanut 1% per 4 weeks. Tomato advice never suggests
            holding for more than 1 week.</p>
        </Section>

        <Section id="data" n={4} title="Data and updates">
          <ul>
            <li><b>History:</b> weekly prices and arrivals for onion, tomato and potato from Agmarknet, through the TOP Digital
              Twin weekly panel (January 2003 onwards), and arecanut prices by mandi and variety through Malabar Mandi Prices
              (July 2021 onwards).</li>
            <li><b>Live prices:</b> FarmStat checks Agmarknet’s daily feed on data.gov.in three times a day. Each mandi page
              shows its latest daily report.</li>
            <li><b>Forecasts:</b> rebuilt every evening from the latest weekly prices. The models are retrained each week and
              the new version is used only if it tests better on weeks it hasn’t seen.</li>
          </ul>
          <p>Weekly prices currently run to the week of {date(until)}. Every mandi shows the date of its latest price, so check
            it before you rely on a forecast.</p>
        </Section>

        <Section id="risks" n={5} title="Risks and limitations">
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
              <tr><td>Prices outside the range</td><td>The likely range is built to hold the real price about 8 weeks in 10, so
                roughly 1 week in 5 the price lands outside it.</td><td><Level v="Medium" /></td></tr>
              <tr><td>Changing markets</td><td>Patterns learned from the past can stop holding. A retrained model replaces the
                current one only when it tests better.</td><td><Level v="Low" /></td></tr>
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

        <Section id="terms" n={6} title="Terms and disclaimer">
          <p>FarmStat’s forecasts are produced automatically by statistical models from historical data. They are estimates of
            what may happen, not predictions that will come true, and past accuracy does not guarantee future accuracy. Always
            confirm prices at the mandi before you sell. FarmStat is an educational project and has not been reviewed by any
            regulator or government body.</p>
          <p>Effective {UPDATED}. These terms apply to the FarmStat website and API (“FarmStat”), run by {OWNER} (“we”). By
            using FarmStat you agree to them. If you don’t agree, please don’t use it.</p>
          <ol className="clauses">
            <li data-sec="6"><b>What FarmStat is.</b> An information tool that publishes statistical estimates of agricultural
              market prices. It is not a broker, trading platform or commission agent, and it does not buy or sell produce.</li>
            <li data-sec="6"><b>Not official.</b> FarmStat is independent. It is not run by, endorsed by or affiliated with
              Agmarknet, the Directorate of Marketing &amp; Inspection, any APMC or the Government of India. Forecasts are not
              official prices.</li>
            <li data-sec="6"><b>No advice.</b> Nothing on FarmStat is financial, investment, trading or agricultural advice.
              Labels such as “Hold” and “Sell now” are general model outputs, not recommendations made for your situation.</li>
            <li data-sec="6"><b>Your decisions.</b> You are responsible for your own decisions to sell, hold, buy or transport
              produce, and for checking current prices, quality requirements, charges and rules before acting.</li>
            <li data-sec="6"><b>Accuracy and availability.</b> FarmStat is provided “as is” and “as available”. We do not promise
              that forecasts, prices or other content are accurate, complete or up to date, or that the service will be
              available without interruption. We may change, suspend or withdraw any part of it at any time.</li>
            <li data-sec="6"><b>Limitation of liability.</b> To the fullest extent allowed by law, we are not liable for any loss
              or damage — including lost income, lower sale prices, spoilage or storage costs — arising from use of, or
              reliance on, FarmStat.</li>
            <li data-sec="6"><b>Acceptable use.</b> Don’t overload the service with automated requests, try to break its security,
              or present its forecasts as official or guaranteed prices. Reasonable use of the API for personal, research or
              educational purposes is welcome.</li>
            <li data-sec="6"><b>Content and licences.</b> The source code is available under the MIT License. Price data belongs to
              the Government of India and is used under the Open Government Data License – India. You may quote FarmStat’s
              forecasts if you credit FarmStat and Agmarknet and say they are estimates.</li>
            <li data-sec="6"><b>Other websites.</b> FarmStat links to and is hosted by third parties. We are not responsible for
              their content or practices.</li>
            <li data-sec="6"><b>Changes.</b> We may update these terms. The date above shows the latest version, and using
              FarmStat after a change means you accept the updated terms.</li>
            <li data-sec="6"><b>Law.</b> These terms are governed by the laws of India.</li>
          </ol>
        </Section>

        <Section id="privacy" n={7} title="Privacy">
          <ul>
            <li>FarmStat has no accounts and does not ask for your name, phone number or location.</li>
            <li>It sets no advertising or tracking cookies. Your browser remembers only that you closed the welcome notice and
              whether you pinned the side panel open.</li>
            <li>The crop, state and mandi you choose are kept in the page address so you can bookmark or share it.</li>
            <li>The hosting provider keeps standard server logs, such as IP address and pages requested, to run and protect the
              service.</li>
          </ul>
        </Section>

        <Section id="licences" n={8} title="Licences and credits">
          <ul>
            <li>Price data: Agmarknet, Directorate of Marketing &amp; Inspection, Ministry of Agriculture &amp; Farmers Welfare,
              Government of India, under the Open Government Data License – India.</li>
            <li>Data preparation: TOP Digital Twin and Malabar Mandi Prices projects on GitHub. Live prices: data.gov.in.</li>
            <li>Interface components: React Bits by David Haz (MIT + Commons Clause), Recharts, Lucide icons, Archivo typeface
              (SIL Open Font License).</li>
            <li>FarmStat source code: MIT License, © 2026 {OWNER}.</li>
          </ul>
        </Section>

        <Section id="contact" n={9} title="Contact">
          <p>Found a wrong price, a bug or a mandi that’s missing? Open an issue on <a href={`${REPO}/issues`} target="_blank"
            rel="noreferrer">GitHub</a>. The full code, training notebook and test results are in the{' '}
            <a href={REPO} target="_blank" rel="noreferrer">FarmStat repository</a>.</p>
        </Section>

        <p className="doc-end">FarmStat {meta.version}. Last updated {UPDATED}.</p>
      </article>
    </div>
  );
}
