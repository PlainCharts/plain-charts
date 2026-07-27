// @ts-check
// Sub-pane study legend: for each non-overlay study, a top-left readout of its name + numeric
// settings + live per-plot values (colored, updated on crosshair). Driven entirely by the host's
// lifecycle events + the chart's crosshair — no coupling to any app Pane.
import { effectiveStyle, fmtVal } from '../studies/channels.js';
import { paneGeom, chromeVisible } from './geometry.js';

// "RSI 14": short name (acronym in parens, else full) + only the numeric inputs that OPT IN via
// `legend: true` -- so a study shows just its name unless it deliberately surfaces a key input (a
// length, say). Hidden inputs never appear. opts.inputs === false drops the numbers entirely.
/**
 * @param {any} a  a study attachment (dynamic bag from the host)
 * @param {{ inputs?: boolean }} [opts]
 * @returns {string}
 */
export function studyLabel(a, opts = {}) {
  const nm = a.study.name || a.study.id;
  const short = (nm.match(/\(([A-Z][A-Z0-9]{1,6})\)/) || [])[1] || nm;
  if (opts.inputs === false) return short;
  const nums = (a.study.inputs || []).filter((/** @type {any} */ i) => i.type === 'number' && !i.hidden && i.legend === true).map((/** @type {any} */ i) => a.params[i.key]).filter((/** @type {any} */ v) => v != null);
  return nums.length ? short + ' ' + nums.join(', ') : short;
}

/** @param {any} skin  the skin hub (chart/host/container/per-study records) */
export function attachStudyLegend(skin) {
  const { host, chart, container } = skin;
  if (!container) return;

  /** @param {any} a */
  const build = (a) => {
    if (a.overlay) return;   // sub-pane studies only; chart overlays are step 4
    const rec = skin.per.get(a); if (!rec || rec.legendEl) return;
    const wrap = document.createElement('div'); wrap.className = 'skin-legend';
    const name = document.createElement('span'); name.className = 'skin-legend-name';
    name.title = 'Settings'; name.onclick = () => { if (skin.openSettings) skin.openSettings(a); };
    const vals = document.createElement('span'); vals.className = 'skin-legend-vals';
    wrap.append(name, vals);
    container.appendChild(wrap);
    rec.legendEl = wrap; rec.legendName = name; rec.legendVals = vals;
  };

  // refresh label + per-plot values. seriesData (from a crosshair move) -> value at the hovered
  // bar; null -> the last bar. Plots with legend:false are skipped.
  /**
   * @param {any} a
   * @param {Map<any, any>|null} seriesData
   */
  const render = (a, seriesData) => {
    const rec = skin.per.get(a); if (!rec || !rec.legendEl) return;
    const o = skin.legendOpts || {};
    rec.legendName.style.display = o.title === false ? 'none' : '';
    rec.legendName.textContent = studyLabel(a, { inputs: o.inputs !== false });
    rec.legendVals.style.display = o.values === false ? 'none' : '';
    rec.legendVals.innerHTML = '';
    if (o.values === false) return;
    (a.plotMeta || []).forEach((/** @type {any} */ pm) => {
      if (pm.legend === false) return;
      const eff = effectiveStyle(a.style, pm);
      if (eff.visible === false) return;
      const series = a.plots.get(pm.key);
      let v = (seriesData && series) ? (seriesData.get(series) || {}).value : null;
      if (v == null) v = pm.last;
      const span = document.createElement('span'); span.className = 'skin-legend-v';
      span.style.color = eff.color; span.textContent = fmtVal(v, pm.precision);
      rec.legendVals.appendChild(span);
    });
  };

  // place at the top-left of the study's own pane
  /** @param {any} a */
  const position = (a) => {
    const rec = skin.per.get(a); if (!rec || !rec.legendEl) return;
    if (!chromeVisible(host, a)) { rec.legendEl.style.display = 'none'; return; }   // per-study / global hide
    const { idx, top } = paneGeom(chart, a.plots.values().next().value);
    if (idx < 0) { rec.legendEl.style.display = 'none'; return; }
    rec.legendEl.style.display = ''; rec.legendEl.style.top = (top + 4) + 'px'; rec.legendEl.style.left = '8px';
  };
  const positionAll = () => host.attached.forEach(position);
  skin._positioners.push(positionAll);
  skin._refreshers.push(() => host.attached.forEach((/** @type {any} */ a) => { if (!a.overlay) render(a, null); }));

  host.on('added', build);
  host.on('computed', (/** @type {any} */ a) => { build(a); render(a, null); skin.reposition(); });
  host.on('removed', (/** @type {any} */ a) => { const rec = skin.per.get(a); if (rec && rec.legendEl) { try { rec.legendEl.remove(); } catch (_) {} } });

  // live values on crosshair move
  if (chart.onCursorMove) {
    /** @param {any} param */
    const cb = (param) => {
      const sd = (param && param.time != null) ? param.seriesData : null;
      host.attached.forEach((/** @type {any} */ a) => { if (!a.overlay) render(a, sd); });
    };
    chart.onCursorMove(cb);
    skin._offs.push(() => { try { chart.offCursorMove(cb); } catch (_) {} });
  }

  host.attached.forEach((/** @type {any} */ a) => { build(a); render(a, null); });   // adopt pre-existing studies
  skin._legendRender = render;   // exposed so later pieces (settings save) can force a refresh
}
