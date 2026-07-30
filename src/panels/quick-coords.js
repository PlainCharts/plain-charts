// @ts-check
// Quick-coordinates editor in the bottom bar: when a single Horizontal Line is selected,
// a PRICE input appears; when a single Vertical Line is selected, DATE + TIME inputs appear.
// It lets the user retune the one meaningful anchor of these single-anchor shapes at a glance,
// without opening the settings dialog's Coordinates tab. It REUSES that tab's exact widgets
// (segTime + the tz-aware parts/date helpers), so behaviour (24h/12h, auto-advance, timezone)
// is identical.
//
// MULTI-SELECT: when 2+ drawings are selected (Ctrl+click / marquee), the bar shows the SHARED
// properties -- a "Price label" toggle (for the price-label-capable drawings), the same stroke swatch
// (colour / thickness / line style) and text swatch (colour / size / bold / italic) -- and each control
// writes to EVERY selected drawing that has that field. Fill (rectangle-only) and per-object coordinates
// are skipped. So a mixed pick of trend lines, rays, h/v lines, rectangles, paths and arrows can be
// restyled in one gesture.
import { bus } from '../bus.js';
import { getTool } from '../tools/registry.js';
import { strokeSwatch, textSwatch, colorSwatch, closeColorPicker } from '../ui/colorpicker.js';
import { saveToolDefaults } from '../tools/tool-defaults.js';
import {
  segTime,
  segDate,
  partsOf,
  timeFromParts,
  fmtDateField,
  parseDateField,
} from '../tools/engine/coord-inputs.js';
import { openCreateAlertDialog } from '../alerts/create-alert-dialog.js';

// small calendar glyph (plain SVG, currentColor so it follows the theme)
const SVG_CAL =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6h12M5 2v2M11 2v2"/></svg>';
// small bell glyph (plain SVG, currentColor so it follows the theme) -- the "create alert" quick button
const SVG_BELL =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a4 4 0 0 0-4 4c0 3-1.2 4.2-1.5 4.8a.4.4 0 0 0 .35.6h10.3a.4.4 0 0 0 .35-.6C13.2 10.2 12 9 12 6a4 4 0 0 0-4-4Z"/><path d="M6.6 13.4a1.5 1.5 0 0 0 2.8 0"/></svg>';

// The engine (`pane.drawings`), its panes, drawings and tool descriptors are the vendored
// kapelka boundary — no TS types here, so they are treated as `any`.
/** @typedef {any} Pane */
/** @typedef {any} Engine */
/** @typedef {any} Drawing */
/** @typedef {any} Tool */

// State of the currently-shown quick-coords editor: either the single-drawing editor
// (pane/eng/id/kind/fields) or the multi-selection editor (multi/ids).
/**
 * @typedef {Object} QcState
 * @property {Pane} pane
 * @property {Engine} eng
 * @property {string=} id                 single-selection: the drawing id
 * @property {('hline'|'vline'|null)=} kind
 * @property {any=} fields                 single-selection: cached anchor + input widgets
 * @property {boolean=} multi             multi-selection editor active
 * @property {string[]=} ids              multi-selection: the edited drawing ids
 */

// Assigned once (non-null) in mountQuickCoords before any other function runs; typed non-null so
// the many downstream .style/.append uses don't each need a guard.
/** @type {HTMLElement} */
let host = /** @type {any} */ (null); // the bottom-bar container element
/** @type {QcState|null} */
let cur = null; // { pane, eng, id, kind, fields } for the currently-shown drawing

/** @param {HTMLElement} container */
export function mountQuickCoords(container) {
  host = container;
  host.style.display = 'none';
  bus.on('objects:changed', onObjects); // selection add/remove/clear
  bus.on('drawings:committed', refreshValues); // after a drag, re-read the anchor
}

// A single hline/vline is selected -> show its editor; anything else -> hide (if it's the
// pane we were showing, so a selection in another pane doesn't blank us).
/** @param {{ pane?: Pane }=} detail */
function onObjects(detail) {
  const pane = detail && detail.pane;
  if (!pane || !pane.drawings) return;
  const eng = pane.drawings;
  // Multi-selection: show the shared stroke/text editor for the drawings that have those properties.
  const sel = eng.selectedIds();
  if (sel.length >= 2) {
    const editable = sel
      .map((/** @type {string} */ i) => eng.get(i))
      .filter(Boolean)
      .filter((/** @type {Drawing} */ d) => hasStrokeSwatch(d, getTool(d.tool)) || showsText(d, getTool(d.tool)));
    if (editable.length >= 2) {
      if (
        cur &&
        cur.multi &&
        cur.pane === pane &&
        sameIds(
          /** @type {string[]} */ (cur.ids),
          editable.map((/** @type {Drawing} */ d) => d.id),
        )
      )
        return; // no churn on a re-emit of the same set
      buildMulti(pane, eng, editable);
      return;
    }
    if (!cur || cur.pane === pane) hide(); // 2+ selected but nothing shared to edit
    return;
  }
  const id = sel.length === 1 ? eng.selectedId : null;
  const d = id ? eng.get(id) : null;
  const tool = d && getTool(d.tool);
  const kind = tool ? (tool.id === 'hline' ? 'hline' : tool.id === 'vline' ? 'vline' : null) : null;
  const hasStroke = hasStrokeSwatch(d, tool); // any line-styled drawing (fib excluded)
  const hasFill = !!(d && d.style && d.style.fill != null); // a fillable drawing (e.g. rectangle)
  if (d && (kind || hasStroke || hasFill || showsText(d, tool))) {
    if (cur && cur.pane === pane && cur.id === id && cur.kind === kind) {
      refreshValues();
      return;
    }
    build(pane, eng, id, d, kind);
  } else if (!cur || cur.pane === pane) {
    hide();
  }
}

// A text-capable drawing shows the text swatch when it actually carries text, or is one of the tools
// where a label is a first-class use: the dedicated text tools (Text / Callout), the trend-line family
// (Trend Line / Ray / Extended Line), the Arrow (delegates to the trend line), the Horizontal Ray, the
// Rectangle, and the measuring ranges (Price / Date / Date & Price Range).
const TEXT_TOOLS = new Set([
  'text',
  'callout',
  'trendline',
  'ray',
  'extendedline',
  'arrow',
  'hray',
  'levelray',
  'rect',
  'priceRange',
  'dateRange',
  'priceTimeRange',
]);
/** @param {Drawing} d @param {Tool} tool */
function showsText(d, tool) {
  if (!d || !tool || !(tool.settings && tool.settings.text)) return false;
  return !!d.text || TEXT_TOOLS.has(tool.id);
}

// The line swatch shows for any drawing whose style has a `color` -- EXCEPT tools where that field
// isn't a single line colour. The fib's `color` is only the "Use one color" override (colours are
// per-level by default) and its width/style don't map to the swatch, so it would be misleading.
const STROKE_EXCLUDE = new Set(['fib']);
/** @param {Drawing} d @param {Tool} tool */
function hasStrokeSwatch(d, tool) {
  return !!(d && d.style && d.style.color != null) && !(tool && STROKE_EXCLUDE.has(tool.id));
}

/** @param {Pane} pane @param {Engine} eng @param {string} id @param {Drawing} d @param {('hline'|'vline'|null)} kind */
function build(pane, eng, id, d, kind) {
  closeColorPicker(); // a picker open on the previous selection's swatch must not outlive the rebuild
  const pt = d.points[0];
  cur = { pane, eng, id, kind, fields: { pt } };
  host.innerHTML = '';
  host.style.display = 'flex';

  // Vertical line: the "Axis label" row from the settings dialog, placed FIRST -- a toggle for the time-axis
  // label plus a custom message (empty = the date/time). Bound to d.style.timeLabel / labelText; the engine
  // renders the label from these, so commit() live-updates it.
  if (kind === 'vline') {
    const style = d.style || (d.style = {});
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bb-qc-axischk';
    cb.title = 'Axis label';
    cb.checked = style.timeLabel !== false;
    const lbl = document.createElement('span');
    lbl.className = 'bb-qc-lbl';
    lbl.textContent = 'Axis label';
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'bb-qc-in bb-qc-axistext';
    txt.style.width = '96px';
    txt.placeholder = 'Date';
    txt.value = style.labelText || '';
    txt.disabled = !cb.checked;
    cb.onchange = () => {
      style.timeLabel = cb.checked;
      txt.disabled = !cb.checked;
      commit();
    };
    txt.oninput = () => {
      style.labelText = txt.value;
      commit();
    };
    host.append(cb, lbl, txt);
  }

  // Price-label-capable drawings (trend line family, rays, hlines): a "Label" toggle for the price-axis
  // label (style.priceLabels), at a glance. (The vertical line has no price label -- it uses Axis label.)
  if (d.style && d.style.priceLabels != null) {
    const style = d.style;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bb-qc-axischk';
    cb.title = 'Price label';
    cb.checked = !!style.priceLabels;
    const lbl = document.createElement('span');
    lbl.className = 'bb-qc-lbl';
    lbl.textContent = 'Label';
    cb.onchange = () => {
      style.priceLabels = cb.checked;
      commit();
    };
    host.append(cb, lbl);
  }

  if (kind === 'hline') {
    const lbl = document.createElement('span');
    lbl.className = 'bb-qc-lbl';
    lbl.textContent = 'Price';
    const dec = pane.priceDecimals != null ? pane.priceDecimals : 2;
    const price = document.createElement('input');
    price.type = 'number';
    price.step = 'any';
    price.className = 'bb-qc-in bb-qc-price';
    price.value = pt.price != null ? Number(pt.price).toFixed(dec) : '';
    price.oninput = () => {
      const v = parseFloat(price.value);
      if (!Number.isNaN(v)) {
        pt.price = v;
        commit();
      }
    };
    host.append(lbl, price);
    cur.fields.price = price;
    cur.fields.dec = dec;
  } else if (kind === 'vline') {
    const off = pane.tzOffset(); // this pane's display offset -- date/time read/write in its tz
    const lbl = document.createElement('span');
    lbl.className = 'bb-qc-lbl';
    lbl.textContent = 'Time';
    // segmented MM/DD/YY date (2-digit year) -- native type=date can't shorten the year -- PLUS a
    // calendar button that opens the native picker (a hidden type=date), so both are available.
    /** @param {{ y: number, mo: number, d: number }} nd */
    const applyDate = (nd) => {
      const p = partsOf(pt.time, off);
      p.y = nd.y;
      p.mo = nd.mo;
      p.d = nd.d;
      p.s = 0;
      pt.time = timeFromParts(p, off);
    };
    const dateWrap = document.createElement('span');
    dateWrap.className = 'bb-qc-datewrap';
    const dateW = segDate((nd) => {
      applyDate(nd);
      commit();
    });
    dateW.set(partsOf(pt.time, off));
    const picker = document.createElement('input');
    picker.type = 'date';
    picker.className = 'bb-qc-picker';
    picker.onchange = () => {
      const nd = parseDateField(picker.value);
      if (!nd) return;
      applyDate(nd);
      dateW.set(partsOf(pt.time, off));
      commit();
    };
    const cal = document.createElement('button');
    cal.className = 'bb-qc-cal';
    cal.title = 'Pick date';
    cal.innerHTML = SVG_CAL;
    cal.onclick = () => {
      picker.value = fmtDateField(partsOf(pt.time, off));
      if (picker.showPicker) {
        try {
          picker.showPicker();
          return;
        } catch (_) {}
      }
      picker.focus();
    };
    dateWrap.append(dateW.el, cal, picker);
    const h24 = pane.settings && pane.settings.tsHours24 !== false;
    // HH:MM only on this at-a-glance view (seconds are rarely typed); any edit zeroes seconds.
    const timeW = segTime(
      h24,
      (nt) => {
        const p = partsOf(pt.time, off);
        p.h = nt.h;
        p.mi = nt.mi;
        p.s = 0;
        pt.time = timeFromParts(p, off);
        dateW.set(partsOf(pt.time, off));
        commit();
      },
      { seconds: false },
    );
    timeW.set(partsOf(pt.time, off));
    host.append(lbl, dateWrap, timeW.el);
    cur.fields.dateW = dateW;
    cur.fields.timeW = timeW;
  }

  // colour control for the drawing's main colour. A colour-ONLY style (no width/line-style, e.g. the
  // Symbol tool) gets a plain colour swatch; a stroked drawing gets the full stroke picker (colour +
  // thickness + line style), the same one the settings dialog uses.
  if (hasStrokeSwatch(d, getTool(d.tool))) {
    const style = d.style;
    const colorOnly = style.width == null && style.lineWidth == null && style.lineStyle == null;
    let sw;
    if (colorOnly) {
      sw = colorSwatch(style.color, (/** @type {any} */ v) => {
        style.color = v;
        commit();
      });
      sw.classList.add('bb-qc-fill');
      sw.title = 'Colour';
    } else {
      sw = strokeSwatch({
        color: {
          get: () => style.color,
          set: (/** @type {any} */ v) => {
            style.color = v;
            commit();
          },
        },
        width: {
          get: () => style.width,
          set: (/** @type {any} */ v) => {
            style.width = v;
            commit();
          },
        },
        lineStyle: {
          get: () => style.lineStyle,
          set: (/** @type {any} */ v) => {
            style.lineStyle = v;
            commit();
          },
        },
      });
      sw.classList.add('bb-qc-stroke');
    }
    host.append(sw);
  }

  // fill colour swatch (a plain colour box) for a fillable drawing (e.g. rectangle background)
  if (d.style && d.style.fill != null) {
    const style = d.style;
    const fsw = colorSwatch(style.fill, (/** @type {any} */ v) => {
      style.fill = v;
      commit();
    });
    fsw.classList.add('bb-qc-fill');
    fsw.title = 'Fill colour';
    host.append(fsw);
  }

  const tool = getTool(d.tool);

  // Quick toggles for a text-box drawing -- Background / Border / Text wrap -- mirroring the settings
  // dialog's toggle sections (`tool.settings.style[].toggle`). Deeper config (colours, widths) stays in
  // the dialog; here it is just the on/off. Only shown for tools that declare the toggle. Placed BEFORE
  // the text swatch so the swatch keeps its original right-most position.
  const styleSecs = (tool && tool.settings && tool.settings.style) || [];
  /** @param {string} key @param {string} label */
  const addToggle = (key, label) => {
    const sec = styleSecs.find((/** @type {any} */ s) => s.toggle === key);
    if (!sec) return;
    const style = d.style || (d.style = {});
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bb-qc-axischk';
    cb.title = label;
    cb.checked = style[key] != null ? !!style[key] : !!sec.toggleDefault;
    const lbl = document.createElement('span');
    lbl.className = 'bb-qc-lbl';
    lbl.textContent = label;
    cb.onchange = () => {
      style[key] = cb.checked;
      commit();
    };
    host.append(cb, lbl);
  };
  addToggle('bgOn', 'Bkgnd');
  addToggle('borderOn', 'Border');
  addToggle('wrap', 'Wrap');

  // text swatch (colour + a "Text" sample) -- opens the picker with the text sections (size/bold/italic),
  // the twin of the line swatch. Bound live to the drawing's textStyle. Right-most control.
  if (showsText(d, tool)) {
    if (!d.textStyle) {
      const def = /** @type {any} */ (tool).settings.text.defaults || {};
      d.textStyle = {
        color: '#787b86',
        size: 14,
        bold: false,
        italic: false,
        vAlign: def.vAlign || 'middle',
        hAlign: def.hAlign || 'center',
      };
    }
    const ts = d.textStyle;
    const tsw = textSwatch({
      color: {
        get: () => ts.color,
        set: (/** @type {any} */ v) => {
          ts.color = v;
          commit();
        },
      },
      size: {
        get: () => ts.size,
        set: (/** @type {any} */ v) => {
          ts.size = v;
          commit();
        },
      },
      bold: {
        get: () => ts.bold,
        set: (/** @type {any} */ v) => {
          ts.bold = v;
          commit();
        },
      },
      italic: {
        get: () => ts.italic,
        set: (/** @type {any} */ v) => {
          ts.italic = v;
          commit();
        },
      },
    });
    tsw.classList.add('bb-qc-text');
    host.append(tsw);
  }

  // Create-alert quick button (right-most) -- opens the same dialog as the drawing's right-click
  // "Create alert…". Single-selection only (an alert anchors to one drawing).
  const alertBtn = document.createElement('button');
  alertBtn.className = 'bb-qc-alert';
  alertBtn.title = 'Create alert…';
  alertBtn.innerHTML = SVG_BELL;
  alertBtn.onclick = () => openCreateAlertDialog(eng, id);
  host.append(alertBtn);
}

/** @param {string[]} a @param {string[]} b */
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Multi-selection editor: the SHARED stroke + text controls, each writing to every selected drawing
// that has the field. The swatches read a representative value from the PRIMARY (last-clicked) drawing
// -- or the first that has the field -- and apply the chosen value across the whole selection.
/** @param {Pane} pane @param {Engine} eng @param {Drawing[]} drawings */
function buildMulti(pane, eng, drawings) {
  closeColorPicker();
  cur = { pane, eng, multi: true, ids: drawings.map((d) => d.id) };
  host.innerHTML = '';
  host.style.display = 'flex';

  const lbl = document.createElement('span');
  lbl.className = 'bb-qc-lbl';
  lbl.textContent = drawings.length + ' selected';
  host.append(lbl);

  const primary = eng.get(eng.selectedId) || drawings[0];

  // ---- price-axis label toggle: written to every selected price-label-capable drawing (trend line
  // family, rays, hlines). The checkbox reflects the primary (or the first that has the field). ----
  const withPriceLabel = drawings.filter((d) => d.style && d.style.priceLabels != null);
  if (withPriceLabel.length) {
    const repP = primary && primary.style && primary.style.priceLabels != null ? primary : withPriceLabel[0];
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bb-qc-axischk';
    cb.title = 'Price label';
    cb.checked = !!repP.style.priceLabels;
    const plbl = document.createElement('span');
    plbl.className = 'bb-qc-lbl';
    plbl.textContent = 'Label';
    cb.onchange = () => {
      withPriceLabel.forEach((d) => {
        d.style.priceLabels = cb.checked;
      });
      commitMulti();
    };
    host.append(cb, plbl);
  }

  const withStroke = drawings.filter((d) => hasStrokeSwatch(d, getTool(d.tool)) && d.style);
  const withText = drawings.filter((d) => showsText(d, getTool(d.tool)));

  // ---- stroke: colour (all with a colour), thickness + line style (all that have them) ----
  if (withStroke.length) {
    // representative value for a stroke field: prefer the primary, else the first selected that has it
    /** @param {string} f */
    const rep = (f) => {
      const p =
        primary && primary.style && primary.style[f] != null ? primary : withStroke.find((d) => d.style[f] != null);
      return p && p.style ? p.style[f] : undefined;
    };
    /** @param {string} f @param {any} v */
    const setAll = (f, v) => {
      withStroke.forEach((d) => {
        if (d.style[f] != null) d.style[f] = v;
      });
      commitMulti();
    };
    const anyWidth = withStroke.some((d) => d.style.width != null);
    const anyLine = withStroke.some((d) => d.style.lineStyle != null);
    let sw;
    if (!anyWidth && !anyLine) {
      // colour-only across the selection -> a plain colour box
      sw = colorSwatch(rep('color') || '#787b86', (/** @type {any} */ v) => {
        withStroke.forEach((d) => {
          d.style.color = v;
        });
        commitMulti();
      });
      sw.classList.add('bb-qc-fill');
      sw.title = 'Colour';
    } else {
      sw = strokeSwatch({
        color: { get: () => rep('color'), set: (/** @type {any} */ v) => setAll('color', v) },
        width: { get: () => rep('width'), set: (/** @type {any} */ v) => setAll('width', v) },
        lineStyle: { get: () => rep('lineStyle'), set: (/** @type {any} */ v) => setAll('lineStyle', v) },
      });
      sw.classList.add('bb-qc-stroke');
    }
    host.append(sw);
  }

  // ---- text: colour / size / bold / italic (all text-capable drawings) ----
  if (withText.length) {
    withText.forEach((d) => {
      if (d.textStyle) return;
      const tool = /** @type {any} */ (getTool(d.tool));
      const def = (tool.settings.text && tool.settings.text.defaults) || {};
      d.textStyle = {
        color: '#787b86',
        size: 14,
        bold: false,
        italic: false,
        vAlign: def.vAlign || 'middle',
        hAlign: def.hAlign || 'center',
      };
    });
    const primaryT = primary && primary.textStyle ? primary : withText[0];
    /** @param {string} f */
    const repT = (f) => (primaryT.textStyle[f] != null ? primaryT.textStyle[f] : withText[0].textStyle[f]);
    /** @param {string} f @param {any} v */
    const setAllT = (f, v) => {
      withText.forEach((d) => {
        d.textStyle[f] = v;
      });
      commitMulti();
    };
    const tsw = textSwatch({
      color: { get: () => repT('color'), set: (/** @type {any} */ v) => setAllT('color', v) },
      size: { get: () => repT('size'), set: (/** @type {any} */ v) => setAllT('size', v) },
      bold: { get: () => repT('bold'), set: (/** @type {any} */ v) => setAllT('bold', v) },
      italic: { get: () => repT('italic'), set: (/** @type {any} */ v) => setAllT('italic', v) },
    });
    tsw.classList.add('bb-qc-text');
    host.append(tsw);
  }
}

// persist once, repaint every edited drawing (a synced one repaints all its panes). No tool-defaults
// write: a bulk restyle is not "set this tool's default appearance".
function commitMulti() {
  if (!cur || !cur.multi) return;
  cur.eng.persist();
  /** @type {string[]} */ (cur.ids).forEach((id) => {
    const d = /** @type {QcState} */ (cur).eng.get(id);
    if (d) /** @type {QcState} */ (cur).eng.liveUpdate(d);
  });
}

// persist + repaint (same path the settings dialog uses), and record the appearance as the tool's
// last-used defaults -- so a quick-bar edit seeds the next drawing of that tool, exactly like the dialog.
function commit() {
  if (!cur) return;
  const d = cur.eng.get(cur.id);
  cur.eng.persist();
  cur.eng.liveUpdate(d);
  if (d) saveToolDefaults(d.tool, d.style, d.textStyle);
}

// re-read the anchor into the fields (e.g. after dragging the line), unless the user is
// mid-edit in one of these fields.
function refreshValues() {
  if (!cur || !cur.fields) return;
  if (host.contains(document.activeElement)) return;
  const d = cur.eng.get(cur.id);
  if (!d || !d.points || !d.points[0]) {
    hide();
    return;
  }
  const pt = d.points[0];
  cur.fields.pt = pt;
  if (cur.kind === 'hline') {
    cur.fields.price.value = pt.price != null ? Number(pt.price).toFixed(cur.fields.dec) : '';
  } else if (cur.kind === 'vline') {
    const off = cur.pane.tzOffset();
    cur.fields.dateW.set(partsOf(pt.time, off));
    cur.fields.timeW.set(partsOf(pt.time, off));
  }
}

function hide() {
  cur = null;
  closeColorPicker();
  if (host) {
    host.style.display = 'none';
    host.innerHTML = '';
  }
}
