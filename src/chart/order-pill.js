// @ts-check
// On-chart order PILL: a rounded label floating in the chart body (away from the price scale) at a price's y,
// with a thin connector extending toward the scale and a colored PRICE badge on the scale at the attachment
// point. The pill is a row of independently clickable CELLS (segments). Optionally DRAGGABLE vertically with
// DROP semantics: the pill tracks the pointer itself and reports the price on RELEASE only (onCommit) -- the
// thread-bead behaviour, so a mid-drag pass over a level never fires anything. Optional KEBAB SIDES: detachable
// circles flanking the pill ([S] pill [T]) -- drag one OFF the pill and it reports onDetach(price) at the drop,
// the caller turning that into a separate level. A pure renderer over a kapelka pane; the caller owns remove().
/** @typedef {{ text: string, color?: string, visible?: boolean, onDetach: (price: number) => void }} PillSide */
/**
 * @param {any} pane   a kapelka pane
 * @param {{ price?: number|string, label?: string, color?: string, width?: number,
 *           segments?: { text?: string, onClick?: (cell: HTMLElement) => void }[],
 *           sides?: { left?: PillSide, right?: PillSide },
 *           layout?: { extend?: boolean, side?: 'left'|'right', offset?: number },
 *           line?: { width?: number, style?: string, color?: string },
 *           onClick?: () => void, onDrag?: (price: number) => void, onCommit?: (price: number) => void,
 *           canDrag?: () => boolean }} [opts]
 *   segments = clickable CELLS in the pill (each fires its own onClick with its cell element -- anchor a picker
 *   to it / update its text); falls back to a single non-clickable `label`. onClick (pill-level) fires on a tap
 *   anywhere without a cell handler; onDrag/onCommit make the whole pill draggable (commit on release).
 *   canDrag gates each gesture at mousedown: the pill is reconciled in place (never rebuilt), so a pill whose
 *   draggability depends on live state (a MARKET projection must not drag; LMT/STP must) answers per-drag.
 *   sides = the kebab pieces: left sits before the pill, right after it (on the connector).
 * @returns {{ update: (o?: { price?: number|string, label?: string, color?: string, segments?: (string|null)[], sides?: { left?: boolean, right?: boolean } }) => void, remove: () => void } | null}
 */
export function createOrderPill(pane, opts = {}) {
  if (!pane) return null;
  const host = pane.chart.rootEl();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;';
  host.appendChild(layer);

  const state = { price: Number(opts.price) || 0, label: opts.label || '', color: opts.color || '#2962ff' };
  const draggable = !!(opts.onDrag || opts.onCommit);
  // effective per-gesture draggability: the static capability AND the caller's live gate (if any)
  const dragOn = () => draggable && (!opts.canDrag || opts.canDrag() !== false);

  // PLACEMENT (caller/layout config): which chart side the pill sits on, its offset from the price scale
  // (0 = flush; on the left side, from the left edge), and whether the price line EXTENDS across the chart.
  const lay = opts.layout || {};
  const laySide = lay.side === 'left' ? 'left' : 'right';
  const layOff = Number.isFinite(Number(lay.offset)) ? Math.max(0, Number(lay.offset)) : 50;
  const layExtend = !!lay.extend;
  // LINE styling: thickness + solid/dashed/dotted + colour (empty colour = match the pill's own colour)
  const ln = opts.line || {};
  const lnW =
    Number.isFinite(Number(ln.width)) && Number(ln.width) >= 1 ? Math.min(6, Math.round(Number(ln.width))) : 1;
  const lnStyle = ln.style === 'dashed' || ln.style === 'dotted' ? ln.style : 'solid';
  const lnColor = typeof ln.color === 'string' ? ln.color : '';

  // thin price line: the CONNECTOR pill -> price scale always draws; `lineL` is the EXTENSION from the chart's
  // left edge to the pill (only with layout.extend)
  const line = document.createElement('div');
  line.style.cssText = 'position:absolute;height:0;pointer-events:none;';
  const lineL = document.createElement('div');
  lineL.style.cssText = 'position:absolute;height:0;pointer-events:none;display:none;';
  layer.append(lineL);
  // the pill itself, floating in the chart body -- a row of CELLS (segments), each independently clickable
  const pill = document.createElement('div');
  pill.className = 'ord-pill';
  // ADAPTIVE width: the caller's width is the MINIMUM (controller 140, placed pills 100); the pill GROWS with
  // its content (a 3-digit qty must never clip a cell). Content stays centered when under the minimum.
  pill.style.cssText =
    'position:absolute;transform:translateY(-50%);display:inline-block;min-width:' +
    (Number(opts.width) > 0 ? Number(opts.width) : 140) +
    'px;text-align:center;white-space:nowrap;overflow:hidden;' +
    'border-radius:14px;font:600 14px system-ui,sans-serif;color:#fff;pointer-events:auto;' +
    (dragOn() ? 'cursor:ns-resize;' : opts.onClick ? 'cursor:pointer;' : '');
  layer.append(line, pill);

  /** @type {HTMLElement[]} */
  const cells = [];
  const segs = Array.isArray(opts.segments) && opts.segments.length ? opts.segments : [{ text: opts.label || '' }];
  segs.forEach((s, i) => {
    const cell = document.createElement('span');
    cell.textContent = s.text || '';
    // inline-block cells flow horizontally; line-height sets the height (font-independent); horizontal padding = spacing
    cell.style.cssText =
      'display:inline-block;vertical-align:middle;line-height:20px;padding:0 7px;' +
      (i > 0 ? 'border-left:1px solid rgba(255,255,255,.35);' : '') +
      (s.onClick ? 'cursor:pointer;' : '');
    if (s.onClick) {
      cell.onmouseenter = () => {
        cell.style.background = 'rgba(255,255,255,.22)';
      };
      cell.onmouseleave = () => {
        cell.style.background = 'transparent';
      };
      cell.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (justDragged) return;
        try {
          /** @type {(c: HTMLElement) => void} */ (s.onClick)(cell);
        } catch (_) {}
      };
    }
    cells.push(cell);
    pill.appendChild(cell);
  });

  // KEBAB SIDES -- detachable circles flanking the pill: [S] pill [T]. Dragging one OFF reports onDetach(price)
  // at the release y (drop semantics); the circle snaps back and the CALLER reflects the detached piece as its
  // own level, hiding the circle via update({sides}). A tap does nothing -- detaching is a deliberate drag.
  const SIDE_D = 20; // circle diameter
  /** @type {{ el: HTMLDivElement, side: PillSide, pos: 'left'|'right', dragging: boolean }[]} */
  const sideEls = [];
  /** @param {PillSide|undefined} side @param {'left'|'right'} pos */
  const mountSide = (side, pos) => {
    if (!side || !side.onDetach) return;
    const el = document.createElement('div');
    el.textContent = side.text || '';
    el.style.cssText =
      'position:absolute;transform:translate(-50%,-50%);box-sizing:border-box;width:' +
      SIDE_D +
      'px;height:' +
      SIDE_D +
      'px;' +
      'border-radius:50%;background:' +
      (side.color || '#7e8a97') +
      ';border:2px solid #0e0e11;box-shadow:0 0 0 1px rgba(255,255,255,.25);' +
      'color:#fff;text-align:center;font:600 11px system-ui,sans-serif;line-height:' +
      (SIDE_D - 4) +
      'px;' +
      'pointer-events:auto;cursor:ns-resize;';
    layer.appendChild(el);
    const rec = { el, side: /** @type {PillSide} */ (side), pos, dragging: false };
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sy = e.clientY;
      let moved = false;
      /** @type {number|null} */
      let curY = null;
      lock(true);
      /** @param {MouseEvent} ev */
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientY - sy) > 4) moved = true;
        if (moved) {
          rec.dragging = true;
          curY = ev.clientY - host.getBoundingClientRect().top;
          el.style.top = curY + 'px';
        }
      };
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        lock(false);
        rec.dragging = false;
        if (moved && curY != null) {
          const pr = y2p(curY);
          if (pr != null)
            try {
              rec.side.onDetach(pr);
            } catch (_) {}
        }
        layout(); // snap back (the caller hides the piece once its leg exists)
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });
    sideEls.push(rec);
  };
  mountSide(opts.sides && opts.sides.left, 'left');
  mountSide(opts.sides && opts.sides.right, 'right');

  // the PRICE badge on the scale at the attachment point (engine axis label, no line -- price only, coloured to match)
  let level = null;
  try {
    level = pane.series.addLevel({
      price: state.price,
      showLine: false,
      showAxisLabel: true,
      color: state.color,
      axisLabelColor: state.color,
      axisLabelTextColor: '#fff',
      title: '',
      _ordPill: true,
    });
  } catch (_) {}

  const paint = () => {
    const lc = lnColor || state.color; // empty line colour = match the pill
    pill.style.background = state.color;
    line.style.borderTop = lnW + 'px ' + lnStyle + ' ' + lc;
    lineL.style.borderTop = lnW + 'px ' + lnStyle + ' ' + lc;
    if (level)
      try {
        level.configure({ color: state.color, axisLabelColor: state.color });
      } catch (_) {}
  };
  paint();

  /** @param {number} pr @returns {number|null} */
  const p2y = (pr) => {
    try {
      return pane.series.priceToY(pr);
    } catch (_) {
      return null;
    }
  };
  /** @param {number} y @returns {number|null} */
  const y2p = (y) => {
    try {
      return pane.series.yToPrice(y);
    } catch (_) {
      return null;
    }
  };
  const chartW = () => {
    const w = pane.chart._chartW;
    return w && isFinite(w) ? w : host.getBoundingClientRect().width;
  };
  const chartL = () => {
    const l = pane.chart._chartLeftPx;
    return Number.isFinite(l) && l > 0 ? l : 0;
  }; // plot's left edge (the left price scale's width when the scale sits left, else 0)
  let raf = 0,
    dead = false;
  let lastGeo = ''; // geometry signature -- skip ALL style writes when nothing moved (the rAF loop runs per frame)
  const layout = () => {
    const y = p2y(state.price);
    if (y == null) {
      if (lastGeo !== 'hidden') {
        lastGeo = 'hidden';
        pill.style.display = 'none';
        line.style.display = 'none';
        lineL.style.display = 'none';
        sideEls.forEach((s) => {
          s.el.style.display = 'none';
        });
      }
      return;
    }
    const left0 = chartL(); // plot's LEFT edge (chart border, or the left price scale)
    const right0 = left0 + chartW(); // plot's RIGHT edge (the right price scale, or the chart border)
    const w = pill.offsetWidth;
    const dragSig = sideEls.some((s) => s.dragging) ? Math.random() : 0; // a side drag owns its y -- keep writing
    const geo =
      y +
      '|' +
      left0 +
      '|' +
      right0 +
      '|' +
      w +
      '|' +
      dragSig +
      '|' +
      sideEls.map((s) => (s.side.visible === false ? 0 : 1)).join('');
    if (geo === lastGeo) return;
    lastGeo = geo;
    pill.style.display = '';
    // PLACEMENT: right = offset px off the plot's right edge (0 = flush to the scale); left = offset px off the
    // plot's LEFT edge (the chart border, or the left price scale when the user keeps the scale there).
    const pillLeft =
      laySide === 'left' ? Math.min(left0 + layOff, Math.max(left0, right0 - w)) : Math.max(left0, right0 - layOff - w);
    pill.style.top = y + 'px';
    pill.style.left = pillLeft + 'px';
    // LINE: right-placed pills keep their ATTACHMENT segment to the scale (the offset gap); a left-placed pill
    // draws NO line on its own -- relocation is not extension. `extend` draws every remaining segment, so it
    // spans the whole plot on either placement.
    const rw = Math.max(0, right0 - (pillLeft + w));
    line.style.display = (laySide === 'right' || layExtend) && rw > 0 ? '' : 'none';
    line.style.top = y + 'px';
    line.style.left = pillLeft + w + 'px';
    line.style.width = rw + 'px';
    const lw = Math.max(0, pillLeft - left0);
    lineL.style.display = layExtend && lw > 0 ? '' : 'none';
    lineL.style.top = y + 'px';
    lineL.style.left = left0 + 'px';
    lineL.style.width = lw + 'px';
    // kebab circles ride the pill's y: left one just before the pill, right one just after (on the line)
    sideEls.forEach((s) => {
      if (s.side.visible === false) {
        s.el.style.display = 'none';
        return;
      }
      s.el.style.display = '';
      if (s.dragging) return; // the drag owns its y until release
      s.el.style.top = y + 'px';
      s.el.style.left = (s.pos === 'left' ? pillLeft - SIDE_D / 2 - 4 : pillLeft + w + SIDE_D / 2 + 4) + 'px';
    });
  };
  const tick = () => {
    if (dead) return;
    layout();
    raf = requestAnimationFrame(tick);
  };
  tick();

  // DRAG (drop semantics): the pill owns its position while dragged (external update({price}) is ignored) and
  // fires onCommit(price) on release only; a tap without movement is a CLICK (the pressed cell's, or the pill's).
  let dragging = false; // external reprice suppressed while true
  let justDragged = false; // swallow the click that follows a drag release
  /** @param {boolean} on */
  const lock = (on) => {
    try {
      pane.chart.configure({ handleScroll: !on, handleScale: !on });
    } catch (_) {}
  };
  pill.addEventListener('mousedown', (e) => {
    const drag = dragOn(); // one answer per gesture -- the gate must not flip mid-drag
    if (!drag && !opts.onClick) return;
    e.preventDefault();
    const sx = e.clientX,
      sy = e.clientY;
    let moved = false;
    if (drag) lock(true);
    /** @param {MouseEvent} ev @returns {number|null} */
    const apply = (ev) => {
      const pr = y2p(ev.clientY - host.getBoundingClientRect().top);
      if (pr == null) return null;
      state.price = pr;
      if (level)
        try {
          level.configure({ price: pr });
        } catch (_) {}
      return pr;
    };
    /** @param {MouseEvent} ev */
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
      if (moved && drag) {
        dragging = true;
        const pr = apply(ev);
        if (pr != null)
          try {
            opts.onDrag && opts.onDrag(pr);
          } catch (_) {}
      }
    };
    /** @param {MouseEvent} ev */
    const up = (ev) => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      if (drag) lock(false);
      dragging = false;
      if (moved && drag) {
        justDragged = true;
        setTimeout(() => {
          justDragged = false;
        }, 0); // the release click must not fire a cell
        const pr = apply(ev);
        if (pr != null)
          try {
            /** @type {(px: number) => void} */ (opts.onCommit || opts.onDrag)(pr);
          } catch (_) {}
      } else if (!moved && opts.onClick) {
        const t = /** @type {HTMLElement} */ (ev.target);
        const onCell = cells.some((c) => c === t && c.style.cursor === 'pointer'); // a cell with its own handler takes the tap
        if (!onCell)
          try {
            opts.onClick();
          } catch (_) {}
      }
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
  });

  return {
    update: (o = {}) => {
      // don't fight an active drag; and NEVER poke the engine with an unchanged price (the ride loop re-sets
      // the same state every frame -- an unconditional configure() forced a full engine repaint at 60fps)
      if (o.price != null && !dragging && Number(o.price) !== state.price) {
        state.price = Number(o.price);
        if (level)
          try {
            level.configure({ price: state.price });
          } catch (_) {}
      }
      if (o.label != null) state.label = o.label;
      if (o.color && o.color !== state.color) {
        state.color = o.color;
        paint();
      }
      if (Array.isArray(o.segments))
        o.segments.forEach((t, i) => {
          if (t != null && cells[i] && cells[i].textContent !== t) cells[i].textContent = t;
        });
      if (o.sides)
        sideEls.forEach((s) => {
          const v = /** @type {any} */ (o.sides)[s.pos];
          if (v !== undefined) s.side.visible = !!v;
        });
      // a live drag gate can flip between updates (MKT <-> LMT on the same pill): keep the cursor honest
      if (opts.canDrag) pill.style.cursor = dragOn() ? 'ns-resize' : opts.onClick ? 'pointer' : '';
      layout();
    },
    remove: () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      try {
        layer.remove();
      } catch (_) {}
      if (level)
        try {
          pane.series.removeLevel(level);
        } catch (_) {}
    },
  };
}
