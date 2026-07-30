// @ts-check
// On-chart control chrome for a Pane: the hover nav toolbar (zoom / maximize / scroll / reset), the
// corner settings gear, the "scroll to now" button, the countdown / spread / status elements, and the
// board/compare control cluster (reorder / collapse / maximize + H/L toggle + chart-type gear). Split
// out of pane.js as a prototype mixin -- these methods run with `this` bound to the Pane instance.
import { bus } from '../../bus.js';
import { openChartSettings } from '../../settings/chart-settings.js';
import { candleOptions } from '../pane-defaults.js';

// The methods below run with `this` bound to the Pane instance. The Pane wraps the vendored kapelka
// chart engine and has no TS types here, so `this` is the engine `any` boundary; the DOM elements and
// typed callback params still get real types.
/** @type {Record<string, any> & ThisType<any>} */
export const controlMethods = {
  // hover toolbar: zoom, maximize, scroll
  addControls() {
    const bar = document.createElement('div');
    bar.className = 'pane-controls';
    this.controls = bar;
    /** @type {(label: string, title: string, fn: () => void, cls?: string) => HTMLButtonElement} */
    const mk = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      if (cls) b.className = cls;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      return b;
    };
    bar.append(
      mk('−', 'Zoom out', () => this.zoom(1.25)),
      mk('+', 'Zoom in', () => this.zoom(0.8)),
      mk('⤢', 'Maximize / restore', () => bus.emit('pane:maximize', this), 'nav-max'),
      mk('‹', 'Scroll back', () => this.scroll(-this.scrollStep())),
      mk('›', 'Scroll forward', () => this.scroll(this.scrollStep())),
      mk('↺', 'Reset chart view (auto-fit)', () => this.resetView()),
    );
    this.el.appendChild(bar);

    // "Visible on mouse over": reveal the nav buttons only when the cursor is NEAR them
    // (a hot-zone around the bar) — not whenever the mouse is anywhere on the chart.
    const NEAR = 28; // px margin around a control row that counts as "over" it
    const nearRect = (/** @type {PointerEvent} */ e, /** @type {Element} */ el) => {
      const r = el.getBoundingClientRect();
      return (
        e.clientX >= r.left - NEAR &&
        e.clientX <= r.right + NEAR &&
        e.clientY >= r.top - NEAR &&
        e.clientY <= r.bottom + NEAR
      );
    };
    this.el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (this.controls) this.controls.classList.toggle('near', nearRect(e, this.controls));
      // sub-pane + compare control rows reveal independently when the cursor is near each one
      // (not on whole-pane hover) - same hot-zone behaviour as the navigation bar.
      this.el
        .querySelectorAll('.pane-compare-ctrls, .skin-ctrls')
        .forEach((/** @type {Element} */ c) => c.classList.toggle('near', nearRect(e, c)));
    });
    this.el.addEventListener('pointerleave', () => {
      if (this.controls) this.controls.classList.remove('near');
      this.el
        .querySelectorAll('.pane-compare-ctrls.near, .skin-ctrls.near')
        .forEach((/** @type {Element} */ c) => c.classList.remove('near'));
    });

    // settings gear pinned to the bottom-right corner (time/price scale junction)
    const gear = document.createElement('button');
    gear.className = 'pane-gear-corner';
    gear.textContent = '⚙';
    gear.title = 'Chart settings';
    gear.onclick = (e) => {
      e.stopPropagation();
      openChartSettings(this, gear.getBoundingClientRect());
    };
    this.el.appendChild(gear);

    // "scroll to most recent" — shown only when scrolled back from the latest bar
    this.forwardBtn = document.createElement('button');
    this.forwardBtn.className = 'pane-forward';
    this.forwardBtn.textContent = '»';
    this.forwardBtn.title = 'Scroll to most recent';
    this.forwardBtn.onclick = (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      this.chart.timeAxis().scrollToNow();
    };
    this.el.appendChild(this.forwardBtn);

    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'pane-countdown';
    this.el.appendChild(this.countdownEl);

    this.spreadEl = document.createElement('div');
    this.spreadEl.className = 'pane-spread';
    this.el.appendChild(this.spreadEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'pane-status';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'ps-title';
    this.valuesEl = document.createElement('span');
    this.valuesEl.className = 'ps-values';
    // market-status dot -- far right of all else in the status line (updateMarketDot colours/shows it)
    this.mktDotEl = document.createElement('span');
    this.mktDotEl.className = 'ps-mkt';
    this.mktDotEl.style.cssText =
      'display:none;width:8px;height:8px;border-radius:50%;margin-left:7px;vertical-align:middle;cursor:pointer;pointer-events:auto;'; // parent .pane-status is pointer-events:none
    this.mktDotEl.onclick = (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      this._toggleMarketPopup();
    }; // -> market-hours info popup
    this.statusEl.append(this.titleEl, this.valuesEl, this.mktDotEl);
    this.el.appendChild(this.statusEl);
    this.applyStatus();
    this._mktTimer = setInterval(() => this.updateMarketDot(), 20000); // the dot tracks the session clock
    this.updateMarketDot();
    this._buildBoardCtrls(); // compare/price board pane: reorder/collapse/max controls (studies get theirs from the skin)
    this._buildMainHL(); // main chart: quick High/Low source toggle
    // applyScale()/applyCountdown() are deferred to mount() (chart must be sized)
  },

  // A COMPARE/price board pane has no study, so the study skin renders no control cluster for it. Render
  // the SAME reorder/collapse/maximize controls here (plus the H/L toggle + chart-type gear) so a compare
  // pane behaves like the oscillator panes. Delete is intentionally omitted (like the studies).
  _buildBoardCtrls() {
    if (!(this.board && this.settings.pricePane)) return;
    const mk = (/** @type {string} */ txt, /** @type {string} */ title, /** @type {() => void} */ fn) => {
      const b = document.createElement('button');
      b.className = 'skin-ctrl';
      b.textContent = txt;
      b.title = title;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      return b;
    };
    const cluster = document.createElement('div');
    cluster.className = 'skin-ctrls board-ctrls';
    const up = mk('↑', 'Move up', () => bus.emit('board:move', { pane: this, dir: -1 }));
    const dn = mk('↓', 'Move down', () => bus.emit('board:move', { pane: this, dir: 1 }));
    const max = mk('⤢', 'Maximize', () => {
      const m = this.boardMode === 'max' ? 'normal' : 'max';
      bus.emit('board:mode', { pane: this, mode: m });
      max.title = m === 'max' ? 'Restore' : 'Maximize';
    });
    const col = mk('⌄', 'Collapse', () => {
      const m = this.boardMode === 'collapsed' ? 'normal' : 'collapsed';
      bus.emit('board:mode', { pane: this, mode: m });
      col.textContent = m === 'collapsed' ? '⌃' : '⌄';
      col.title = m === 'collapsed' ? 'Expand' : 'Collapse';
    });
    const cfg = mk('⚙', 'Chart type', () => bus.emit('charttype:open', this.chartTypeTarget()));
    cluster.append(this._makeHLBtn(), up, dn, max, col, cfg);
    cluster.style.top = '4px';
    cluster.style.right = '60px'; // sensible default until the scale width is known
    this.el.appendChild(cluster);
    this.boardCtrlsEl = cluster;
    this._positionBoardCtrls();
  },
  // Main chart (a regular candle pane): the same quick H/L source toggle, top-right by the price scale.
  _buildMainHL() {
    if (this.board || !this._series) return; // compare panes get it in their cluster; oscillators have no price series
    const cluster = document.createElement('div');
    cluster.className = 'skin-ctrls board-ctrls main-hl';
    cluster.append(this._makeHLBtn());
    cluster.style.top = '4px';
    cluster.style.right = '60px';
    this.el.appendChild(cluster);
    this.boardCtrlsEl = cluster;
    this._positionBoardCtrls();
  },
  _positionBoardCtrls() {
    if (!this.boardCtrlsEl) return;
    let sw = 0;
    try {
      sw = this.chart.priceAxis('right').width();
    } catch (_) {}
    if (sw > 0) this.boardCtrlsEl.style.right = sw + 6 + 'px'; // sit just left of the price scale (matches the study controls)
  },
  // Collapse content for a COMPARE/price board pane: hide the candles so the thin strip stays clean
  // (its status line + controls remain), mirroring how a collapsed oscillator hides its plot. No-op for
  // oscillator panes -- the study host hides their plot via the library's setPaneMode.
  /** @param {boolean} collapsed */
  setBoardCollapsed(collapsed) {
    if (!(this.board && this.settings.pricePane) || !this._series) return;
    if (collapsed)
      this._series.configure({
        upColor: 'rgba(0,0,0,0)',
        downColor: 'rgba(0,0,0,0)',
        showBorder: false,
        showWick: false,
      });
    else this._series.configure(candleOptions(this.settings.candles));
    if (this.lineSeries) {
      try {
        this.lineSeries.configure(collapsed ? { color: 'rgba(0,0,0,0)' } : this._lineOpts());
      } catch (_) {}
    }
  },
};
