// FarmStat 10-slide deck (editable .pptx). Numbers come from reports/evaluation.json and models/metrics.json.
// Run from the repo root: npm i pptxgenjs && node docs/deck/build_presentation.js  (writes docs/FarmStat_presentation.pptx)
// The theme colours are written by applyTheme from Anthropic's pptx skill when SKILL points at it; without it the deck
// still builds, with Office's stock theme colours for scheme-coloured items.
const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const applyTheme = process.env.SKILL ? require(process.env.SKILL + '/scripts/apply_theme.js').applyTheme : async () => {};

const REPO = path.resolve(__dirname, '../..');
const ev = JSON.parse(fs.readFileSync(`${REPO}/reports/evaluation.json`));
const mx = JSON.parse(fs.readFileSync(`${REPO}/models/metrics.json`));
const H = ev.horizons;
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const rs = v => `₹${Math.round(v).toLocaleString('en-US')}`;

const THEME = {
  name: 'FarmStat Forest', headFontFace: 'Cambria', bodyFontFace: 'Calibri',
  colors: { dk1: '242620', lt1: 'FFFFFF', dk2: '0C361B', lt2: 'EEFBF1', accent1: '2B7B47', accent2: '2A78D6',
    accent3: 'C2410C', accent4: '6BB781', accent5: 'A3A69E', accent6: 'F5EAD1', hlink: '2A78D6', folHlink: '1D6136' },
};
const HEX = { ink: '242620', ink2: '4E514A', ink3: '63665F', grid: 'E2E4DE', forest: '2B7B47', forest9: '0C361B',
  forest95: '062511', blue: '2A78D6', rust: 'C2410C', grey: 'A3A69E', chalk: 'F5EAD1', mint: 'EEFBF1', slip: 'F9F0DA' };

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';   // 10 x 5.625 in
pres.title = 'FarmStat: forecasting mandi prices';
pres.author = 'Iamshi-vissa';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

pres.defineSlideMaster({
  title: 'FS Dark', background: { color: HEX.forest95 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 1.5, w: 8.8, h: 1.5, fontSize: 40, bold: true,
      color: HEX.chalk, valign: 'bottom', fontFace: 'Cambria' }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.6, y: 3.15, w: 8.2, h: 1.2, fontSize: 18,
      color: 'BFE6C8', valign: 'top' }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'FS Content', background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.35, w: 9, h: 0.55, fontSize: 24, bold: true,
      color: HEX.forest9, valign: 'top', align: 'left', fontFace: 'Cambria', margin: 0 }, text: '' } },
    { text: { text: 'FarmStat  |  ML course project', options: { x: 0.5, y: 5.25, w: 5, h: 0.25, fontSize: 9, color: HEX.ink3, margin: 0 } } },
  ],
  slideNumber: { x: 9.1, y: 5.25, w: 0.4, h: 0.25, fontSize: 9, color: HEX.ink3, align: 'right' },
});

const sub = (s, text, y = 0.98) => s.addText(text, { x: 0.5, y, w: 9, h: 0.45, fontSize: 14, color: HEX.ink2, margin: 0, isTextBox: true, objectName: 'subtitle' });
const stat = (s, x, y, w, big, label, color = HEX.forest, name) => {
  s.addText(big, { x, y, w, h: 0.75, fontSize: 36, bold: true, color, fontFace: 'Cambria', margin: 0, isTextBox: true, objectName: `${name}-value` });
  s.addText(label, { x, y: y + 0.75, w, h: 0.55, fontSize: 12, color: HEX.ink2, margin: 0, valign: 'top', isTextBox: true, objectName: `${name}-label` });
};
const card = (s, x, y, w, h, name, fill = HEX.mint) => s.addShape(pres.shapes.ROUNDED_RECTANGLE,
  { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: fill, width: 0.5 }, objectName: name });
const axisText = { catAxisLabelColor: HEX.ink3, valAxisLabelColor: HEX.ink3, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt',
  catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontFace: '+mn-lt', dataLabelFontSize: 11, dataLabelColor: HEX.ink,
  valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: 'none' }, legendFontFace: '+mn-lt', legendFontSize: 11,
  titleFontFace: '+mn-lt', titleFontSize: 12, titleColor: HEX.ink };

// 1. Title ------------------------------------------------------------------------------------------------------
pres.addSection({ title: 'Opening' });
let s = pres.addSlide({ masterName: 'FS Dark', sectionTitle: 'Opening' });
s.addText('FarmStat', { placeholder: 'title' });
s.addText('Weekly mandi price forecasts and a sell-or-hold call for onion, tomato and potato farmers across 24 Indian states', { placeholder: 'body' });
s.addText('Machine learning course project  |  github.com/Iamshi-vissa/FarmStat', { x: 0.6, y: 4.75, w: 8.8, h: 0.35, fontSize: 12, color: HEX.grey, margin: 0, isTextBox: true, objectName: 'byline' });
s.addNotes('FarmStat forecasts mandi prices 1, 2 and 4 weeks ahead and turns them into a plain call. This talk covers the data, the model, how it was validated, and the app.');

// 2. Problem ----------------------------------------------------------------------------------------------------
pres.addSection({ title: 'Problem and data' });
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Problem and data' });
s.addText('Every farmer faces one decision: sell today or hold', { placeholder: 'title' });
sub(s, 'Prices swing within weeks, and the only guide is today\'s rate board');
stat(s, 0.5, 1.65, 2.7, '~980', 'mandis with weekly prices, in 24 states', HEX.forest, 'mandis');
stat(s, 0.5, 2.95, 2.7, '3', 'questions FarmStat answers: where is the price going, how sure, and what to do', HEX.forest, 'questions');
s.addImage({ path: path.join(__dirname, 'market_crop.png'), x: 3.95, y: 1.55, w: 3.55 * 1128 / 760, h: 3.55, objectName: 'app-screenshot', altText: 'FarmStat mandi page: rate board, sell or hold slip, forecast tiles' });
s.addNotes('Onion can double or halve in a season; tomato spoils in days. The app adds a forecast with a range, the chance of a real rise, and a call on a paper slip.');

// 3. Data -------------------------------------------------------------------------------------------------------
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Problem and data' });
s.addText('23 years of Agmarknet prices, plus a live daily feed', { placeholder: 'title' });
sub(s, `${mx.n_rows.toLocaleString('en-US')} weekly rows from ${mx.n_series.toLocaleString('en-US')} series, Jan 2003 to Jul 2026, real reports only`);
const rows = [
  ['Source', 'What it gives', 'Coverage'],
  ['Agmarknet weekly panel', 'Modal price and arrivals per mandi', 'Onion, tomato, potato, 2003 to 2026'],
  ['Agmarknet monthly', 'State average prices', 'Cashew, 5 states, 2019 to 2026'],
  ['Government (CCEA)', 'Fair and Remunerative Price', 'Sugarcane, yearly'],
  ['data.gov.in daily feeds', 'Min, max, modal price per day', 'All six crops, live since Nov 2026'],
].map((r, i) => r.map(t => ({ text: t, options: i === 0 ? { bold: true, color: 'FFFFFF', fill: { color: HEX.forest9 } } : { color: HEX.ink } })));
s.addTable(rows, { x: 0.5, y: 1.6, w: 9, colW: [2.4, 3.3, 3.3], fontSize: 13, border: { type: 'solid', pt: 0.5, color: HEX.grid }, rowH: 0.42, objectName: 'sources-table' });
card(s, 0.5, 3.95, 9, 0.95, 'cleaning-card');
s.addText([{ text: 'Cleaning: ', options: { bold: true, color: HEX.forest9 } },
  { text: 'typing errors removed (a price ten times its neighbours that snaps back), real spikes kept, mandi names standardised so a live "Lasalgaon APMC" joins 20 years of Lasalgaon history.', options: { color: HEX.ink } }],
  { x: 0.7, y: 4.02, w: 8.6, h: 0.8, fontSize: 13, margin: 0, valign: 'middle', isTextBox: true, objectName: 'cleaning-text' });

// 4. Model ------------------------------------------------------------------------------------------------------
pres.addSection({ title: 'Model' });
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Model' });
s.addText('One model learns from all 1,414 series at once', { placeholder: 'title' });
sub(s, 'Quantile gradient boosting gives the forecast and its range; guards keep weak signals cautious');
const steps = [
  ['38 features', 'Price returns, distance from averages, volatility, arrivals, national and state moves, season'],
  ['Quantile models', '10th, 50th and 90th percentile of the log return, for 1, 2 and 4 weeks ahead'],
  ['Rise classifier', 'Chance of a 5%+ rise within 2 weeks'],
  ['Guards', 'Median shrunk 0.8 toward no change; 4-week warm-up after a reporting gap'],
  ['The call', 'Sell now, hold, or no clear signal, with the likely range'],
];
const bw = 1.7, gap = 0.125;
steps.forEach(([head, body], i) => {
  const x = 0.5 + i * (bw + gap), last = i === steps.length - 1;
  card(s, x, 1.75, bw, 2.55, `step-${i + 1}-card`, last ? HEX.forest9 : HEX.mint);
  s.addText(head, { x: x + 0.12, y: 1.88, w: bw - 0.24, h: 0.5, fontSize: 15, bold: true, color: last ? HEX.chalk : HEX.forest9, margin: 0, fontFace: 'Cambria', isTextBox: true, objectName: `step-${i + 1}-head` });
  s.addText(body, { x: x + 0.12, y: 2.42, w: bw - 0.24, h: 1.8, fontSize: 12, color: last ? 'BFE6C8' : HEX.ink2, margin: 0, valign: 'top', isTextBox: true, objectName: `step-${i + 1}-body` });
  if (!last) s.addShape(pres.shapes.ISOSCELES_TRIANGLE, { x: x + bw - 0.005, y: 2.97, w: 0.14, h: 0.12, rotate: 90, fill: { color: HEX.grey }, line: { color: HEX.grey }, objectName: `arrow-${i + 1}`, flipH: false });
});
s.addText('Tuned: learning rate 0.03, 15 leaves per tree, at least 1,000 rows per leaf. Arecanut, cashew and sugarcane get no forecast model where none beat "no change".',
  { x: 0.5, y: 4.5, w: 9, h: 0.55, fontSize: 12, color: HEX.ink2, margin: 0, isTextBox: true, objectName: 'tuning-note' });

// 5. Validation design ------------------------------------------------------------------------------------------
pres.addSection({ title: 'Validation' });
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Validation' });
s.addText('Tested as it would be used: retrained every January', { placeholder: 'title' });
sub(s, 'Walk-forward test: each year is forecast by models that only saw outcomes known before it began');
const years = [2022, 2023, 2024, 2025, 2026];
const x0 = 1.9, x1 = 9.5, yw = (x1 - x0 - 0.66) / years.length;
s.addText('Train on 2003 up to', { x: 0.5, y: 1.62, w: 1.3, h: 0.3, fontSize: 10, color: HEX.ink3, margin: 0, isTextBox: true, objectName: 'axis-note' });
years.forEach((yr, i) => {
  const y = 1.95 + i * 0.5;
  s.addText(String(yr), { x: 0.5, y, w: 1.2, h: 0.38, fontSize: 13, bold: true, color: HEX.ink, margin: 0, valign: 'middle', isTextBox: true, objectName: `year-${yr}` });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x0, y: y + 0.04, w: yw * i + 0.02 + 0.6, h: 0.3, rectRadius: 0.05, fill: { color: 'D8DBD3' }, line: { color: 'D8DBD3' }, objectName: `train-${yr}` });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x0 + yw * i + 0.66, y: y + 0.04, w: yw - 0.1, h: 0.3, rectRadius: 0.05,
    fill: { color: i === 0 ? HEX.grey : HEX.blue }, line: { color: i === 0 ? HEX.grey : HEX.blue }, objectName: `test-${yr}` });
  s.addText(i === 0 ? 'calibrate ranges' : `test ${yr}`, { x: x0 + yw * i + 0.66, y: y + 0.04, w: yw - 0.1, h: 0.3, fontSize: 10, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle', margin: 0, isTextBox: true, objectName: `test-label-${yr}` });
});
s.addText([{ text: 'Grey: training data.  Blue: forecast weeks never seen in training.  ', options: { color: HEX.ink2 } },
  { text: `Benchmark: "no change" (next price = today's). ${(H['2'].rows).toLocaleString('en-US')} mandi-weeks tested at 2 weeks ahead.`, options: { color: HEX.ink2 } }],
  { x: 0.5, y: 4.55, w: 9, h: 0.5, fontSize: 12, margin: 0, isTextBox: true, objectName: 'legend-note' });

// 6. Accuracy ---------------------------------------------------------------------------------------------------
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Validation' });
s.addText(`Beats "no change" at every horizon, by ${pct(H['2'].skill_vs_naive, 0)} at 2 weeks`, { placeholder: 'title' });
sub(s, 'Average error in rupees per quintal on 2023 to 2026, onion, tomato and potato, every mandi');
const hs = ['1', '2', '4'];
s.addChart(pres.charts.BAR, [
  { name: 'No change', labels: hs.map(h => `${h} week${h === '1' ? '' : 's'}`), values: hs.map(h => Math.round(H[h].naive_MAE_Rs)) },
  { name: 'FarmStat', labels: hs.map(h => `${h} week${h === '1' ? '' : 's'}`), values: hs.map(h => Math.round(H[h].MAE_Rs)) },
], { x: 0.5, y: 1.5, w: 5.4, h: 3.6, barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 60, chartColors: [HEX.grey, HEX.blue],
  showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '₹#,##0', valAxisLabelFormatCode: '₹#,##0', showLegend: true, legendPos: 'b',
  showTitle: true, title: 'Average error, ₹ per quintal', ...axisText, objectName: 'mae-chart' });
const statRows = [
  [pct(H['2'].skill_vs_naive), 'less error than "no change", 2 weeks ahead'],
  [pct(H['2'].direction_acc, 0), 'direction right when the price moved more than 2%'],
  [ev.rise_warning.roc_auc.toFixed(2), 'ROC-AUC of the rise warning (0.5 = guessing)'],
];
statRows.forEach(([v, l], i) => stat(s, 6.3, 1.55 + i * 1.18, 3.2, v, l, i === 2 ? HEX.forest : HEX.blue, `acc-stat-${i + 1}`));

// 7. Is it real -------------------------------------------------------------------------------------------------
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Validation' });
s.addText('The gain is real at 1 and 2 weeks, weaker at 4', { placeholder: 'title' });
sub(s, 'Diebold-Mariano test (Newey-West variance) and a 95% block bootstrap over weeks');
const dmRows = [['Ahead', 'Less error', '95% interval', 'DM p-value']].concat(hs.map(h => [
  `${h} week${h === '1' ? '' : 's'}`, pct(H[h].skill_vs_naive), `${pct(H[h].skill_95ci[0])} to ${pct(H[h].skill_95ci[1])}`,
  H[h].diebold_mariano.p_value < 0.001 ? '< 0.001' : H[h].diebold_mariano.p_value.toFixed(3)]))
  .map((r, i) => r.map(t => ({ text: t, options: i === 0 ? { bold: true, color: 'FFFFFF', fill: { color: HEX.forest9 } } : { color: HEX.ink } })));
s.addTable(dmRows, { x: 0.5, y: 1.6, w: 4.6, colW: [0.9, 1.05, 1.6, 1.05], fontSize: 12, border: { type: 'solid', pt: 0.5, color: HEX.grid }, rowH: 0.42, objectName: 'dm-table' });
s.addText('The bootstrap intervals stay above zero at every horizon, but the stricter Diebold-Mariano test only confirms 1 and 2 weeks. The gain also varies by year: 2025, when hundreds of new mandis joined, was barely above zero.',
  { x: 0.5, y: 3.4, w: 4.6, h: 1.4, fontSize: 13, color: HEX.ink2, margin: 0, valign: 'top', isTextBox: true, objectName: 'dm-note' });
const byYear = ev.by_year.filter(r => ev.test_years.includes(+r.group));
s.addChart(pres.charts.BAR, [{ name: 'Skill at 2 weeks', labels: byYear.map(r => r.group), values: byYear.map(r => +(r.skill_vs_naive * 100).toFixed(1)) }],
  { x: 5.4, y: 1.5, w: 4.1, h: 3.6, barDir: 'col', chartColors: [HEX.forest], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.0"%"',
    valAxisLabelFormatCode: '0"%"', showLegend: false, showTitle: true, title: 'Less error than "no change", by year (2 weeks)', ...axisText, objectName: 'year-chart' });

// 8. Calibration ------------------------------------------------------------------------------------------------
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Validation' });
s.addText('Calibrated ranges now hold the price 80% of the time', { placeholder: 'title' });
sub(s, 'Left: share of weeks the real price fell inside the 10th to 90th percentile range. Right: does a 40% warning mean 40%?');
s.addChart(pres.charts.BAR, [
  { name: 'Model range', labels: hs.map(h => `${h} wk`), values: hs.map(h => Math.round(H[h].coverage_10_90 * 100)) },
  { name: 'Recalibrated', labels: hs.map(h => `${h} wk`), values: hs.map(h => Math.round(H[h].coverage_10_90_conformal * 100)) },
], { x: 0.5, y: 1.5, w: 4.4, h: 3.6, barDir: 'col', barGrouping: 'clustered', chartColors: [HEX.grey, HEX.forest], showValue: true,
  dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"', valAxisMinVal: 0, valAxisMaxVal: 100, valAxisLabelFormatCode: '0"%"',
  showLegend: true, legendPos: 'b', showTitle: true, title: 'Range coverage (target 80%)', ...axisText, objectName: 'coverage-chart' });
const rel = ev.rise_warning.reliability;
s.addChart(pres.charts.SCATTER, [
  { name: 'Predicted', values: rel.map(b => +(b.predicted * 100).toFixed(1)) },
  { name: 'Observed', values: rel.map(b => +(b.observed * 100).toFixed(1)) },
  { name: 'Perfectly honest', values: rel.map(b => +(b.predicted * 100).toFixed(1)) },
], { x: 5.1, y: 1.5, w: 4.4, h: 3.6, chartColors: [HEX.forest, HEX.grey], lineSize: 2, lineDataSymbolSize: 7,
  valAxisMinVal: 0, valAxisMaxVal: 70, catAxisMinVal: 0, catAxisMaxVal: 70, valAxisLabelFormatCode: '0"%"', catAxisLabelFormatCode: '0"%"',
  showValAxisTitle: true, valAxisTitle: 'Observed', showCatAxisTitle: true, catAxisTitle: 'Predicted chance of a 5%+ rise',
  valAxisTitleFontSize: 10, catAxisTitleFontSize: 10, valAxisTitleColor: HEX.ink3, catAxisTitleColor: HEX.ink3,
  showLegend: true, legendPos: 'b', showTitle: true, title: `Rise warning reliability (Brier ${ev.rise_warning.brier.toFixed(3)} vs ${ev.rise_warning.brier_base_rate.toFixed(3)})`, ...axisText, objectName: 'reliability-chart' });

// 9. The app ----------------------------------------------------------------------------------------------------
pres.addSection({ title: 'Product' });
s = pres.addSlide({ masterName: 'FS Content', sectionTitle: 'Product' });
s.addText('An app that looks like the mandi it serves', { placeholder: 'title' });
const pts = [
  ['Rate board', 'Split-flap price on a forest-green board, the way mandis post rates'],
  ['The parchi', 'Sell or hold printed on a textured paper slip with a stamp'],
  ['Charts with context', 'Forecast band, plus the usual range for the same weeks of 5 past years'],
  ['Search anywhere', 'Ctrl/⌘ K finds any of 1,388 series by mandi, district, state or crop'],
];
pts.forEach(([h, b], i) => {
  const y = 1.2 + i * 0.98;
  s.addShape(pres.shapes.OVAL, { x: 0.5, y: y + 0.05, w: 0.36, h: 0.36, fill: { color: HEX.forest }, line: { color: HEX.forest }, objectName: `point-${i + 1}-dot` });
  s.addText(String(i + 1), { x: 0.5, y: y + 0.05, w: 0.36, h: 0.36, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, isTextBox: true, objectName: `point-${i + 1}-num` });
  s.addText(h, { x: 1.0, y, w: 3.4, h: 0.32, fontSize: 15, bold: true, color: HEX.forest9, margin: 0, isTextBox: true, objectName: `point-${i + 1}-head` });
  s.addText(b, { x: 1.0, y: y + 0.33, w: 3.4, h: 0.55, fontSize: 12, color: HEX.ink2, margin: 0, valign: 'top', isTextBox: true, objectName: `point-${i + 1}-body` });
});
s.addImage({ path: path.join(__dirname, 'palette_crop.png'), x: 5.5, y: 1.15, w: 3.4 * 640 / 600, h: 3.4, objectName: 'palette-screenshot', altText: 'Search-anywhere palette finding Kolar tomato mandis' });
s.addText('React 19, Vite, Recharts; FastAPI back end; one Vercel deployment', { x: 5.5, y: 4.65, w: 4.0, h: 0.3, fontSize: 10, color: HEX.ink3, margin: 0, isTextBox: true, objectName: 'stack-note' });

// 10. Live + next ------------------------------------------------------------------------------------------------
pres.addSection({ title: 'Close' });
s = pres.addSlide({ masterName: 'FS Dark', sectionTitle: 'Close' });
s.addText('Live today, honest about its limits', { x: 0.6, y: 0.45, w: 8.8, h: 0.7, fontSize: 30, bold: true, color: HEX.chalk, fontFace: 'Cambria', margin: 0, isTextBox: true, objectName: 'close-title' });
const cols = [
  ['Live pipeline', ['data.gov.in daily prices, 3 pulls a day', 'Stored in Supabase Postgres (read-only public)', 'Forecasts rebuilt every evening', 'Weekly champion / challenger retrain']],
  ['Limits', ['New mandis: onion does not beat "no change"', 'Policy shocks are not in past prices', 'Ranges assume shocks no bigger than 2024–26', 'Only half of live mandi names match']],
  ['Next', ['Refresh range calibration monthly', 'Personal API key for fast back-fills', 'Reviewed list of mandi name matches', 'Weather and policy events as features']],
];
cols.forEach(([h, items], i) => {
  const x = 0.6 + i * 3.0;
  s.addText(h, { x, y: 1.45, w: 2.75, h: 0.4, fontSize: 17, bold: true, color: HEX.chalk, margin: 0, isTextBox: true, objectName: `close-${i + 1}-head` });
  s.addText(items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < items.length - 1 } })),
    { x, y: 1.95, w: 2.75, h: 2.6, fontSize: 13, color: 'BFE6C8', margin: 0, valign: 'top', paraSpaceAfter: 8, isTextBox: true, objectName: `close-${i + 1}-list` });
});
s.addText('Estimates from past prices, not guarantees. Check the day\'s rate at the mandi before you sell.', { x: 0.6, y: 4.85, w: 8.8, h: 0.35, fontSize: 11, italic: true, color: HEX.grey, margin: 0, isTextBox: true, objectName: 'disclaimer' });

const OUT = path.join(REPO, 'docs', 'FarmStat_presentation.pptx');
(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('written');
})();
