// @ts-check
// Multi-pane surfaces + ordering for a Pane: routing a y-coordinate to the drawable surface it lands
// in, the persisted vertical ordering of occupants (price / compare / oscillator studies), per-series
// pane-height modes (normal / collapsed / max) and registering/removing sub-pane drawing surfaces.
// Split out of pane.js as a prototype mixin -- these methods run with `this` bound to the Pane instance.
import { bus } from '../../bus.js';
import { DrawingEngine } from '../../tools/engine/engine.js';

// A drawing surface registered on the pane (the main pane + any sub-panes). `engine` is the engine
// boundary (any); `top`/`yOffset` are live getters that follow the surface when panes reorder.
/**
 * @typedef {Object} Surface
 * @property {any} engine
 * @property {() => number} top
 * @property {() => number} yOffset
 * @property {() => any} bars
 */
// One reorderable pane occupant (the price series, a compare series, or an oscillator study series).
// `get`/`set` read+write the persisted vertical position for that occupant; `_k` is a transient
// sort key stamped during _applyPaneOrder. `series` is an engine plot handle (any).
/**
 * @typedef {Object} Occupant
 * @property {any} series
 * @property {() => any} get
 * @property {(v: number) => void} set
 * @property {number=} _k
 */
// Height-mode snapshot passed to applyPaneMode: the max-mode full-layout stretch snapshot and the
// collapsed-mode remembered height of the one collapsed pane.
/**
 * @typedef {{ snap?: number[]|null, collapsedPx?: number|null }} PaneModeState
 */
// The Pane surface this mixin drives via `this`. Engine handles (chart/series, plot handles) and the
// studies/compare subsystems are the `any` boundary; the structured surface/occupant lists are typed.
/**
 * @typedef {Object} SurfaceCtx
 * @property {Surface[]} surfaces
 * @property {any} series               main pane's engine plot handle
 * @property {any} chart                engine chart handle (panes/priceAxis)
 * @property {Record<string, any>} settings
 * @property {any} studies              StudyHost (attached/reindexAndReposition/persist)
 * @property {any} compare              compare overlay ({ series } | null)
 * @property {number} [_orderRaf]       pending requestAnimationFrame id (0 = none)
 * @property {(() => void)=} _positionCompareUI
 * @property {() => Occupant[]} _orderOccupants
 * @property {() => void} _applyPaneOrder
 * @property {(series: any) => number} paneIndexOf
 * @property {(series: any) => number} paneTopOf
 */

export const surfaceMethods = {
  // the drawable surface containing a y (px from the pane top): the lowest surface
  // whose top is at or above y. Sub-panes (larger top) win over the main pane.
  /** @this {SurfaceCtx} @param {number} y @returns {Surface|null} */
  surfaceAt(y) {
    const ss = this.surfaces || [];
    // sort by current top so reordered panes route correctly (lowest pane wins ties)
    const sorted = ss.slice().sort((a, b) => a.top() - b.top());
    for (let i = sorted.length - 1; i >= 0; i--) if (y >= sorted[i].top()) return sorted[i];
    return ss[0] || null;
  },

  // ---- pane ordering (persisted) ----
  // Each occupant (price / compare / each oscillator study) remembers its vertical
  // position so refreshes keep the user's arrangement instead of stacking by load order.
  /** @this {SurfaceCtx} @returns {Occupant[]} */
  _orderOccupants() {
    /** @type {Occupant[]} */
    const occ = [
      {
        series: this.series,
        get: () => this.settings.mainPaneIdx,
        set: (v) => {
          this.settings.mainPaneIdx = v;
        },
      },
    ];
    if (this.studies)
      this.studies.attached.forEach((/** @type {any} */ a) => {
        if (a.overlay) return;
        const s = a.plots.values().next().value;
        if (s)
          occ.push({
            series: s,
            get: () => a._wantOrder,
            set: (v) => {
              a._wantOrder = v;
            },
          });
      });
    if (this.compare && this.compare.series)
      occ.push({
        series: this.compare.series,
        get: () => this.settings.compare && this.settings.compare.paneIdx,
        set: (v) => {
          if (this.settings.compare) this.settings.compare.paneIdx = v;
        },
      });
    return occ;
  },
  // reorder the live panes to MATCH the persisted order. Never rewrites the saved order
  // (it runs incrementally as panes are created async, so rewriting would corrupt it);
  // only explicit moves (_captureOrder) change the saved order.
  /** @this {SurfaceCtx} */
  _applyPaneOrder() {
    const occ = this._orderOccupants();
    // The engine pins the main candle pane to the top (grid 0), so it always sorts first here —
    // regardless of any stale saved mainPaneIdx. Sub-panes order among themselves below it.
    occ.forEach((o, i) => {
      const v = o.get();
      o._k = o.series === this.series ? -Infinity : v != null ? v : 1000 + i;
    }); // unknown → bottom, stable
    occ.sort((a, b) => /** @type {number} */ (a._k) - /** @type {number} */ (b._k));
    occ.forEach((o, target) => {
      const cur = this.paneIndexOf(o.series);
      if (cur >= 0 && cur !== target) {
        try {
          this.chart.panes()[cur].moveTo(target);
        } catch (_) {}
      }
    });
    if (this.studies && this.studies.reindexAndReposition) this.studies.reindexAndReposition();
    if (this._positionCompareUI) this._positionCompareUI();
  },
  /** @this {SurfaceCtx} */
  _scheduleApplyOrder() {
    if (this._orderRaf) return;
    this._orderRaf = requestAnimationFrame(() => {
      this._orderRaf = 0;
      this._applyPaneOrder();
    });
  },
  // record the current pane positions (after a user move) so they persist
  /** @this {SurfaceCtx} */
  _captureOrder() {
    this._orderOccupants().forEach((o) => o.set(this.paneIndexOf(o.series)));
    if (this.studies && this.studies.persist) this.studies.persist();
    bus.emit('pane:changed');
  },

  // index of the pane holding `series`, or -1
  /** @this {SurfaceCtx} @param {any} series @returns {number} */
  paneIndexOf(series) {
    try {
      const ps = this.chart.panes();
      for (let i = 0; i < ps.length; i++) {
        let l;
        try {
          l = ps[i].getSeries();
        } catch (_) {
          l = [];
        }
        if (series && l.indexOf(series) !== -1) return i;
      }
    } catch (_) {}
    return -1;
  },

  // Resize a sub-pane (identified by its series, so it's order-independent) to a height
  // mode — shared by the compare pane and oscillator study panes. `state` holds a snapshot
  // of every pane's stretch factor, taken when leaving 'normal' so restore is EXACT.
  //   normal    — restore the snapshot
  //   collapsed — a fixed ~26px bar (px-as-stretch); only the price pane absorbs the freed
  //               space, every OTHER pane keeps its current height (no squishing)
  //   max       — this pane fills; the rest shrink away
  /** @this {SurfaceCtx} @param {any} series @param {string} mode @param {PaneModeState} state */
  applyPaneMode(series, mode, state) {
    let ps;
    try {
      ps = this.chart.panes();
    } catch (_) {
      return;
    }
    const idx = this.paneIndexOf(series);
    if (idx < 0) return;
    const mainIdx = this.paneIndexOf(this.series);
    /** @param {any} p @returns {number} */
    const sf = (p) => {
      try {
        return p.getStretchFactor();
      } catch (_) {
        try {
          return p.getHeight();
        } catch (_2) {
          return 1;
        }
      }
    };
    /** @param {any} p @returns {number} */
    const px = (p) => {
      try {
        return p.getHeight() || 0;
      } catch (_) {
        return 0;
      }
    };
    /** @param {any} p @param {number} f */
    const set = (p, f) => {
      try {
        p.setStretchFactor(Math.max(0.0001, f));
      } catch (_) {}
    };
    const absorb = mainIdx >= 0 && mainIdx !== idx ? mainIdx : idx === 0 ? 1 : 0;
    const COLLAPSED_H = 26;

    if (mode === 'max') {
      if (!state.snap) state.snap = ps.map(sf); // full-layout snapshot (max squishes every pane)
      ps.forEach((/** @type {any} */ p, /** @type {number} */ i) => set(p, i === idx ? 1 : 0.0001));
    } else if (mode === 'collapsed') {
      const h = ps.map(px);
      if (state.collapsedPx == null) state.collapsedPx = h[idx]; // remember ONLY this pane's height
      const delta = h[idx] - COLLAPSED_H; // freed px -> the absorber (price pane)
      ps.forEach((/** @type {any} */ p, /** @type {number} */ i) =>
        set(p, i === idx ? COLLAPSED_H : i === absorb ? h[i] + delta : h[i]),
      );
    } else if (state.snap) {
      // restore from max -> the whole layout
      state.snap.forEach((/** @type {number} */ f, /** @type {number} */ i) => {
        if (ps[i]) set(ps[i], f);
      });
      state.snap = null;
      state.collapsedPx = null;
    } else if (state.collapsedPx != null) {
      // restore from collapse -> ONLY this pane (+ absorber),
      const h = ps.map(px),
        grow = Math.max(0, state.collapsedPx - h[idx]); // so other collapsed panes stay collapsed
      ps.forEach((/** @type {any} */ p, /** @type {number} */ i) =>
        set(p, i === idx ? state.collapsedPx : i === absorb ? Math.max(COLLAPSED_H, h[i] - grow) : h[i]),
      );
      state.collapsedPx = null;
    } else {
      set(ps[idx], 0.3);
    }
  },

  // y (px from the chart top) of the pane that holds `series` — sum of the heights of the
  // panes above it. Derived live so a surface follows its series when panes are reordered.
  /** @this {SurfaceCtx} @param {any} series @returns {number} */
  paneTopOf(series) {
    try {
      const ps = this.chart.panes();
      let h = 0;
      for (let i = 0; i < ps.length; i++) {
        let list;
        try {
          list = ps[i].getSeries();
        } catch (_) {
          list = [];
        }
        if (series && list.indexOf(series) !== -1) return h;
        try {
          h += ps[i].getHeight();
        } catch (_) {}
      }
    } catch (_) {}
    return 0;
  },

  // Register a drawing surface on a sub-pane (e.g. an oscillator study pane), reusing the
  // compare sub-pane mechanism: an isolated drawing engine on that pane's series, placed by
  // summing the heights of the panes above it. `getPaneIndex` is a live getter (indices
  // shift as panes are added/removed). Returns the engine; pair with removePaneSurface().
  /** @this {SurfaceCtx} @param {{ series: any, bars?: () => any, store?: any }} arg */
  addPaneSurface({ series, bars, store }) {
    const engine = new DrawingEngine(this, series, { isolated: true, noInteraction: true, store });
    const topFn = () => this.paneTopOf(series); // follows the series when panes reorder
    this.surfaces.push({ engine, top: topFn, yOffset: topFn, bars: bars || (() => null) });
    engine.restore();
    return engine;
  },
  /** @this {SurfaceCtx} @param {any} engine */
  removePaneSurface(engine) {
    if (!engine) return;
    try {
      engine.destroy();
    } catch (_) {}
    this.surfaces = this.surfaces.filter((s) => s.engine !== engine);
  },
};
