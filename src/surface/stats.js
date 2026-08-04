// @ts-check
// Stats surface -- a strategy dashboard over CLOSED round-trips: an equity curve, an edge/spread (mean +/- sigma)
// distribution, and a drag-configurable board of summary stat tiles. Same data source as History: the fills
// stream reconstructed into net-0 round-trips by compute-positions, narrowed by the shared account + date
// filters and a "last N trades" sample-size control. USD only. All display; the numbers come from the desk's
// shared trade stats (trade-derive.js) plus this tab's statistical additions (stats-math.js).
import * as PlotLib from '../../lib/plot.min.js'; // Observable Plot (vendored ESM, no build step)
const Plot = /** @type {any} */ (PlotLib); // untyped vendored bundle -- Plot's channel API isn't modeled by tsc
import { platform, bus, computePositions } from '../../data_engine/index.js';
import { compute, normalCurve } from './stats-math.js';
import { load as loadBoard, byKey } from './stats-board.js';
import { openStatsEditor } from './stats-editor.js';
import { getDeskBeThreshold, onDeskConfigChange } from './desk-config.js';
import { createAccountFilter } from './account-filter.js';
import { createDateFilter } from './date-filter.js';
import { GEAR } from './column-picker.js'; // the shared gear glyph
import { t } from '../i18n/i18n.js'; // vocabulary lookup

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// money with a sign-aware '$' prefix (d decimals). +/- goes on the outside of the '$', matching the board tiles.
/** @param {number} x @param {number} [d] @returns {string} */
const money = (x, d = 0) =>
  (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** @typedef {ReturnType<typeof compute>} Stats */

// ---- chart spec builders (exported so a render harness drives the EXACT same Plot code) ----
// Equity curve: cumulative P&L per trade (area + line). Sized to the box; the axis text inherits the box color.
/** @param {HTMLElement} box @param {Stats} s */
export function drawEquity(box, s) {
  box.innerHTML = '';
  box.append(
    Plot.plot({
      width: box.clientWidth || 520,
      height: box.clientHeight || 260,
      style: { fontSize: '12px', background: 'transparent' },
      marginLeft: 62,
      x: { label: t('trade #') },
      y: { label: t('cum P&L ($)'), grid: true },
      marks: [
        Plot.ruleY([0], { stroke: 'currentColor', strokeOpacity: 0.35 }),
        Plot.areaY(s.equity, { x: 'i', y: 'pnl', fill: 'var(--accent)', fillOpacity: 0.12 }),
        Plot.lineY(s.equity, { x: 'i', y: 'pnl', stroke: 'var(--accent)', strokeWidth: 1.5 }),
      ],
    }),
  );
}

// Edge & spread: a normal curve from the trade-net mean + sigma, with the +/-1 sigma band shaded and mu / +/-sigma
// rules marked. Symmetric by construction (mean +/- std), the readable picture of dispersion around the edge.
/** @param {HTMLElement} box @param {Stats} s */
export function drawSpread(box, s) {
  box.innerHTML = '';
  const curve = normalCurve(s.mean, s.std);
  const band = curve.filter((d) => d.x >= s.mean - s.std && d.x <= s.mean + s.std);
  box.append(
    Plot.plot({
      width: box.clientWidth || 520,
      height: box.clientHeight || 260,
      style: { fontSize: '12px', background: 'transparent' },
      marginLeft: 20,
      x: { label: t('trade net ($)') },
      y: { axis: null },
      marks: [
        Plot.areaY(band, { x: 'x', y: 'y', fill: 'var(--accent-ui)', fillOpacity: 0.28 }),
        Plot.lineY(curve, { x: 'x', y: 'y', stroke: 'var(--accent-ui)', strokeWidth: 2 }),
        Plot.ruleX([s.mean], { stroke: 'var(--pos)', strokeWidth: 2 }),
        Plot.ruleX([s.mean - s.std, s.mean + s.std], { stroke: 'currentColor', strokeOpacity: 0.5, strokeDasharray: '4 3' }),
        Plot.ruleY([0], { stroke: 'currentColor', strokeOpacity: 0.25 }),
        Plot.text(
          [
            { x: s.mean, l: 'μ' },
            { x: s.mean - s.std, l: '−σ' },
            { x: s.mean + s.std, l: '+σ' },
          ],
          { x: 'x', y: 0, text: 'l', dy: 14, fill: 'currentColor', fillOpacity: 0.7, fontSize: 12 },
        ),
      ],
    }),
  );
}

// the note under the spread chart: edge mu, sigma, and the +/-1 sigma band as a $ range.
/** @param {Stats} s @returns {string} */
export function spreadNote(s) {
  return (
    'edge μ = ' + money(s.mean, 2) + ' · σ = ' + money(s.std, 0) + ' · ±1σ ≈ ' + money(s.mean - s.std, 0) + ' … ' + money(s.mean + s.std, 0)
  );
}

// Render the summary tiles from the layout + the computed stats. Each cell: a tile's value + its label, with
// pos/neg tinting from the tile's get(). Empty slots render an empty cell so the columns stay aligned. The
// board's row 0 shows at the BOTTOM (CSS column-reverse on .stats-summary).
/** @param {HTMLElement} container @param {import('./stats-board.js').Grids} grids @param {Stats} s */
export function drawSummary(container, grids, s) {
  container.innerHTML = '';
  grids.board.forEach((row) => {
    const srow = el('srow');
    row.forEach((key) => {
      const cell = el('stat');
      const cat = key ? byKey(key) : undefined;
      if (cat) {
        const g = cat.get(s);
        const b = document.createElement('b');
        if (g.cls) b.className = g.cls;
        b.textContent = g.text;
        cell.append(b, el2('span', t(cat.label)));
      }
      srow.appendChild(cell);
    });
    container.appendChild(srow);
  });
}

/** @param {HTMLElement} root */
export function mountStats(root) {
  root.innerHTML = '';
  const wrap = el('surface stats-view');

  // ---- header: title, count, sample-size "Last N", then the shared account + date filters ----
  const head = el('acct-head');
  const title = el('acct-title', t('Stats'));
  const count = el('acct-count', '');
  const spacer = el('acct-spacer');
  // "Last N trades" -- the most recent N of the filtered set (blank / 0 -> all). Plain typed count, no rollers.
  const nCtl = el('stats-nctl');
  nCtl.append(el(undefined, t('Last')));
  const nIn = document.createElement('input');
  nIn.type = 'number';
  nIn.className = 'stats-numin';
  nIn.min = '1';
  nIn.placeholder = t('all');
  nCtl.append(nIn, el(undefined, t('trades')));
  // account lens FIRST, then the date filter operates within it (both per-tab, next to the sample control)
  const acctFilter = createAccountFilter('statsAccountFilter', () => render());
  const dateFilter = createDateFilter('statsRange', () => render());
  // the per-tab gear opens the board editor (drag-configure which tiles show, and where)
  const gear = el('stats-gear');
  gear.title = t('Configure stats board');
  gear.innerHTML = GEAR;
  head.append(title, count, spacer, nCtl, acctFilter.btn, dateFilter.btn, gear);

  // ---- charts row: equity (4/6) + edge/spread (2/6) ----
  const charts = el('stats-charts');
  const equityCard = el('stats-card stats-equity');
  equityCard.append(el2('h3', t('Equity curve (cumulative P&L)')));
  const equityBox = el('stats-plot');
  equityCard.append(equityBox);
  const spreadCard = el('stats-card stats-spread');
  spreadCard.append(el2('h3', t('Edge & spread (mean ± σ)')));
  const distBox = el('stats-plot');
  const distNote = el('stats-note');
  spreadCard.append(distBox, distNote);
  charts.append(equityCard, spreadCard);

  // ---- summary board: the configurable tile grid, rendered from the saved layout ----
  const summaryCard = el('stats-card stats-summary-card');
  summaryCard.append(el2('h3', t('Summary')));
  const summary = el('stats-summary');
  summaryCard.append(summary);

  wrap.append(head, charts, summaryCard);
  root.appendChild(wrap);

  // the board layout (two positioned grids); the summary shows `board`, bottom row first (CSS column-reverse)
  let grids = loadBoard();
  const renderSummary = (/** @type {Stats} */ s) => drawSummary(summary, grids, s);
  // gear -> the board editor. It mutates `grids` in place and calls back to re-render the live summary from
  // the last computed stats (the editor persists the layout itself).
  gear.onclick = () => openStatsEditor(grids, () => lastStats, () => lastStats && renderSummary(lastStats));

  // ---- data: the SAME pipeline History runs -- fills -> net-0 round-trips -> account/date filter -> stats ----
  // Returns the visible closed trades in CHRONOLOGICAL order (oldest -> newest), already narrowed by both
  // filters and the "last N" sample size. Equity + stats both read this ordering.
  const visibleTrades = () => {
    const fills = platform.fills.all();
    // per-symbol tick metadata (the adapter stamps tickSize/tickValue on each fill) -> currency P&L
    /** @type {Map<string, { tickSize?: any, tickValue?: any }>} */
    const tickBySym = new Map();
    for (const f of fills) {
      const s = /** @type {any} */ (f);
      if (s.symbol && !tickBySym.has(s.symbol) && (s.tickValue != null || s.tickSize != null))
        tickBySym.set(s.symbol, { tickSize: s.tickSize, tickValue: s.tickValue });
    }
    const { closed } = computePositions(fills, { contractInfo: (sym) => tickBySym.get(sym) });
    const filtered = closed
      .filter((r) => acctFilter.matches(r) && dateFilter.matches(r.exitTime))
      .sort((a, b) => (Number(a.exitTime) || 0) - (Number(b.exitTime) || 0)); // chronological for equity + "last N"
    const raw = Number(nIn.value);
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : filtered.length; // blank / 0 / bad -> all
    return filtered.slice(-n); // the most recent N (more than we have just returns them all)
  };

  const render = () => {
    const win = visibleTrades();
    const be = getDeskBeThreshold();
    if (!win.length) {
      count.textContent = '';
      equityBox.innerHTML = '';
      distBox.innerHTML = '';
      distNote.textContent = '';
      summary.innerHTML = '';
      summary.appendChild(el('acct-empty', t('No closed trades in range')));
      return;
    }
    const s = compute(win, be);
    count.textContent = String(s.trades);
    drawEquity(equityBox, s);
    drawSpread(distBox, s);
    distNote.textContent = spreadNote(s);
    renderSummary(s);
    lastStats = s;
  };

  /** @type {Stats|null} */
  let lastStats = null;

  render();
  const off1 = platform.fills.subscribe(render); // new fills -> re-derive round-trips
  const off2 = bus.on('connections:changed', render); // saved-connection name/rename -> re-resolve
  const off3 = onDeskConfigChange(render); // BE threshold or timezone changed -> recompute
  nIn.oninput = render;

  // Re-fit the plots to the ACTUAL settled box size (and on any later resize). A ResizeObserver on the chart
  // boxes fires once the grid has computed their real dimensions -- so the SVG is never sized off a pre-layout
  // measurement. Guarded on size so appending the SVG can't loop it.
  let rz = /** @type {any} */ (0);
  let lastW = 0,
    lastH = 0;
  const ro = new ResizeObserver(() => {
    const w = equityBox.clientWidth,
      h = equityBox.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (lastStats) {
        drawEquity(equityBox, lastStats);
        drawSpread(distBox, lastStats);
      }
    }, 60);
  });
  ro.observe(equityBox);
  ro.observe(distBox);

  return {
    destroy() {
      ro.disconnect();
      clearTimeout(rz);
      acctFilter.destroy();
      dateFilter.destroy();
      [off1, off2, off3].forEach((f) => {
        try {
          f();
        } catch (_) {}
      });
      root.innerHTML = '';
    },
  };
}

// a titled element helper (tag + text) -- for the card <h3>s
/** @param {string} tag @param {string} txt @returns {HTMLElement} */
function el2(tag, txt) {
  const e = document.createElement(tag);
  e.textContent = txt;
  return e;
}
