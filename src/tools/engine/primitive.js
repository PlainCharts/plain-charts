// @ts-check
// The drawing layer: series primitives that render every canvas drawing (delegating
// to each shape's draw()), the selection handles, and the ghost of an in-progress
// shape. The chart repaints on every pan/zoom, so screen positions are
// recomputed from data anchors each frame.
//
// TWO planes split by the candle series (the z=0 divider): drawings with z < 0 render
// BEHIND the candles (zOrder 'bottom'), z >= 0 render in FRONT (zOrder 'top'). This is
// what makes Visual order ▸ Send to back actually drop a shape behind the price bars.
// Selection handles, the slice guide, and the draft always live in the top plane.
import { getTool } from '../registry.js';
import { toScreen, snapXToBar, timeToX } from './geometry.js';
import { paintMarks } from '../../../lib/kapelka/studies/primitives/marks.js'; // the shared ether renderer
import { alertMirror } from '../../alerts/store.js'; // which drawings have an alert attached (on-chart badge)

/** @typedef {import('./geometry.js').ScreenPoint} ScreenPoint */
/** @typedef {import('./engine.js').Drawing} Drawing */
/** @typedef {import('./engine.js').Tool} Tool */
/** @typedef {import('./engine.js').DrawingEngine} DrawingEngine */
// The render view a tool's marks()/draw() expects (data<->screen mappers + plot size).
/** @typedef {{ timeToX: (t: number) => number|null, priceToY: (p: number) => number|null, width: number, height: number, snapX: (x: number) => number, priceDecimals?: number, bars?: any[] }} View */
// A canvas 2D context (the ether/tools draw through it).
/** @typedef {CanvasRenderingContext2D} Ctx */
// The kapelka series-primitive "draw scope": media context + pixel size.
/** @typedef {any} DrawScope */

const R = 5; // handle radius (px)

/** @param {DrawingEngine} engine */
export function createDrawingPrimitive(engine) {
  /** @param {DrawScope} scope @returns {View} */
  const viewFor = (scope) =>
    // remember this frame's plot size so engine.hitTest can resolve marks to the same pixels
    // (generic hit-testing needs vpx/vp vertices to land where the renderer painted them).
    (
      (engine._plotW = scope.mediaSize.width),
      (engine._plotH = scope.mediaSize.height),
      {
        width: scope.mediaSize.width,
        height: scope.mediaSize.height,
        priceDecimals: engine.pane.priceDecimals,
        bars: engine.pane.barArr || [], // sorted bars, for ray-stop / level tools
        timeToX: (t) => timeToX(engine.pane, t), // data time -> screen x on this pane
        priceToY: (p) => engine.series.priceToY(p), // price -> screen y (for tools that compute screen-space bits in marks())
        snapX: (x) => snapXToBar(engine.pane, x), // snap screen x to the nearest bar (snapToBar tools)
      }
    );

  // paint the shape + its text label (no handles — those go in the top overlay)
  /** @param {Ctx} c @param {View} view @param {Drawing} d */
  const paint = (c, view, d) => {
    const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
    if (!tool || !d.points) return;
    // Declarative path: a tool emits marks (geometry as DATA) rendered by the shared ether core, so
    // studies and tools draw through ONE renderer. Falls back to the legacy imperative draw() for any
    // tool not yet migrated — old built-ins and user-authored tools keep working unchanged.
    if (typeof tool.marks === 'function') {
      const scope = { timeToX: view.timeToX, priceToY: view.priceToY, width: view.width, height: view.height };
      paintMarks(c, tool.marks(d, view, engine.isSelected(d.id)) || [], scope);
      // the editable label is still rendered by the tool's drawText (or generic) — same as the legacy
      // path — so text layout (measure/wrap/align) stays imperative while the SHAPE became data.
      if (d.text && engine._editingId !== d.id && (!tool.textEnabled || tool.textEnabled(d))) {
        const pts = d.points.map((p) => toScreen(engine.pane, p, engine.series));
        if (pts.every(Boolean)) {
          const dt = typeof tool.drawText === 'function' ? tool.drawText : drawText;
          dt.call(tool, c, pts, d, view);
        }
      }
      return;
    }
    if (typeof tool.draw !== 'function') return;
    let pts = d.points.map((p) => toScreen(engine.pane, p, engine.series));
    if (pts.some((p) => !p)) return;
    const solid = /** @type {ScreenPoint[]} */ (pts); // guarded above: none is null
    if (tool.snapToBar) pts = solid.map((p) => ({ ...p, x: snapXToBar(engine.pane, p.x) }));
    tool.draw(c, /** @type {ScreenPoint[]} */ (pts), d, engine.isSelected(d.id), view);
    // skip the rendered label while it's being edited in place (the editor div shows it)
    if (d.text && engine._editingId !== d.id && (!tool.textEnabled || tool.textEnabled(d))) {
      const dt = typeof tool.drawText === 'function' ? tool.drawText : drawText;
      dt.call(tool, c, pts, d, view);
    }
  };

  // ---- alert badge: a bell drawn on any drawing that has an alert attached ----
  // Repaint whenever the alert store changes (create / toggle / remove) so the badge appears/clears live.
  const mirror = alertMirror();
  const alertUnsub = mirror.subscribe(() => engine.requestUpdate());
  /** @param {Drawing} d  does this drawing (on this pane's symbol) have an alert? */
  const hasAlert = (d) => {
    const sym = engine.pane && engine.pane.symbol;
    for (const a of mirror.all()) {
      if (a && a.objectId === d.id && (!a.symbol || a.symbol === sym)) return true;
    }
    return false;
  };
  /** a small green bell badge, centered at (x, y). @param {Ctx} c @param {number} x @param {number} y */
  const drawAlertBadge = (c, x, y) => {
    const r = 9,
      s = 3.4;
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = '#2fa572';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(255,255,255,.9)';
    c.stroke();
    // white bell glyph (dome + rim, top nub, clapper)
    c.fillStyle = '#fff';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(x - s, y + s * 0.7);
    c.lineTo(x + s, y + s * 0.7);
    c.lineTo(x + s * 0.72, y + s * 0.1);
    c.lineTo(x + s * 0.72, y - s * 0.4);
    c.arc(x, y - s * 0.4, s * 0.72, 0, Math.PI, true);
    c.lineTo(x - s * 0.72, y + s * 0.1);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(x, y - s * 1.2, s * 0.28, 0, Math.PI * 2);
    c.fill(); // top nub
    c.beginPath();
    c.arc(x, y + s * 1.0, s * 0.34, 0, Math.PI);
    c.fill(); // clapper
    c.restore();
  };

  // one plane: draws the committed drawings whose z passes `inPlane`. The top plane
  // additionally paints selection handles, the slice guide, and the in-progress shape.
  /** @param {'top'|'bottom'} zOrder @param {(z: number) => boolean} inPlane @param {boolean} overlay */
  const makePlane = (zOrder, inPlane, overlay) => {
    const renderer = {
      /** @param {any} target */
      draw(target) {
        target.useMediaCoordinateSpace((/** @type {DrawScope} */ scope) => {
          const c = /** @type {Ctx} */ (scope.context);
          const view = viewFor(scope);
          engine.canvasItems().forEach((/** @type {Drawing} */ d) => {
            if (inPlane(d.z || 0)) paint(c, view, d);
          }); // painter's order (z asc)

          if (!overlay) return;

          // alert badges (top overlay, always on top): a bell on each drawing that has an alert. PINNED to the
          // right edge (by the price scale) at the drawing's price -- so it stays put as the
          // chart scrolls horizontally (only its price-level y tracks the drawing).
          engine.canvasItems().forEach((/** @type {Drawing} */ d) => {
            if (!d.points || !d.points.length || d.hidden || !hasAlert(d)) return;
            const p = toScreen(engine.pane, d.points[0], engine.series);
            if (!p) return;
            const bx = view.width - 14; // fixed to the right of the plot (next to the price scale)
            const by = Math.max(12, Math.min(view.height - 12, p.y));
            drawAlertBadge(c, bx, by);
          });

          // Vertical lines pierce every pane: paint the OTHER surfaces' span-pane drawings
          // (the line only, full height of THIS pane) at the shared time x. Each pane's
          // primitive renders the others', so a vline drawn anywhere shows in all panes.
          (engine.pane.surfaces || []).forEach((/** @type {any} */ s) => {
            if (s.engine === engine) return;
            /** @type {Drawing[]} */
            let items;
            try {
              items = s.engine.canvasItems();
            } catch (_) {
              items = [];
            }
            items.forEach((/** @type {Drawing} */ d) => {
              const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
              if (!tool || !tool.spanPanes || d.hidden || !d.points || !d.points.length) return;
              if (typeof tool.marks === 'function') {
                const scope = {
                  timeToX: view.timeToX,
                  priceToY: view.priceToY,
                  width: view.width,
                  height: view.height,
                  snapX: view.snapX,
                };
                paintMarks(c, tool.marks(d, view, false) || [], scope);
              } else if (typeof tool.draw === 'function') {
                let x = timeToX(engine.pane, d.points[0].time);
                if (x == null) return;
                if (tool.snapToBar) x = snapXToBar(engine.pane, x);
                tool.draw(c, [{ x, y: 0 }], d, false, view);
              }
            });
          });

          // selection handles — for every selected drawing, drawn on top regardless of plane
          engine.canvasItems().forEach((/** @type {Drawing} */ sel) => {
            if (!engine.isSelected(sel.id)) return;
            const tool = /** @type {Tool|undefined} */ (getTool(sel.tool));
            if (!tool || !sel.points) return;
            let pts = sel.points.map((p) => toScreen(engine.pane, p, engine.series));
            if (pts.some((p) => !p)) return;
            const solid = /** @type {ScreenPoint[]} */ (pts); // guarded above: none is null
            if (tool.snapToBar) pts = solid.map((p) => ({ ...p, x: snapXToBar(engine.pane, p.x) }));
            drawHandles(
              c,
              typeof tool.handles === 'function'
                ? tool.handles(/** @type {ScreenPoint[]} */ (pts), sel)
                : /** @type {ScreenPoint[]} */ (pts),
            );
          });

          // Text box for the single selected drawing: compute the screen anchor/rect of
          // its label (where text sits, per the tool's default alignment) so interaction.js
          // can edit it in place. When the drawing has no text yet, paint a faint
          // "+ Add text" placeholder in that spot. Hidden while actively editing.
          engine._textBox = null;
          if (engine.selection && engine.selection.size === 1 && engine._editingId == null) {
            const sel = engine.get(/** @type {string} */ (engine.selectedId)); // size===1 => selectedId set
            if (sel) updateTextBox(c, sel, view);
          }

          // rubber-band marquee box (Ctrl+drag multi-select)
          if (engine.marqueeRect) {
            const r = engine.marqueeRect;
            const x = Math.min(r.x0, r.x1),
              y = Math.min(r.y0, r.y1);
            const w = Math.abs(r.x1 - r.x0),
              h = Math.abs(r.y1 - r.y0);
            c.save();
            c.fillStyle = 'rgba(41,98,255,0.12)';
            c.strokeStyle = 'rgba(41,98,255,0.7)';
            c.lineWidth = 1;
            c.fillRect(x, y, w, h);
            c.strokeRect(x + 0.5, y + 0.5, w, h);
            c.restore();
          }

          // slice guide circle (gliding along a line during a Slice)
          if (engine.sliceGuide) {
            const sg = engine.sliceGuide;
            c.save();
            c.fillStyle = '#ffffff';
            c.strokeStyle = '#2962ff';
            c.lineWidth = 2;
            c.beginPath();
            c.arc(sg.x, sg.y, 6, 0, Math.PI * 2);
            c.fill();
            c.stroke();
            c.restore();
          }

          // in-progress shape (ghost) — same dual-path as committed drawings (marks, else draw)
          const g = engine.draft;
          if (g) {
            const tool = /** @type {Tool|undefined} */ (getTool(g.tool));
            if (tool && typeof tool.marks === 'function') {
              const scope = { timeToX: view.timeToX, priceToY: view.priceToY, width: view.width, height: view.height };
              paintMarks(c, tool.marks(g, view, false) || [], scope);
            } else if (tool && typeof tool.draw === 'function') {
              let pts = /** @type {import('./geometry.js').DataPoint[]} */ (g.points).map((p) =>
                toScreen(engine.pane, p, engine.series),
              );
              if (tool.snapToBar) pts = pts.map((p) => (p ? { ...p, x: snapXToBar(engine.pane, p.x) } : p));
              if (!pts.some((p) => !p)) tool.draw(c, pts, g, false, view);
            }
          }
        });
      },
    };
    return { renderer: () => renderer, zOrder: () => zOrder };
  };

  const bottomPlane = makePlane('bottom', (z) => z < 0, false); // behind the candles
  // emptiness probe for the engine's objects-only repaint tier: with no sent-to-back drawing the
  // bottom plane paints nothing, so a drag/hover repaint can skip the data sheet entirely.
  /** @type {any} */ (bottomPlane).isEmpty = () =>
    !engine.canvasItems().some((/** @type {Drawing} */ d) => (d.z || 0) < 0);
  const topPlane = makePlane('top', (z) => z >= 0, true); // in front (default) + overlay

  // generic on-canvas text label, positioned within the drawing's bounding box
  // by the drawing's textStyle alignment. Works for any shape (uses pts bbox).
  /** @param {Ctx} c @param {ScreenPoint[]} pts @param {Drawing} d */
  function drawText(c, pts, d) {
    const ts = d.textStyle || {};
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    const x1 = Math.min(...xs),
      x2 = Math.max(...xs),
      y1 = Math.min(...ys),
      y2 = Math.max(...ys);
    const size = ts.size || 14,
      pad = 5;
    const ha = ts.hAlign || 'center',
      va = ts.vAlign || 'middle';
    const lines = String(d.text).split('\n'),
      lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    c.fillStyle = ts.color || '#787b86';
    let x;
    if (ha === 'left') {
      x = x1 + pad;
      c.textAlign = 'left';
    } else if (ha === 'right') {
      x = x2 - pad;
      c.textAlign = 'right';
    } else {
      x = (x1 + x2) / 2;
      c.textAlign = 'center';
    }
    let y0;
    if (va === 'top') {
      c.textBaseline = 'bottom';
      y0 = y1 - pad - (lines.length - 1) * lh;
    } // above the top edge
    else if (va === 'bottom') {
      c.textBaseline = 'top';
      y0 = y2 + pad;
    } // below the bottom edge
    else {
      c.textBaseline = 'middle';
      y0 = (y1 + y2) / 2 - ((lines.length - 1) * lh) / 2;
    } // centered inside
    lines.forEach((ln, i) => c.fillText(ln, x, y0 + i * lh));
    c.restore();
  }

  // the screen geometry of a drawing's text label (bbox + the tool's default alignment),
  // mirroring the generic drawText positioning. Returns the top-left text origin, the
  // align anchor x, and a padded hit-rect. Used to edit text in place and to place the
  // "+ Add text" placeholder.
  // a copy of the drawing whose textStyle has the tool's default vAlign/hAlign filled in
  // (used for the empty-state placeholder + its hit box, so a not-yet-edited drawing
  // anchors exactly where a finished label will, instead of falling back to center/middle).
  /** @param {Drawing} d @param {Tool} tool @returns {Drawing} */
  function withTextDefaults(d, tool) {
    const def = (tool.settings && tool.settings.text && tool.settings.text.defaults) || {};
    const ts = d.textStyle || {};
    return { ...d, textStyle: { vAlign: def.vAlign || 'middle', hAlign: def.hAlign || 'center', ...ts } };
  }
  /** @param {Ctx} c @param {Drawing} d @param {Tool} tool @param {View} view @returns {any} */
  function computeTextBox(c, d, tool, view) {
    // shapes that align text to their geometry (e.g. trend line slope, a ray's right
    // edge) provide textGeom; build a rotated hit box + editor anchor from it so
    // clicking/editing follows the shape.
    if (typeof tool.textGeom === 'function') {
      let pts = /** @type {import('./geometry.js').DataPoint[]} */ (d.points).map((p) =>
        toScreen(engine.pane, p, engine.series),
      );
      if (pts.some((p) => !p)) return null;
      if (tool.snapToBar)
        pts = /** @type {ScreenPoint[]} */ (pts).map((p) => ({ ...p, x: snapXToBar(engine.pane, p.x) }));
      // measure the placeholder text when empty, so the hit box matches the visible
      // "+ Add text" (not a zero-width box).
      const gd = { ...withTextDefaults(d, tool), text: d.text || '+ Add text' };
      const g = tool.textGeom(c, pts, gd, view);
      if (!g) return null;
      const PAD = 4,
        cos = Math.cos(g.angle),
        sin = Math.sin(g.angle);
      const lx0 = g.lx0 - PAD,
        ly0 = g.ly0 - PAD,
        lx1 = g.lx1 + PAD,
        ly1 = g.ly1 + PAD;
      const corners = [
        [lx0, ly0],
        [lx1, ly0],
        [lx1, ly1],
        [lx0, ly1],
      ].map(([lx, ly]) => ({ x: g.cx + lx * cos - ly * sin, y: g.cy + lx * sin + ly * cos }));
      const xs = corners.map((p) => p.x),
        ys = corners.map((p) => p.y);
      return {
        x: g.cx,
        yTop: g.cy,
        ha: g.tAlign,
        va: g.va,
        size: g.size,
        w: g.w,
        totalH: g.totalH,
        angle: g.angle,
        cx: g.cx,
        cy: g.cy,
        baseline: g.baseline,
        lx0,
        ly0,
        lx1,
        ly1,
        editor: g.editor,
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      };
    }
    const cfg = tool.settings.text;
    const def = cfg.defaults || {};
    const ts = d.textStyle || {};
    const va = ts.vAlign || def.vAlign || 'middle',
      ha = ts.hAlign || def.hAlign || 'center';
    let pts = /** @type {(ScreenPoint|null)[]} */ (
      /** @type {import('./geometry.js').DataPoint[]} */ (d.points).map((p) => toScreen(engine.pane, p, engine.series))
    );
    if (pts.some((p) => !p)) return null;
    if (tool.snapToBar)
      pts = /** @type {ScreenPoint[]} */ (pts).map((p) => ({ ...p, x: snapXToBar(engine.pane, p.x) }));
    const solid = /** @type {ScreenPoint[]} */ (pts); // guarded above: none is null
    const xs = solid.map((p) => p.x),
      ys = solid.map((p) => p.y);
    const x1 = Math.min(...xs),
      x2 = Math.max(...xs),
      y1 = Math.min(...ys),
      y2 = Math.max(...ys);
    const size = ts.size || 14,
      pad = 5;
    const lines = String(d.text || '+ Add text').split('\n'),
      lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const w = Math.max(...lines.map((l) => c.measureText(l).width));
    c.restore();
    const totalH = size + (lines.length - 1) * lh;
    const x = ha === 'left' ? x1 + pad : ha === 'right' ? x2 - pad : (x1 + x2) / 2; // align anchor
    const yTop = va === 'top' ? y1 - pad - totalH : va === 'bottom' ? y2 + pad : (y1 + y2) / 2 - totalH / 2;
    const xLeft = ha === 'left' ? x : ha === 'right' ? x - w : x - w / 2;
    return { x, yTop, ha, va, size, w, totalH, x0: xLeft - 4, y0: yTop - 4, x1: xLeft + w + 4, y1: yTop + totalH + 4 };
  }

  // record the selected drawing's text box on the engine; draw the placeholder if empty
  /** @param {Ctx} c @param {Drawing} d @param {View} view */
  function updateTextBox(c, d, view) {
    const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
    const cfg = tool && tool.settings && tool.settings.text;
    if (!cfg || (tool.textEnabled && !tool.textEnabled(d)) || d.hidden || engine.isLocked(d.id) || !d.points) return;
    const box = computeTextBox(c, d, tool, view);
    if (!box) return;
    engine._textBox = { id: d.id, ...box, empty: !d.text };
    if (!d.text) {
      // Draw the "+ Add text" hint through the shape's own text renderer so it follows
      // the shape (e.g. a trend line's slope) exactly like the finished label will —
      // same dispatch as paint() above.
      let pts = d.points.map((p) => toScreen(engine.pane, p, engine.series));
      if (pts.some((p) => !p)) return;
      const solid = /** @type {ScreenPoint[]} */ (pts); // guarded above: none is null
      if (tool.snapToBar) pts = solid.map((p) => ({ ...p, x: snapXToBar(engine.pane, p.x) }));
      const base = withTextDefaults(d, tool);
      const ghost = { ...base, text: '+ Add text', textStyle: { ...base.textStyle, color: 'rgba(120,123,134,0.85)' } };
      const dt = typeof tool.drawText === 'function' ? tool.drawText : drawText;
      dt.call(tool, c, /** @type {ScreenPoint[]} */ (pts), ghost, view);
    }
  }

  /** @param {Ctx} c @param {ScreenPoint[]} pts */
  function drawHandles(c, pts) {
    c.save();
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#2962ff';
    c.lineWidth = 2;
    pts.forEach((p) => {
      c.beginPath();
      c.arc(p.x, p.y, R, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });
    c.restore();
  }

  // time-scale labels (for any drawing with style.timeLabel) rendered natively in
  // the time axis — the time-axis analogue of the price labels in the price scale.
  function timeAxisViews() {
    const ts = engine.pane.chart.timeAxis();
    /** @type {any} */
    let fmt;
    try {
      fmt = engine.pane.chart.getConfig().localization.timeFormatter;
    } catch (_) {}
    /** @type {any[]} */
    const out = [];
    engine.canvasItems().forEach((/** @type {Drawing} */ d) => {
      if (!d.style || !d.style.timeLabel || !d.points) return;
      d.points.forEach((/** @type {import('./geometry.js').DataPoint} */ p) => {
        const x = ts.timeToX(p.time);
        if (x == null) return;
        // a drawing may override the axis tick with a custom label (e.g. vertical line)
        const text = d.style.labelText ? d.style.labelText : fmt ? fmt(p.time) : '';
        out.push({
          coordinate: () => x,
          text: () => text,
          textColor: () => '#fff',
          backColor: () => d.style.color,
          visible: () => true,
          tickVisible: () => true,
        });
      });
    });
    return out;
  }

  return {
    updateAllViews() {}, // screen points computed lazily in draw()
    paneViews() {
      return [bottomPlane, topPlane];
    },
    timeAxisViews,
    /** @param {{ requestUpdate: () => void }} p */
    attached(p) {
      engine._setRequestUpdate(p.requestUpdate);
    },
    detached() {
      engine._setRequestUpdate(null);
      try {
        alertUnsub();
      } catch (_) {}
    },
  };
}
