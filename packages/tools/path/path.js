// @ts-check
// Path — a multi-point polyline (zigzag). Click to drop each vertex, double-click
// (or Enter) to finish, Esc to cancel. Each vertex is a draggable handle. Optional
// arrowhead at the start/end. points:'poly' tells the engine it's variable-length.
Tools.register({
  id: 'path',
  name: 'Path',
  description: 'A drawing tool for a multi-point line.',
  icon: 'path.png',
  glyph: '↯',
  kind: 'draw',
  points: 'poly',
  shiftConstrain: 'angle',   // hold Shift while placing a vertex → snap that segment to 45°
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', arrows: 'none' },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Arrows', controls: [{ key: 'arrows', type: 'select', options: [
        { key: 'none', name: 'None' },
        { key: 'end', name: 'End  →' },
        { key: 'start', name: '←  Start' },
        { key: 'both', name: '←  Both  →' },
      ] }] },
    ],
  },
  // Declarative: the polyline is a path mark; each arrowhead is a filled triangle whose direction is
  // computed in SCREEN space (via view) and emitted as pixel offsets on the tip's data anchor.
  /** @param {ToolDrawing} d @param {ToolView} view @returns {ToolMark[]} */
  marks(d, view) {
    const P = d.points || [];
    if (P.length < 2) return [];
    const s = d.style || {};
    const out = [{ path: P.map((p) => ({ t: p.time, p: p.price })), stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle) }];
    const ar = s.arrows, n = P.length;
    if (ar && ar !== 'none') {
      const sz = 13 + (s.width || 2) * 2.2;
      if (ar === 'end' || ar === 'both') out.push(this.arrowMark(P[n - 2], P[n - 1], sz, s.color, view));
      if (ar === 'start' || ar === 'both') out.push(this.arrowMark(P[1], P[0], sz, s.color, view));
    }
    return out;
  },
  // swept-back barbed arrowhead at data point `b`, pointing along the screen direction a->b.
  /** @param {ToolDataPoint} a @param {ToolDataPoint} b @param {number} sz @param {string|undefined} color @param {ToolView} view @returns {ToolMark} */
  arrowMark(a, b, sz, color, view) {
    const dx = /** @type {number} */ (view.timeToX(b.time)) - /** @type {number} */ (view.timeToX(a.time)), dy = view.priceToY(b.price) - view.priceToY(a.price);
    const ang = Math.atan2(dy, dx), sp = Math.PI / 7, back = sz * 0.62;
    return { closed: true, fill: color, path: [
      { t: b.time, p: b.price },
      { t: b.time, p: b.price, dx: -sz * Math.cos(ang - sp), dy: -sz * Math.sin(ang - sp) },
      { t: b.time, p: b.price, dx: -back * Math.cos(ang), dy: -back * Math.sin(ang) },
      { t: b.time, p: b.price, dx: -sz * Math.cos(ang + sp), dy: -sz * Math.sin(ang + sp) },
    ] };
  },
  // No hitTest: a pure recipe. The polyline mark gives the body (near any segment) and each
  // vertex is a default handle — both derived by engine.hitTestFromMarks.
});
