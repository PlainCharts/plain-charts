// @ts-check
// Level Line — ONE click. The line shoots horizontally forward from the clicked
// point and the far end is auto-placed at the first future candle that reaches the
// level (the obstacle). After that it's an ordinary 2-point trend line: both ends
// are independent handles (drag one without moving the other; angle it freely).
Tools.register({
  id: 'levelray',
  glyph: '⊢',
  kind: 'draw',
  points: 1,                 // one click; onCreate expands it to a 2-point line
  sliceable: true,
  shiftConstrain: 'angle',   // hold Shift while dragging an end → snap to 45° (re-straighten)
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', priceLabels: false },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Price label', toggle: 'priceLabels' },
    ],
    text: {
      defaults: { vAlign: 'top', hAlign: 'right' },
      vAlign: [{ key: 'top', name: 'Top' }, { key: 'middle', name: 'Middle' }, { key: 'bottom', name: 'Bottom' }],
      hAlign: [{ key: 'left', name: 'Left' }, { key: 'center', name: 'Center' }, { key: 'right', name: 'Right' }],
    },
  },
  // expand the single click into [A, B]. B = the first future bar whose range RETURNS to A's price
  // (the obstacle), but only AFTER price has left the level first -- else the bars right at the click
  // (whose range still straddles the level) would end it immediately (short stub on bottoms). Symmetric
  // for tops and bottoms. Falls back to the last bar if price never returns.
  /** @param {ToolDataPoint} a @param {ToolPane} pane @returns {ToolDataPoint[]} */
  onCreate(a, pane) {
    const bars = pane.barArr || [];
    let left = false;   // has price moved OFF the level yet?
    for (const bar of bars) {
      if (bar.time <= a.time || bar.low == null || bar.high == null) continue;
      const contains = bar.low <= a.price && a.price <= bar.high;
      if (!left) { if (!contains) left = true; continue; }   // wait for a clean departure
      if (contains) return [{ ...a }, { time: bar.time, price: a.price }];   // first return = obstacle
    }
    const last = bars.length ? bars[bars.length - 1] : null;
    return [{ ...a }, { time: last ? last.time : a.time, price: a.price }];
  },
  // Declarative: emit the line as a mark (geometry as data) instead of painting it. The two data
  // points become an anchored path; the shared ether renderer draws it.
  /** @param {ToolDrawing} d @returns {ToolMark[]} */
  marks(d) {
    if (!d.points || d.points.length < 2) return [];
    const s = d.style || {};
    return [{
      path: [{ t: d.points[0].time, p: d.points[0].price }, { t: d.points[1].time, p: d.points[1].price }],
      stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle),
    }];
  },
  // No hitTest: a pure recipe. The line mark gives the body and its two endpoints are the
  // default handles — both derived by engine.hitTestFromMarks.
});
