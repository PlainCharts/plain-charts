// @ts-check
// Native pointer input for the chart shell -- mouse (pan, price-axis Y-zoom, pane-separator resize,
// dblclick auto-fit, wheel zoom) and touch (one-finger pan + vertical, hold-to-track crosshair,
// two-finger pinch-zoom, kinetic fling). Lifted verbatim out of Chart._wire so the gesture logic
// lives in one place instead of the shell; it keeps its closure state (mode / last-pos / long-press /
// fling velocity) intact and drives the chart through the passed reference `c`. Behavior unchanged.
import { calcZoom, calcRange } from '../yscale.js'; // ported sidebar.js zoom math
import { emitClick } from '../events.js'; // fire onClick on a touch tap

// interaction (native; feeds range/cursor, drives ported calc_zoom/range). Call once, in the ctor.
/** @param {any} c   the Chart hub (index.js -- untyped) */
export function wireInput(c) {
  const root = c._root;
  let mode = /** @type {string|null} */ (null),
    lx = 0,
    ly = 0; // mode: 'pan' | 'yzoom' | 'presize' | 'pinch' | 'track'
  let tsx = 0,
    tsy = 0,
    longTap = /** @type {ReturnType<typeof setTimeout>|null} */ (null); // touch-start pos + long-press timer (hold -> tracking crosshair)
  // handleScroll / handleScale gates: the app toggles these off (via chart.configure) to LOCK chart
  // pan/zoom -- e.g. while dragging a price-alert / addon line so the chart doesn't move underneath.
  // Default ON when unset. scroll = pan (mouse + touch); scale = zoom (wheel / pinch / price-axis drag).
  const scrollOn = () => c._options.handleScroll !== false;
  const scaleOn = () => c._options.handleScale !== false;
  root.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top,
      k = c._paneAt(y);
    lx = e.clientX;
    ly = e.clientY;
    const sep = c._separatorAt(y);
    if (sep > 0) {
      // drag the boundary between stacked panes -> resize (author's grid-resize)
      mode = 'presize';
      e.preventDefault();
      const grids = c._comp.$props.layout.grids;
      c._sepDrag = { k: sep, y0: e.clientY, h1: grids[sep - 1].height, h2: grids[sep].height };
    } else if (c._inSidebarZone(x) && k >= 0 && !c._scaleLockedAt(k) && scaleOn()) {
      // sidebar zone of pane k -> Y-zoom that pane
      mode = 'yzoom';
      c._ensureManual(k); // k = grid POSITION
      const id = c._idAt(k),
        g = c._gridAt(k),
        yst = c._yOf(id); // state by id; grid by position
      c._yDrag = {
        k: id,
        y0: e.clientY,
        z: yst.zoom,
        height: g ? g.height : c._h,
        log: c._paneLogOf(id),
        A: g ? g.A : null,
        B: g ? g.B : null,
      };
      c._yStartRange = yst.range ? yst.range.slice() : g ? [g.$_hi, g.$_lo] : null;
    } else if (c._inSidebarZone(x) && k >= 0) {
      mode = null;
    } // %/indexed: price scale locked (auto-fit only) — swallow the drag
    else if (scrollOn()) {
      mode = 'pan';
      c._panPane = k;
    } else {
      mode = null;
    } // handleScroll off (e.g. dragging an alert line) -> no chart pan
  });
  window.addEventListener('mouseup', () => {
    mode = null;
  });
  root.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
    const r = root.getBoundingClientRect();
    c._mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    c._lastPointerEvent = e;
    c._pointerMoved = true; // crosshair sourceEvent (real vs programmatic)
    if (mode === 'pan' && c._range) {
      const dx = e.clientX - lx,
        dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (dx) {
        // time pan (shared across all panes)
        const span = c._range[1] - c._range[0];
        const dt = (-dx * span) / Math.max(1, c._chartW || c._w);
        c._range = [c._range[0] + dt, c._range[1] + dt];
        c._emitRange();
      }
      // vertical pan of the pane the drag started in — manual only; log-correct via $2screen/screen2$
      if (dy && c._panPane >= 0) {
        const yst = c._yOf(c._idAt(c._panPane)),
          g = c._gridAt(c._panPane); // state by id; grid by position
        if (!yst.auto && yst.range && g)
          yst.range = [g.screen2$(g.$2screen(yst.range[0]) - dy), g.screen2$(g.$2screen(yst.range[1]) - dy)];
      }
      c._invalidate();
    } else if (mode === 'yzoom') {
      // price-axis drag = scale that pane's Y, via trading-vue's calc_zoom/calc_range
      const d = c._yDrag;
      if (d && c._yStartRange) {
        const z = calcZoom(d, e.clientY);
        c._yOf(d.k).zoom = z;
        c._yOf(d.k).range = c._clampVZoom(
          calcRange(c._yStartRange, z / d.z, d.log ? { A: d.A, B: d.B, height: d.height } : null),
          d.k,
        ); // cap vertical over-compression
      }
      c._invalidate();
    } else if (mode === 'presize') {
      // dragging a pane boundary -> resize
      c._resizePanes(e.clientY);
      c._invalidate();
    } else {
      // plain hover: only the crosshair moved -> cursor-only repaint (grids keep their last paint).
      // The separator highlight lives ON the grid canvas, so a hover-state flip needs a full paint.
      const sep = c._separatorAt(c._mouse.y);
      const sepChanged = sep !== c._sepHover;
      c._sepHover = sep;
      if (sepChanged) c._schedule();
      else c._scheduleCursor();
    }
  });
  root.addEventListener('mouseleave', (/** @type {MouseEvent} */ e) => {
    const wasSep = c._sepHover > 0; // an active separator highlight must be erased from the grid canvas
    c._mouse = null;
    c._sepHover = -1;
    c._leaveEvent = e;
    if (wasSep) c._schedule();
    else c._scheduleCursor();
  });
  root.addEventListener('dblclick', (/** @type {MouseEvent} */ e) => {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top,
      k = c._paneAt(y);
    if (c._inSidebarZone(x) && k >= 0) {
      const yst = c._yOf(c._idAt(k));
      yst.auto = true;
      yst.range = null;
      yst.zoom = 1;
      c._invalidate();
      return;
    } // price axis -> reset that pane to auto-fit (state by id)
    // double-click the TIME axis (the bottom strip) -> scroll to the latest bar (the horizontal twin
    // of the price-axis reset above; same action as the "scroll to now" button).
    const L = c._comp.$props.layout,
      bb = L && L.botbar;
    if (c._showTime && bb && !c._inSidebarZone(x) && y >= bb.offset) {
      try {
        c.timeAxis().scrollToNow();
      } catch (_) {}
    }
  });
  root.addEventListener(
    'wheel',
    (/** @type {WheelEvent} */ e) => {
      if (!c._range) return;
      // Shift + wheel = scroll the time window left/right, no zoom. A navigation gesture, so it is gated by
      // handleScroll (not handleScale). Wheel down = forward, ~5% of the visible window per notch; the range
      // shift matches touch/drag pan (whitespace allowed), not a bar-count clamp.
      if (e.shiftKey) {
        if (!scrollOn()) return;
        const d = e.deltaY || e.deltaX;
        e.preventDefault();
        if (!d) return;
        const span = c._range[1] - c._range[0],
          step = (d > 0 ? 1 : -1) * span * 0.05;
        c._range = [c._range[0] + step, c._range[1] + step];
        c._emitRange();
        c._invalidate();
        return;
      }
      if (!scaleOn()) return;
      e.preventDefault(); // handleScale off -> no wheel zoom
      // Author's grid.js mousezoom, transcribed for the engine's index-space range. The original
      // GUARDS on the visible bar count (this.data.length), steps proportional to it, and is
      // RIGHT-anchored by default (only the left edge moves; ctrl zooms under the cursor). That
      // guard is what prevents over-compression, and the right anchor is what kept the price scale
      // from jumping. The previous cursor-centered span zoom had neither. (Can't call mousezoom()
      // directly: in ib mode its interval is real-ms while our range is index units -> mismatch.)
      const n = c._visibleCount();
      if (n < 2) return;
      const out = e.deltaY > 0;
      if (out && n > c._maxZoom()) return; // can't zoom out past maxZoom bars (over-compression)
      if (!out && n <= c._minZoom()) return; // can't zoom in past minZoom bars (over-zoom limit)
      const step = c._ib ? 1 : c._iv();
      const diff = (out ? 1 : -1) * 50 * (step / 1000) * n; // his: delta(=±50) * (interval/1000) * N
      const [t0, t1] = c._range;
      if (e.ctrlKey) {
        // Ctrl+wheel = a true 2D zoom around the cursor (Photoshop-style): scale BOTH the time window
        // and the pane-under-the-cursor's price window by the SAME factor, keeping the data point under
        // the cursor pinned. (Plain wheel, below, only contracts/expands the bar spacing, right-anchored.)
        // Price zoom is scale-agnostic (linear/log) by going through screen2$.
        const rect = root.getBoundingClientRect();
        const f = out ? 1.2 : 1 / 1.2; // >1 = zoom out (see more), <1 = zoom in
        const mx = e.clientX - rect.left - c._chartLeftPx;
        const fx = Math.max(0, Math.min(1, mx / Math.max(1, c._chartW || c._w))); // cursor x fraction
        const span = t1 - t0,
          tc = t0 + fx * span; // time under the cursor
        c._range = c._clampZoom([tc - fx * span * f, tc + (1 - fx) * span * f], tc);
        // price: zoom the pane under the cursor around the cursor's price (skip %/indexed locked panes)
        const rY = e.clientY - rect.top,
          k = c._paneAt(rY);
        if (k >= 0 && !c._scaleLockedAt(k)) {
          c._ensureManual(k); // switch to a manual price window seeded with the current extent
          const id = c._idAt(k),
            g = c._gridAt(k),
            yst = c._yOf(id);
          if (g && yst && yst.range) {
            const yc = rY - g.offset,
              H = g.height || 1; // cursor y in grid-local px
            const nhi = g.screen2$(yc * (1 - f)),
              nlo = g.screen2$(yc + f * (H - yc)); // keep yc fixed
            if (isFinite(nhi) && isFinite(nlo) && nhi !== nlo) {
              yst.range = c._clampVZoom([nhi, nlo], id);
              yst.zoom = (yst.zoom || 1) / f;
            } // cap vertical over-compression
          }
        }
      } else {
        c._range = [t0 - diff, t1]; // right-anchored (default)
      }
      c._emitRange();
      c._invalidate();
    },
    { passive: false },
  );

  // --- touch: one finger pans (time + vertical), two fingers pinch-zoom the time scale ---
  /** @param {Touch} a @param {Touch} b */
  const dist2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  let flickVx = 0,
    flickT = 0; // horizontal fling velocity (px/ms) for the kinetic smooth stop
  /** @param {number} dxPx */
  const panBy = (dxPx) => {
    if (!c._range) return;
    const span = c._range[1] - c._range[0],
      dt = (-dxPx * span) / Math.max(1, c._chartW || c._w);
    c._range = [c._range[0] + dt, c._range[1] + dt];
    c._emitRange();
  };
  const cancelKinetic = () => {
    if (c._kinetic) {
      cancelAnimationFrame(c._kinetic);
      c._kinetic = 0;
    }
  };
  /** @param {number} v0 */
  const startKinetic = (v0) => {
    // coast the pan, decaying velocity with exponential friction
    cancelKinetic();
    let v = v0,
      last = performance.now();
    const step = () => {
      const now = performance.now(),
        dt = Math.min(48, now - last);
      last = now;
      panBy(v * dt);
      c._invalidate();
      v *= Math.exp(-dt / 160); // friction (tau = 160ms)
      c._kinetic = Math.abs(v) < 0.01 ? 0 : requestAnimationFrame(step);
    };
    c._kinetic = requestAnimationFrame(step);
  };
  root.addEventListener(
    'touchstart',
    (/** @type {TouchEvent} */ e) => {
      c._mouse = null; // no hover crosshair during touch
      cancelKinetic();
      flickVx = 0;
      flickT = 0; // a new touch stops any coasting (like a phone list)
      clearTimeout(/** @type {any} */ (longTap));
      longTap = null;
      if (e.touches.length === 1) {
        const t = e.touches[0],
          rr = root.getBoundingClientRect();
        const x = t.clientX - rr.left,
          y = t.clientY - rr.top,
          k = c._paneAt(y);
        lx = t.clientX;
        ly = t.clientY;
        tsx = t.clientX;
        tsy = t.clientY;
        if (c._inSidebarZone(x) && k >= 0 && !c._scaleLockedAt(k) && scaleOn()) {
          // finger on the price axis -> Y-zoom that pane
          mode = 'yzoom';
          c._ensureManual(k);
          const id = c._idAt(k),
            g = c._gridAt(k),
            yst = c._yOf(id);
          c._yDrag = {
            k: id,
            y0: t.clientY,
            z: yst.zoom,
            height: g ? g.height : c._h,
            log: c._paneLogOf(id),
            A: g ? g.A : null,
            B: g ? g.B : null,
          };
          c._yStartRange = yst.range ? yst.range.slice() : g ? [g.$_hi, g.$_lo] : null;
        } else if (c._inSidebarZone(x) && k >= 0) {
          // %/indexed: price scale locked (auto-fit only)
          mode = null;
        } else if (scrollOn()) {
          mode = 'pan';
          c._panPane = k;
          // held still ~250ms -> tracking mode: the crosshair follows the finger to read values
          longTap = setTimeout(() => {
            longTap = null;
            mode = 'track';
            c._mouse = { x: tsx - rr.left, y: tsy - rr.top };
            c._pointerMoved = true;
            c._invalidate();
          }, 250);
        } else {
          mode = null;
        } // handleScroll off -> no touch pan
      } else if (e.touches.length === 2 && c._range && scaleOn()) {
        const a = e.touches[0],
          b = e.touches[1],
          rr = root.getBoundingClientRect();
        const midX = (a.clientX + b.clientX) / 2 - rr.left - c._chartLeftPx;
        mode = 'pinch';
        c._pinch = {
          d0: dist2(a, b),
          t0: c._range[0],
          t1: c._range[1],
          f: Math.max(0, Math.min(1, midX / Math.max(1, c._chartW || c._w))),
        };
      }
    },
    { passive: true },
  );
  root.addEventListener(
    'touchmove',
    (/** @type {TouchEvent} */ e) => {
      if (mode === 'track' && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0],
          rr = root.getBoundingClientRect();
        c._mouse = { x: t.clientX - rr.left, y: t.clientY - rr.top };
        c._pointerMoved = true;
        c._invalidate();
      } else if (mode === 'pan' && e.touches.length === 1 && c._range) {
        e.preventDefault();
        const t = e.touches[0],
          dx = t.clientX - lx,
          dy = t.clientY - ly;
        lx = t.clientX;
        ly = t.clientY;
        if (longTap && (Math.abs(t.clientX - tsx) > 6 || Math.abs(t.clientY - tsy) > 6)) {
          clearTimeout(longTap);
          longTap = null;
        } // moved -> a pan, not a hold
        if (dx) {
          panBy(dx);
          const now = performance.now(),
            ddt = now - (flickT || now);
          if (ddt > 0) flickVx = 0.7 * (dx / ddt) + 0.3 * flickVx;
          flickT = now;
        } // track velocity for the fling
        if (dy && c._panPane >= 0) {
          const yst = c._yOf(c._idAt(c._panPane)),
            g = c._gridAt(c._panPane);
          if (!yst.auto && yst.range && g)
            yst.range = [g.screen2$(g.$2screen(yst.range[0]) - dy), g.screen2$(g.$2screen(yst.range[1]) - dy)];
        }
        c._invalidate();
      } else if (mode === 'yzoom' && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0],
          d = c._yDrag;
        if (d && c._yStartRange) {
          const z = calcZoom(d, t.clientY);
          c._yOf(d.k).zoom = z;
          c._yOf(d.k).range = c._clampVZoom(
            calcRange(c._yStartRange, z / d.z, d.log ? { A: d.A, B: d.B, height: d.height } : null),
            d.k,
          ); // cap vertical over-compression
        }
        c._invalidate();
      } else if (mode === 'pinch' && e.touches.length === 2 && c._pinch) {
        e.preventDefault();
        const p = c._pinch,
          cur = dist2(e.touches[0], e.touches[1]);
        const scale = Math.max(0.05, cur / Math.max(1, p.d0)); // fingers apart -> scale>1 -> zoom in
        const span = p.t1 - p.t0,
          step = c._ib ? 1 : c._iv();
        let newSpan = span / scale,
          bars = newSpan / step;
        bars = Math.max(c._minZoom(), Math.min(c._maxZoom(), bars));
        newSpan = bars * step; // clamp bar count
        const midT = p.t0 + p.f * span;
        c._range = [midT - p.f * newSpan, midT + (1 - p.f) * newSpan];
        c._emitRange();
        c._invalidate();
      }
    },
    { passive: false },
  );
  /** @param {TouchEvent} e */
  const touchEnd = (e) => {
    const tap = mode === 'pan' && longTap !== null; // released before the hold fired + never dragged = a tap
    clearTimeout(/** @type {any} */ (longTap));
    longTap = null;
    if (e.touches.length === 0) {
      if (mode === 'track') {
        c._mouse = null;
        c._invalidate();
      } // release the hold -> hide the crosshair
      else if (tap) {
        // quick tap -> place the crosshair (read) + fire the click event (select/place)
        const rr = root.getBoundingClientRect(),
          px = tsx - rr.left,
          py = tsy - rr.top;
        c._mouse = { x: px, y: py };
        c._pointerMoved = true;
        c._invalidate();
        emitClick(c, px, py);
      } else if (mode === 'pan' && Math.abs(flickVx) > 0.12 && performance.now() - flickT < 80 && c._range)
        startKinetic(flickVx); // released mid-move -> coast
      mode = null;
      c._pinch = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      mode = 'pan';
      lx = t.clientX;
      ly = t.clientY;
      tsx = t.clientX;
      tsy = t.clientY;
      c._panPane = c._paneAt(t.clientY - root.getBoundingClientRect().top);
      c._pinch = null;
    }
  };
  root.addEventListener('touchend', touchEnd, { passive: true });
  root.addEventListener('touchcancel', touchEnd, { passive: true });
}
