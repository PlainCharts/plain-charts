// @ts-check
// kapelka/skin — an optional, framework-free UI layer for a StudyHost: the legend, the per-pane
// controls, and the config window. The library core is mechanics-only; this is the batteries-
// included chrome (the equivalent of trading-vue-js's tvjs-xp extension pack). Attach it once:
//
//   import { StudyHost } from 'kapelka/studies';
//   import { createSkin } from 'kapelka/skin';
//   const host = new StudyHost(chart, { getBars: () => bars });
//   createSkin(host, { chart, container: chartEl, textColor: '#2a2e39' });
//
// container = a positioned ancestor of the chart (the chart's own div works). textColor/accent
// theme the chrome. The host never depends on the skin — it's purely additive (events in, DOM out).
import { ensureStyles } from './styles.js';
import { attachStudyLegend } from './legend.js';
import { attachControls } from './controls.js';
import { attachOverlayLegend } from './overlay-legend.js';
import { attachPriceLegend } from './price-legend.js';
import { attachConfig } from './config.js';

// legend display defaults (consumer overrides via opts.legend / skin.setLegendOptions):
//   title/inputs/values -> what the readout shows; bg/bgColor/bgOpacity -> the underlay box that
//   makes the whole legend a solid pointer target (so you aim at the box, not the glyphs).
const LEGEND_DEFAULTS = { title: true, inputs: true, values: true, bg: true, bgColor: null, bgOpacity: 0.5 };

// hex (#rgb / #rrggbb) -> rgba(...) at op; pass-through anything else (named/rgb already usable)
/**
 * @param {string|null|undefined} color
 * @param {number} op  opacity 0..1
 * @returns {string|null}
 */
function rgbaFrom(color, op) {
  if (!color) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${op})`;
  }
  m = /^#([0-9a-f]{3})$/i.exec(color);
  if (m) {
    const c = m[1];
    const x = (/** @type {number} */ i) => parseInt(c[i] + c[i], 16);
    return `rgba(${x(0)},${x(1)},${x(2)},${op})`;
  }
  return color;
}

/**
 * The skin options bag. Known fields below; open for the rest (consumers may pass extra). All optional.
 * @typedef {Object} SkinOptions
 * @property {any} [chart]  the chart/engine handle (defaults to host.chart)
 * @property {HTMLElement} [container]  a positioned ancestor of the chart to mount chrome into
 * @property {string} [textColor]  --skin-text CSS var
 * @property {string} [accent]  --skin-accent CSS var
 * @property {object|boolean} [priceLegend]  object -> shown with product metadata; truthy -> OHLC only
 * @property {boolean} [overlayCollapsible]  overlay legend: count-chip <-> list toggle
 * @property {number} [overlayTop]  overlay legend top offset (px)
 * @property {Object} [legend]  legend display options merged over LEGEND_DEFAULTS
 * @property {string[]} [pieces]  which chrome pieces to attach (default: config/legend/controls/overlay)
 */

/**
 * Attach the framework-free chrome (legend, per-pane controls, config window) to a StudyHost.
 * Hub boundary: `host` is the kapelka StudyHost surrogate and the returned skin is a dynamically-shaped
 * internal object, so both stay `any`.
 * @param {any} host  the StudyHost to decorate
 * @param {SkinOptions} [opts]
 * @returns {any}  the skin object (host, chart, container, per-map, reposition/refresh/destroy, ...)
 */
export function createSkin(host, opts = {}) {
  ensureStyles();
  const chart = opts.chart || host.chart;
  const container = opts.container || null;
  if (container) {
    if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static')
      container.style.position = 'relative';
    if (opts.textColor) container.style.setProperty('--skin-text', opts.textColor);
    if (opts.accent) container.style.setProperty('--skin-accent', opts.accent);
  }

  // price legend: consumer-supplied product metadata (symbol/timeframe/source) for the top-left OHLC
  // ticker. object -> shown with that metadata; truthy -> shown with OHLC only; absent -> not attached.
  const priceLegend =
    opts.priceLegend && typeof opts.priceLegend === 'object' ? { ...opts.priceLegend } : opts.priceLegend ? {} : null;

  const skin = {
    host,
    chart,
    container,
    priceLegend,
    overlayCollapsible: opts.overlayCollapsible, // overlay legend: count-chip <-> list (default collapsible)
    // when the price ticker occupies the top-left, push the overlay legend below it (unless the consumer set it)
    overlayTop: opts.overlayTop != null ? opts.overlayTop : priceLegend ? 28 : undefined,
    legendOpts: { ...LEGEND_DEFAULTS, ...(opts.legend || {}) }, // title/inputs/values/bg readout options
    /** @type {Map<any, Record<string, any>>} */
    per: new Map(), // attachment `a` -> its DOM elements
    /** @type {Array<() => void>} */
    _offs: [],
    /** @type {Array<() => void>} */
    _positioners: [], // each chrome piece registers a reposition fn here
    /** @type {Array<() => void>} */
    _refreshers: [], // each piece registers a re-render fn here (for visibility/state changes)
    reposition() {
      this._positioners.forEach((/** @type {() => void} */ fn) => {
        try {
          fn();
        } catch (_) {}
      });
    },
    // re-render + reposition every piece — call after a host-side visibility change (hide/global-hide)
    refresh() {
      this._refreshers.forEach((/** @type {() => void} */ fn) => {
        try {
          fn();
        } catch (_) {}
      });
      this.reposition();
    },
    // update legend display options live (title/inputs/values visibility + underlay bg) and re-render
    /** @param {Object} [patch]  partial legend display options */
    setLegendOptions(patch) {
      Object.assign(this.legendOpts, patch || {});
      const o = this.legendOpts;
      if (this.container)
        this.container.style.setProperty(
          '--skin-legend-bg',
          o.bg ? rgbaFrom(o.bgColor, o.bgOpacity != null ? o.bgOpacity : 0.5) || 'transparent' : 'transparent',
        );
      this.refresh();
    },
    destroy() {
      this._offs.forEach((/** @type {() => void} */ fn) => {
        try {
          fn();
        } catch (_) {}
      });
      this._offs = [];
      this.per.forEach((/** @type {Record<string, any>} */ rec) =>
        Object.values(rec).forEach((/** @type {any} */ el) => {
          if (el && el.remove)
            try {
              el.remove();
            } catch (_) {}
        }),
      );
      this.per.clear();
    },
  };

  // ONE repositioning loop drives every chrome piece on resize / pointer drag (pane splitter)
  if (container) {
    let raf = 0;
    const sched = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        skin.reposition();
      });
    };
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(sched);
      ro.observe(container);
      skin._offs.push(() => ro.disconnect());
    }
    container.addEventListener('pointermove', sched);
    skin._offs.push(() => container.removeEventListener('pointermove', sched));
  }

  // track an attachment BEFORE the chrome pieces build for it (their 'added' handlers read skin.per)
  host.on('added', (/** @type {any} */ a) => {
    if (!skin.per.has(a)) skin.per.set(a, {});
  });
  host.attached.forEach((/** @type {any} */ a) => {
    if (!skin.per.has(a)) skin.per.set(a, {});
  });

  // opts.pieces selects which chrome to attach (default: all). Lets a consumer adopt the skin one
  // piece at a time, or skip a piece it implements itself. 'config' sets skin.openSettings; if it's
  // omitted the consumer can point skin.openSettings at its own settings window.
  const pieces = opts.pieces || ['config', 'legend', 'controls', 'overlay'];
  if (pieces.includes('config')) attachConfig(skin); // sets skin.openSettings, used by the legends' gear/name
  if (pieces.includes('legend')) attachStudyLegend(skin);
  if (pieces.includes('controls')) attachControls(skin);
  if (pieces.includes('overlay')) attachOverlayLegend(skin);
  if (priceLegend || pieces.includes('price')) attachPriceLegend(skin); // top-left symbol · tf · source + OHLC

  // drop the per-map entry LAST, after the chrome pieces have removed their DOM on 'removed'
  host.on('removed', (/** @type {any} */ a) => {
    skin.per.delete(a);
  });

  skin.setLegendOptions({}); // set the initial underlay-bg CSS var from legendOpts

  return skin;
}
