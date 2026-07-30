// @ts-check
// Chart access for addons (the `ctx.chart` / `api.chart` surface). This is the platform-shell
// capability that lets an addon READ the active chart and DRAW on it — the same first-class
// reach the app's own UI has. It runs in a UI window (where the charts live); the addon's
// UI dialog is given one of these. Automation in the headless addon-host has no charts, so
// this is intentionally UI-window-only.
//
// The app owns the capability; the addon just consumes it (same rule as the broker contract).
// Everything resolves against the CURRENT active pane live, so an addon naturally follows
// whichever chart the user is looking at; onActiveChange/onSymbolChange let it re-target.
import { getActivePane, getAllPanes } from '../chart/layout.js';
import { bus } from '../bus.js';
import { createThread, createPriceLine } from '../chart/thread.js';
import { getPrimitive } from '../chart/order-view/primitive-registry.js';
import { activePrimitiveId } from '../chart/order-primitives-config.js';

// The vendored kapelka chart engine has no TS types here, so a pane and its engine handles
// (`p.chart`, `p.series`, timeAxis, level handles) are treated as `any` at this boundary.
/** @typedef {any} Pane */

// A bead descriptor strung on a thread's vline (order levels, alerts, position entries...).
/**
 * @typedef {Object} Bead
 * @property {string|number} id
 * @property {number} price
 * @property {string=} color
 * @property {string=} label      short text drawn inside the bead (e.g. a level number)
 * @property {string=} tag        price-scale label text
 * @property {boolean=} hidden
 * @property {boolean=} visible    build-time visibility; false renders the bead hidden (like update({ visible: false }))
 * @property {((price: number) => void)=} onDrag     live, every move while dragging
 * @property {((price: number) => void)=} onCommit   on release (falls back to onDrag)
 * @property {((at: { x: number, y: number, price: number }) => void)=} onClick   tap (not a drag)
 */

// Handle returned by api.priceLine(): the addon updates/removes the line through this.
/**
 * @typedef {Object} LineHandle
 * @property {() => number} price
 * @property {(o?: { price?: number|string, [k: string]: any }) => void} update
 * @property {(on: boolean) => void} setVisible
 * @property {() => void} remove
 */

// Handle returned by api.thread(): a vline with beads.
/**
 * @typedef {Object} ThreadHandle
 * @property {(beadId: string|number, patch?: { price?: number|string, visible?: boolean, color?: string, tag?: string }) => void} update
 * @property {(t: number|string) => void} setTime
 * @property {() => number} time
 * @property {(on: boolean) => void} setVisible
 * @property {() => void} remove
 */

// registerCleanup(fn) — hand back a teardown to run when the dialog closes (removes our drawings,
// drops our bus subscriptions). Wired to the addon dialog's onClose in panels/addons.js.
/** @param {((cleanup: () => void) => void)=} registerCleanup */
export function makeChartApi(registerCleanup) {
  /** @type {Set<LineHandle>} */
  const lines = new Set(); // price-line handles this addon created (auto-removed on close)
  /** @type {Set<ThreadHandle>} */
  const threads = new Set(); // vline+bead handles (auto-removed on close)
  /** @type {Set<import('../chart/order-view/primitive-contract.js').OrderViewInstance>} */
  const views = new Set(); // position-view handles (the standard order/position view; auto-removed on close)
  /** @type {Array<() => void>} */
  const subs = []; // bus unsubscribers
  /** @param {string} type @param {(detail: any) => void} fn */
  const on = (type, fn) => {
    subs.push(bus.on(type, fn));
  };
  /** @returns {Pane} */
  const pane = () => getActivePane();

  const api = {
    // ---- read the active chart ----
    symbol: () => {
      const p = pane();
      return p ? p.symbol : null;
    },
    // the active chart's broker id (null = the app's default/active broker) — so an addon can route
    // orders to the same place the chart's data comes from
    broker: () => {
      const p = pane();
      return p ? p.broker : null;
    },
    timeframe: () => {
      const p = pane();
      return p ? p.tfId : null;
    },
    decimals: () => {
      const p = pane();
      return p ? p.priceDecimals : null;
    },
    // visible time window as { from, to } (epoch seconds), or null if not ready
    visibleRange: () => {
      const p = pane();
      if (!p) return null;
      try {
        return p.chart.timeAxis().timeWindow();
      } catch (_) {
        return null;
      }
    },
    // coordinate <-> value helpers (for custom overlays drawn over the chart)
    /** @param {number} y */
    priceAt: (y) => {
      const p = pane();
      try {
        return p ? p.series.yToPrice(y) : null;
      } catch (_) {
        return null;
      }
    },
    /** @param {number} x */
    timeAt: (x) => {
      const p = pane();
      try {
        return p ? p.chart.timeAxis().xToTime(x) : null;
      } catch (_) {
        return null;
      }
    },
    // every open chart in this window (read-only summary)
    panes: () => getAllPanes().map((/** @type {Pane} */ p) => ({ symbol: p.symbol, timeframe: p.tfId })),

    // ---- events (each returns nothing; all are torn down on close) ----
    /** @param {(e: { time: number|null, price: number|null }) => void} cb */
    onCrosshair: (cb) => on('crosshair', (e) => cb({ time: (e && e.time) ?? null, price: (e && e.price) ?? null })),
    /** @param {(e: { time: any, price: any, x: any, y: any }) => void} cb */
    onClick: (cb) => on('pane:click', (e) => cb({ time: e.time, price: e.price, x: e.x, y: e.y })),
    /** @param {(range: any) => void} cb */
    onRangeChange: (cb) => on('pane:range', () => cb(api.visibleRange())),
    /** @param {(e: { symbol: any, timeframe: any }) => void} cb */
    onActiveChange: (cb) => on('pane:active', () => cb({ symbol: api.symbol(), timeframe: api.timeframe() })),
    // fires when the active chart's symbol changes (covers both switching panes and changing a pane's symbol)
    /** @param {(symbol: any) => void} cb */
    onSymbolChange: (cb) => {
      let last = api.symbol();
      const h = () => {
        const s = api.symbol();
        if (s !== last) {
          last = s;
          cb(s);
        }
      };
      on('pane:changed', h);
      on('pane:active', h);
    },

    // ---- draw on the active chart ----
    // horizontal price line (entry / stop / target / any level). Returns a handle the addon can
    // update or remove; all lines are auto-removed when the dialog closes. Pass draggable:true with
    // onDrag(price) (live, every move) and/or onCommit(price) (on release) to let the user drag it.
    /**
     * @param {{ price?: number|string, color?: string, lineWidth?: number, title?: string, showAxisLabel?: boolean, draggable?: boolean, onDrag?: (px: number) => void, onCommit?: (px: number) => void }} [opts]
     * @returns {LineHandle|null}
     */
    priceLine(opts = {}) {
      const h = createPriceLine(pane(), opts);
      if (!h) return null;
      lines.add(h);
      const orig = h.remove;
      h.remove = () => {
        orig();
        lines.delete(h);
      }; // auto-clear bookkeeping on close
      return h;
    },
    // ---- a VLINE with BEADS on it (order levels, alerts, …) ----
    // A vertical thread anchored at a TIME, with beads at PRICES strung on it. Drag the vline to move
    // the whole thing through time (beads slide horizontally, keeping their price); drag a bead to set
    // its price. The vline can be near-invisible so only the beads show. Rendered as a light DOM overlay
    // over the chart (pointer-events only on the vline + beads, so the chart still works everywhere else);
    // it tracks pan/zoom each frame. beads: [{ id, price, color, tag?, onDrag?, onCommit? }].
    //   handle: { update(beadId,{price,color}), setTime(t), setVisible(on), remove() }
    /**
     * @param {{ time?: number|string, style?: { width?: number, dash?: boolean, color?: string }, beads?: Bead[], onMove?: (t: number) => void, onMoveCommit?: (t: number) => void }} [opts]
     * @returns {ThreadHandle|null}
     */
    thread(opts = {}) {
      const h = createThread(pane(), opts);
      if (!h) return null;
      threads.add(h);
      const orig = h.remove;
      h.remove = () => {
        orig();
        threads.delete(h);
      }; // auto-clear bookkeeping on close
      return h;
    },
    // ---- the STANDARD position/order view (the SAME primitive the app draws) ----
    // ONE call renders a position the way the app does: a vline with dots for entry + hedge SL/TP + a bead per working
    // order (ACTIVE, from the book), plus optional pre-trade projection / plan stop / plan target (PLAN). DISPLAY-ONLY:
    // feed it state with handle.set(state) (see PositionViewState in position-view.js). Interaction handlers passed
    // here (onEntry/onOrderCommit/onPlanStop/onPlanTarget/onHedgeStop/onHedgeTarget/onAnchor/onProjection) turn a dot
    // into a trigger, but the drawing holds NO order logic -- route those to api.orders.command (P2.3). Auto-removed
    // when the dialog closes. So an addon never hand-rolls position dots from raw threads.
    /**
     * @param {{ time?: number, onEntry?: (at: any) => void, onProjection?: (at: any) => void, onPlanStop?: (i: number, px: number) => void, onPlanTarget?: (i: number, px: number) => void, onHedgeStop?: (px: number) => void, onHedgeTarget?: (px: number) => void, onOrderCommit?: (id: any, px: number) => void, onOrderClick?: (id: any) => void, onAnchor?: (time: number, commit: boolean) => void }} [opts]
     * @returns {import('../chart/order-view/primitive-contract.js').OrderViewInstance|null}
     */
    positionView(opts = {}) {
      // the SAME primitive the app draws: resolve the ACTIVE order primitive live (falls back to the
      // shipped default 'pill' when the active one -- e.g. a loadable 'string-beads' -- isn't installed).
      const prim = getPrimitive(activePrimitiveId());
      const h = prim ? prim.create(pane(), opts) : null;
      if (!h) return null;
      views.add(h);
      const orig = h.remove;
      h.remove = () => {
        orig();
        views.delete(h);
      }; // auto-clear bookkeeping on close
      return h;
    },

    // remove every drawing this addon made
    clear: () => {
      [...lines].forEach((h) => h.remove());
      [...threads].forEach((h) => h.remove());
      [...views].forEach((h) => h.remove());
    },

    // composite every pane's ON-SCREEN canvases (candles, axes, AND our drawings/alerts/studies)
    // into one HTMLCanvasElement — exactly what's painted. (chart.snapshot() omits the
    // primitive-drawn layers, so we composite the live canvases instead.) Returns null if no panes.
    snapshot: () => {
      const container = document.getElementById('panes');
      if (!container) return null;
      const cRect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cRect.width * dpr));
      out.height = Math.max(1, Math.round(cRect.height * dpr));
      const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
      ctx.scale(dpr, dpr);
      const ps = getAllPanes();
      const bg = (ps[0] && ps[0].settings && ps[0].settings.canvas && ps[0].settings.canvas.background) || '#0e0e11';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cRect.width, cRect.height);
      ps.forEach((/** @type {Pane} */ p) =>
        p.el.querySelectorAll('canvas').forEach((/** @type {HTMLCanvasElement} */ cv) => {
          const r = cv.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          try {
            ctx.drawImage(cv, r.left - cRect.left, r.top - cRect.top, r.width, r.height);
          } catch (_) {}
        }),
      );
      return out;
    },
  };

  if (typeof registerCleanup === 'function') {
    registerCleanup(() => {
      api.clear();
      subs.forEach((u) => {
        try {
          u();
        } catch (_) {}
      });
      subs.length = 0;
    });
  }
  return api;
}
