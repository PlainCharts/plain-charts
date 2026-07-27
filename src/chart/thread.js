// @ts-check
// Shared on-chart DRAWING PRIMITIVES -- the one implementation of the chart's order vocabulary, usable by the
// app AND by addons. Three things live here:
//   - controllerFor(pane)     per-pane drag controller (grab + drag native price lines; the price-alerts technique)
//   - createPriceLine(pane,o) a horizontal price line (optionally draggable) -> LineHandle
//   - createThread(pane,o)    a vertical thread anchored at a TIME with draggable/clickable BEADS -> ThreadHandle
// These are PURE renderers over a kapelka pane: they take the pane EXPLICITLY and return a lifecycle handle; the
// CALLER owns cleanup (there is no auto-clear here). The addon chart-api wraps these (adding auto-clear on dialog
// close); app-level overlays like the position view build on them directly. Extracted from addons/chart-api.js so
// the basic string+dots primitive is not locked behind the addon surface.

/** @typedef {any} Pane */

// A draggable price-line registration held by a pane's drag controller.
/**
 * @typedef {Object} DragReg
 * @property {() => number|null} yOf
 * @property {(px: number) => void} setPrice
 * @property {((px: number) => void)=} onDrag
 * @property {((px: number) => void)=} onCommit
 * @property {boolean=} hidden
 * @property {number=} last
 * @property {boolean=} moved
 */
/**
 * @typedef {Object} DragController
 * @property {(reg: DragReg) => void} add
 * @property {(reg: DragReg) => void} remove
 */
/**
 * A bead descriptor strung on a thread's vline (order levels, alerts, position entries...).
 * @typedef {Object} Bead
 * @property {string|number} id
 * @property {number} price
 * @property {string=} color
 * @property {string=} label
 * @property {string=} tag
 * @property {boolean=} hidden
 * @property {boolean=} visible
 * @property {((price: number) => void)=} onDrag
 * @property {((price: number) => void)=} onCommit
 * @property {((at: { x: number, y: number, price: number }) => void)=} onClick
 */
/**
 * @typedef {Object} LineHandle
 * @property {() => number} price
 * @property {(o?: { price?: number|string, [k: string]: any }) => void} update
 * @property {(on: boolean) => void} setVisible
 * @property {() => void} remove
 */
/**
 * @typedef {Object} ThreadHandle
 * @property {(beadId: string|number, patch?: { price?: number|string, visible?: boolean, color?: string, tag?: string }) => void} update
 * @property {(bead: Bead) => void} addBead    dynamically string a NEW bead on the thread (identical behaviour to a build-time bead)
 * @property {(beadId: string|number) => void} removeBead    remove a bead (its dot + axis level) by id
 * @property {(beadId: string|number) => boolean} hasBead
 * @property {(t: number|string) => void} setTime
 * @property {() => number} time
 * @property {(on: boolean) => void} setVisible
 * @property {() => void} remove
 */

// ----------------------------------------------------------------------------------------
// Drag controller -- one per pane. While the cursor is over a draggable line we lock chart pan/scale (so a press
// starts a DRAG, not a pan), then track the mouse to re-price the line. Native price lines do the rendering; we
// only add the grab/drag on top.
const DRAG_TOL = 7;                  // px from a line to grab it
/** @type {Map<any, DragController>} */
const controllers = new Map();       // pane.chart -> controller

/** @param {Pane} p @returns {DragController} */
export function controllerFor(p) {
  let c = controllers.get(p.chart);
  if (c) return c;
  const el = p.chart.rootEl();
  const series = p.series;
  /** @type {Set<DragReg>} */
  const regs = new Set();
  /** @type {DragReg|null} */
  let drag = null;
  let locked = false;

  const rect = () => el.getBoundingClientRect();
  /** @param {MouseEvent} e */
  const yOf = (e) => e.clientY - rect().top;
  /** @param {MouseEvent} e */
  const overAxis = (e) => { let w = 0; try { w = series.priceAxis().width(); } catch (_) {} return (e.clientX - rect().left) > el.clientWidth - w; };
  /** @param {number} y @returns {DragReg|null} */
  const nearest = (y) => { /** @type {DragReg|null} */ let best = null; let bd = DRAG_TOL; for (const r of regs) { if (r.hidden) continue; const ly = r.yOf(); if (ly == null) continue; const d = Math.abs(y - ly); if (d <= bd) { bd = d; best = r; } } return best; };
  /** @param {boolean} on */
  const setLock = (on) => { if (on === locked) return; locked = on; try { p.chart.configure({ handleScroll: !on, handleScale: !on }); } catch (_) {} try { el.classList.toggle('drag-cursor-ns', on); } catch (_) {} };

  /** @param {MouseEvent} e */
  const onHover = (e) => { if (drag) return; if (overAxis(e)) { setLock(false); return; } setLock(!!nearest(yOf(e))); };
  /** @param {MouseEvent} e */
  const dragMove = (e) => { if (!drag) return; const px = series.yToPrice(yOf(e)); if (px == null) return; drag.last = px; drag.moved = true; drag.setPrice(px); if (drag.onDrag) try { drag.onDrag(px); } catch (_) {} };
  const dragUp = () => { document.removeEventListener('mousemove', dragMove, true); document.removeEventListener('mouseup', dragUp, true); const d = drag; drag = null; setLock(false); if (d && d.moved && d.onCommit) try { d.onCommit(/** @type {number} */ (d.last)); } catch (_) {} };
  /** @param {MouseEvent} e */
  const onDown = (e) => { if (overAxis(e)) return; const hit = nearest(yOf(e)); if (!hit) return; drag = hit; drag.moved = false; drag.last = series.yToPrice(yOf(e)); document.addEventListener('mousemove', dragMove, true); document.addEventListener('mouseup', dragUp, true); };

  el.addEventListener('mousemove', onHover);
  el.addEventListener('mousedown', onDown);
  c = {
    add: (reg) => regs.add(reg),
    remove: (reg) => { regs.delete(reg); if (drag === reg) dragUp(); if (!regs.size) { el.removeEventListener('mousemove', onHover); el.removeEventListener('mousedown', onDown); setLock(false); controllers.delete(p.chart); } },
  };
  controllers.set(p.chart, c);
  return c;
}

// horizontal price line (entry / stop / target / any level). Returns a handle; the CALLER removes it.
/**
 * @param {Pane} p
 * @param {{ price?: number|string, color?: string, lineWidth?: number, title?: string, showAxisLabel?: boolean, draggable?: boolean, onDrag?: (px: number) => void, onCommit?: (px: number) => void }} [opts]
 * @returns {LineHandle|null}
 */
export function createPriceLine(p, opts = {}) {
  if (!p) return null;
  const series = p.series;
  const state = { price: Number(opts.price) || 0 };
  const ln = series.addLevel({
    price: state.price,
    color: opts.color || '#2962ff',
    lineWidth: opts.lineWidth || 1,
    title: opts.title || '',
    showAxisLabel: opts.showAxisLabel !== false,
  });
  /** @param {number} px */
  const setPrice = (px) => { state.price = px; try { ln.configure({ price: px }); } catch (_) {} };
  /** @type {DragReg|null} */
  let reg = null;
  /** @type {DragController|null} */
  let ctrl = null;
  if (opts.draggable) {
    ctrl = controllerFor(p);
    reg = { yOf: () => { try { return series.priceToY(state.price); } catch (_) { return null; } }, setPrice, onDrag: opts.onDrag, onCommit: opts.onCommit };
    ctrl.add(reg);
  }
  /** @type {LineHandle} */
  const handle = {
    price: () => state.price,
    update: (o = {}) => { if (o.price != null) state.price = Number(o.price); try { ln.configure(o); } catch (_) {} },
    setVisible: (on) => { try { ln.configure({ showLine: !!on, showAxisLabel: !!on }); } catch (_) {} if (reg) reg.hidden = !on; },
    remove: () => { if (ctrl && reg) ctrl.remove(reg); try { series.removeLevel(ln); } catch (_) {} },
  };
  return handle;
}

// a VLINE with BEADS on it. Anchored at a TIME; beads at PRICES. Drag the vline to move through time; drag a bead
// to reprice; tap a bead to click. Rendered as a light DOM overlay that tracks pan/zoom each frame. Caller removes.
/**
 * @param {Pane} p
 * @param {{ time?: number|string, style?: { width?: number, dash?: boolean, color?: string }, beads?: Bead[], onMove?: (t: number) => void, onMoveCommit?: (t: number) => void }} [opts]
 * @returns {ThreadHandle|null}
 */
export function createThread(p, opts = {}) {
  if (!p) return null;
  const host = p.chart.rootEl();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;';
  host.appendChild(layer);

  const st = opts.style || {};
  const state = { time: Number(opts.time), beads: (opts.beads || []).map((b) => ({ ...b, price: Number(b.price) })) };
  const vline = document.createElement('div');
  vline.style.cssText = 'position:absolute;top:0;bottom:0;width:0;pointer-events:auto;cursor:ew-resize;'
    + 'border-left:' + (st.width || 1) + 'px ' + (st.dash ? 'dashed' : 'solid') + ' ' + (st.color || 'rgba(150,160,170,0.45)') + ';';
  layer.appendChild(vline);

  /** @type {Map<string|number, { el: HTMLDivElement, level: any, b: Bead }>} */
  const beadEls = new Map();

  const ta = () => p.chart.timeAxis();
  /** @param {number} t @returns {number|null} */
  const t2x = (t) => { try { return ta().timeToX(t); } catch (_) { return null; } };
  /** @param {number} pr @returns {number|null} */
  const p2y = (pr) => { try { return p.series.priceToY(pr); } catch (_) { return null; } };
  /** @param {number} y @returns {number|null} */
  const y2p = (y) => { try { return p.series.yToPrice(y); } catch (_) { return null; } };
  /** @param {number} x @returns {number|null} */
  const x2t = (x) => { try { return ta().xToTime(x); } catch (_) { return null; } };
  const rect = () => host.getBoundingClientRect();
  /** @param {Bead} b */
  const syncLevel = (b) => { const be = beadEls.get(b.id); if (be && be.level) try { be.level.configure({ price: b.price }); } catch (_) {} };

  let raf = 0;
  let dead = false;
  /** @type {string|number|null} */
  let draggingId = null;   // the bead the user is actively dragging -- external price updates to it are ignored (the drag owns its position until release)
  let timeDragging = false;   // true while the user drags the VLINE through time -- render-loop setTime is ignored so it doesn't snap back
  /** @param {boolean} onOff */
  const lock = (onOff) => { try { p.chart.configure({ handleScroll: !onOff, handleScale: !onOff }); } catch (_) {} };
  // Pin the chart's vertical crosshair to THIS thread's line while a bead/the vline is hovered or
  // dragged, so it stops wandering off the string in the whitespace. The horizontal price
  // line keeps tracking the mouse y. Pass a live getter so the pin tracks pan. Released on leave/drop.
  const snapVert = () => { try { p.chart.setCursorSnapX(() => t2x(state.time)); } catch (_) {} };
  const snapOff = () => { try { p.chart.setCursorSnapX(null); } catch (_) {} };

  // build ONE bead: its dot element + axis level + (when it carries handlers) the drag/click interaction. Called at
  // creation for each opts.bead AND by handle.addBead(), so a bead strung on later behaves identically to a build-time one.
  /** @param {Bead} b */
  function mountBead(b) {
    const el = document.createElement('div');
    const sz = b.label ? 18 : 12;
    const draggable = !!(b.onDrag || b.onCommit);
    const interactive = draggable || !!b.onClick;
    el.style.cssText = 'position:absolute;pointer-events:' + (interactive ? 'auto' : 'none') + ';cursor:' + (b.onClick ? 'pointer' : draggable ? 'ns-resize' : 'default') + ';transform:translate(-50%,-50%);box-sizing:border-box;'
      + 'width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:' + (b.color || '#2962ff') + ';'
      + 'border:2px solid #0e0e11;box-shadow:0 0 0 1px rgba(255,255,255,.25);'
      + (b.label ? 'color:#fff;text-align:center;font-family:system-ui,sans-serif;font-weight:600;font-size:10px;line-height:' + (sz - 4) + 'px;' : '');
    if (b.label) el.textContent = b.label;
    layer.appendChild(el);
    if (b.visible === false) b.hidden = true;
    let level = null;
    try { level = p.series.addLevel({ price: b.price, showLine: false, showAxisLabel: !b.hidden, color: b.color || '#2962ff', axisLabelColor: b.color || '#2962ff', axisLabelTextColor: '#fff', title: b.tag || '' }); } catch (_) {}
    beadEls.set(b.id, { el, level, b });
    const canDrag = draggable, canClick = !!b.onClick;
    if (!canDrag && !canClick) return;
    // hover the bead -> pin the vertical crosshair to the string (release on leave, unless dragging this bead)
    el.addEventListener('mouseenter', snapVert);
    el.addEventListener('mouseleave', () => { if (draggingId !== b.id) snapOff(); });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY; let moved = false;
      if (canDrag) lock(true);
      /** @param {MouseEvent} ev @returns {number|null} */
      const apply = (ev) => { const pr = y2p(ev.clientY - rect().top); if (pr == null) return null; b.price = pr; syncLevel(b); return pr; };
      /** @param {MouseEvent} ev */
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
        if (moved && canDrag) { draggingId = b.id; const pr = apply(ev); if (pr != null) try { b.onDrag && b.onDrag(pr); } catch (_) {} }
      };
      /** @param {MouseEvent} ev */
      const up = (ev) => {
        document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); if (canDrag) lock(false); draggingId = null;
        const rr = el.getBoundingClientRect();   // keep the pin only if the pointer settled back on the bead; else release
        if (!(ev.clientX >= rr.left && ev.clientX <= rr.right && ev.clientY >= rr.top && ev.clientY <= rr.bottom)) snapOff();
        if (moved && canDrag) { const pr = apply(ev); if (pr != null) try { /** @type {(px: number) => void} */ (b.onCommit || b.onDrag)(pr); } catch (_) {} }
        else if (canClick) { const r = el.getBoundingClientRect(); try { /** @type {(at: { x: number, y: number, price: number }) => void} */ (b.onClick)({ x: r.left + r.width / 2, y: r.top + r.height / 2, price: b.price }); } catch (_) {} }
      };
      document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
    });
  }
  state.beads.forEach(mountBead);

  let lastGeo = '';   // geometry signature -- skip all style writes when nothing moved (the rAF loop runs per frame)
  function layout() {
    const x = t2x(state.time);
    let geo = String(x);
    for (const b of state.beads) geo += '|' + b.id + ':' + (b.hidden ? 'h' : p2y(b.price));
    if (geo === lastGeo) return;
    lastGeo = geo;
    if (x != null) vline.style.left = x + 'px';
    state.beads.forEach((b) => {
      const be = beadEls.get(b.id); if (!be) return;
      const y = p2y(b.price);
      if (x == null || y == null || b.hidden) { be.el.style.display = 'none'; return; }
      be.el.style.display = ''; be.el.style.left = x + 'px'; be.el.style.top = y + 'px';
    });
  }
  const tick = () => { if (dead) return; layout(); raf = requestAnimationFrame(tick); };
  tick();

  /** @param {(ev: MouseEvent, commit?: boolean) => void} moveFn */
  const startDrag = (moveFn) => /** @param {MouseEvent} e */ (e) => {
    e.preventDefault(); e.stopPropagation(); lock(true);
    /** @param {MouseEvent} ev */
    const move = (ev) => moveFn(ev);
    /** @param {MouseEvent} ev */
    const up = (ev) => { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); lock(false); moveFn(ev, true); };
    document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
  };
  vline.addEventListener('mouseenter', snapVert);   // hovering the string pins the vertical crosshair to it
  vline.addEventListener('mouseleave', () => { if (!timeDragging) snapOff(); });
  vline.addEventListener('mousedown', startDrag((ev, commit) => {
    const t = x2t(ev.clientX - rect().left); if (t == null) return;
    state.time = t; timeDragging = !commit;   // own the vline position during the drag; release it on commit
    if (commit) snapOff();   // released the line -> normal crosshair
    try { (commit ? opts.onMoveCommit : opts.onMove) && /** @type {(t: number) => void} */ (commit ? opts.onMoveCommit : opts.onMove)(t); } catch (_) {}
  }));

  /** @type {ThreadHandle} */
  const handle = {
    update: (beadId, patch = {}) => {
      const b = state.beads.find((x) => x.id === beadId); if (!b) return;
      const be = beadEls.get(beadId);
      if (patch.price != null && beadId !== draggingId && Number(patch.price) !== b.price) { b.price = Number(patch.price); if (be && be.level) try { be.level.configure({ price: b.price }); } catch (_) {} }   // don't fight an active drag; skip unchanged prices (an unconditional configure forces an engine repaint per frame under the ride loop)
      if (patch.visible !== undefined) { b.hidden = !patch.visible; if (be && be.level) try { be.level.configure({ showAxisLabel: !b.hidden }); } catch (_) {} }
      if (patch.color) { b.color = patch.color; if (be) { be.el.style.background = patch.color; if (be.level) try { be.level.configure({ color: patch.color, axisLabelColor: patch.color }); } catch (_) {} } }
      if (patch.tag != null) { b.tag = patch.tag; if (be && be.level) try { be.level.configure({ title: patch.tag }); } catch (_) {} }
    },
    addBead: (b) => { if (!b || beadEls.has(b.id)) return; const nb = /** @type {Bead} */ ({ ...b, price: Number(b.price) }); state.beads.push(nb); mountBead(nb); },
    removeBead: (beadId) => {
      const be = beadEls.get(beadId); if (!be) return;
      if (draggingId === beadId) draggingId = null;
      try { be.el.remove(); } catch (_) {}
      if (be.level) try { p.series.removeLevel(be.level); } catch (_) {}
      beadEls.delete(beadId);
      state.beads = state.beads.filter((x) => x.id !== beadId);
    },
    hasBead: (beadId) => beadEls.has(beadId),
    setTime: (t) => { if (!timeDragging) state.time = Number(t); },   // don't fight an active vline drag
    time: () => state.time,
    setVisible: (onOff) => { layer.style.display = onOff ? '' : 'none'; beadEls.forEach((be) => { if (be.level) try { be.level.configure({ showAxisLabel: !!onOff && !be.b.hidden }); } catch (_) {} }); },
    remove: () => { dead = true; snapOff(); if (raf) cancelAnimationFrame(raf); beadEls.forEach((be) => { if (be.level) try { p.series.removeLevel(be.level); } catch (_) {} }); try { layer.remove(); } catch (_) {} },
  };
  return handle;
}
