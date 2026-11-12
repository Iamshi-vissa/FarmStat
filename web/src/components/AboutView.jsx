export default function AboutView({ meta }) {
  return (
    <div className="prose">
      <div className="page-head">
        <h1>About FarmStat</h1>
        <p>FarmStat helps farmers and traders decide where and when to sell. It covers {meta.n_mandis} mandis in {meta.n_states} states.</p>
      </div>
      <h2>What it shows</h2>
      <ul>
        <li><b>Onion, tomato and potato:</b> the expected price 1, 2 and 4 weeks ahead, a likely range, the chance of a 5%+ rise, and sell or hold advice that subtracts storage losses.</li>
        <li><b>Arecanut:</b> today’s price for each mandi and variety with the usual range of movement. No model beat “no change” for it.</li>
        <li><b>Cashew:</b> monthly state prices with a rough 3-month guide and the seasonal pattern.</li>
        <li><b>Sugarcane:</b> the government Fair and Remunerative Price, since most cane is sold to mills.</li>
      </ul>
      <h2>How it works</h2>
      <p>Gradient-boosting models learn from 23 years of weekly Agmarknet prices and arrivals: recent price moves, how much produce is arriving, national and state trends, and the season. Each forecast is pulled towards “no change” by an amount tuned on 2019–2022, because markets are noisy.</p>
      <h2>Limits</h2>
      <p>No model can foresee government decisions such as export bans. Mandis that started reporting recently are harder to forecast. Always check the day’s rate at the mandi before you sell.</p>
      <h2>Data</h2>
      <p>Prices: Agmarknet, Directorate of Marketing &amp; Inspection, Government of India (Open Government Data License – India). FRP: Cabinet Committee on Economic Affairs.</p>
    </div>
  );
}
