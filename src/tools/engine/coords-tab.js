// @ts-check
// The settings dialog's Coordinates tab: per point, a price input plus Date (calendar), Time
// (segmented, via coord-inputs) and Bar index — all addressing the same stored anchor and
// cross-syncing live (edit any one, the other two refresh). Price is shown only when the point
// actually carries one (a vertical line has no meaningful price). Edits write d.points and call the
// dialog's preview(); the dialog owns snapshot/OK/Cancel.
import { getTool } from '../registry.js';
import { partsOf, timeFromParts, fmtDateField, parseDateField, segTime } from './coord-inputs.js';

/** One anchor point of a drawing (may carry a price and/or a time). */
/** @typedef {{ price?: number|null, time?: number|null }} Point */
/** @typedef {{ id: string, tool: string, points: Point[] }} Drawing */

/**
 * @param {string} tag @param {string | null} [cls] @param {string} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// anchor time <-> bar index (logical), via the time scale (round-trips through px)
/** @param {any} pane @param {number} time @returns {number | null} */
function timeToBar(pane, time) {
  const ts = pane.chart.timeAxis();
  const x = ts.timeToX(time);
  if (x == null) return null;
  const l = ts.xToBar(x);
  return l == null ? null : Math.round(l);
}
/** @param {any} pane @param {number} bar @returns {number | null} */
function barToTime(pane, bar) {
  const ts = pane.chart.timeAxis();
  const x = ts.barToX(bar);
  if (x == null) return null;
  let t = ts.xToTime(x);
  if (t == null) {
    const r = ts.timeWindow();
    if (r) t = bar < 0 ? r.from : r.to;
  }
  return t;
}

/** @param {HTMLElement} body @param {Drawing} d @param {any} pane @param {() => void} preview */
export function renderCoordsTab(body, d, pane, preview) {
  const dec = pane.priceDecimals != null ? pane.priceDecimals : 2;
  const off = pane.tzOffset(); // this pane's display offset -- date/time fields read/write in its tz

  const tool = /** @type {any} */ (getTool(d.tool));
  const timeOnly = !!(tool && tool.timeOnly); // e.g. vertical line: price is meaningless, hide it
  const multi = d.points.length > 1;
  d.points.forEach((/** @type {Point} */ p, /** @type {number} */ i) => {
    const pt = d.points[i];
    const hasPrice = !timeOnly && pt.price != null && Number.isFinite(Number(pt.price));
    const hasTime = pt.time != null;
    const tag = multi ? '#' + (i + 1) + ' ' : '';

    // price row (only for points that carry a price)
    if (hasPrice) {
      const r = el('div', 'set-row');
      r.appendChild(el('div', 'set-row-left', tag + 'Price'));
      const controls = el('div', 'set-controls');
      const price = /** @type {HTMLInputElement} */ (el('input'));
      price.type = 'number';
      price.className = 'set-coord-in';
      price.value = Number(pt.price).toFixed(dec);
      price.oninput = () => {
        const v = parseFloat(price.value);
        if (!Number.isNaN(v)) {
          pt.price = v;
          preview();
        }
      };
      controls.appendChild(price);
      r.appendChild(controls);
      body.appendChild(r);
    }

    if (!hasTime) return;

    // Date (calendar picker), Time (segmented, auto-advancing) and Bar all address the same
    // stored anchor and cross-sync: edit any one, the other two refresh. Date is a native
    // date input (value is ISO YYYY-MM-DD, matching fmtDateField/parseDateField). Time follows
    // the app's 24h/12h setting.
    const h24 = pane.settings.tsHours24 !== false;
    const date = /** @type {HTMLInputElement} */ (el('input'));
    date.type = 'date';
    date.className = 'set-coord-in set-coord-txt';
    date.spellcheck = false;
    const bar = /** @type {HTMLInputElement} */ (el('input'));
    bar.type = 'number';
    bar.className = 'set-coord-in';

    // Forward-declared so refresh() (used by the widgets' commit callbacks) can reach the time widget.
    let refresh = () => {};
    const timeWidget = segTime(h24, (nt) => {
      const p = partsOf(/** @type {number} */ (pt.time), off);
      p.h = nt.h;
      p.mi = nt.mi;
      p.s = nt.s;
      pt.time = timeFromParts(p, off);
      // don't rewrite the time widget mid-edit (keeps the caret); just sync date + bar
      date.value = fmtDateField(partsOf(pt.time, off));
      const b = timeToBar(pane, pt.time);
      bar.value = b != null ? /** @type {any} */ (b) : '';
      preview();
    });

    refresh = () => {
      const p = partsOf(/** @type {number} */ (pt.time), off);
      date.value = fmtDateField(p);
      timeWidget.set(p);
      const b = timeToBar(pane, /** @type {number} */ (pt.time));
      bar.value = b != null ? /** @type {any} */ (b) : '';
    };
    refresh();

    date.onchange = () => {
      const nd = parseDateField(date.value);
      if (!nd) return refresh(); // revert on garbage
      const p = partsOf(/** @type {number} */ (pt.time), off);
      p.y = nd.y;
      p.mo = nd.mo;
      p.d = nd.d;
      pt.time = timeFromParts(p, off);
      refresh();
      preview();
    };
    bar.onchange = () => {
      const v = parseInt(bar.value, 10);
      if (Number.isNaN(v)) return refresh();
      const t = barToTime(pane, v);
      if (t != null) {
        pt.time = t;
        refresh();
        preview();
      }
    };
    [date, bar].forEach((inp) =>
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      }),
    );

    /** @param {string} label @param {HTMLElement} input */
    const mkRow = (label, input) => {
      const r = el('div', 'set-row');
      r.appendChild(el('div', 'set-row-left', tag + label));
      const c = el('div', 'set-controls');
      c.appendChild(input);
      r.appendChild(c);
      body.appendChild(r);
    };
    mkRow('Date', date);
    mkRow('Time', timeWidget.el);
    mkRow('Bar', bar);
  });
}
