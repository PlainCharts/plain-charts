// @ts-check
// Arrow — a trend line with an arrowhead on by default. It delegates all of its
// drawing and text to the registered Trend Line so the two never drift; only the
// identity and the defaults (arrows: 'end') differ. This is the "tool reusing
// another tool" pattern enabled by Tools.get. Like the trend line it's a pure recipe:
// no hitTest — selecting/reshaping is derived from its (delegated) marks.
const TL = () => Tools.get('trendline');

Tools.register({
  id: 'arrow',
  glyph: '↗',
  kind: 'draw',
  points: 2,
  sliceable: true,
  shiftConstrain: 'angle', // hold Shift → snap to 45° (H/V/diagonal), like the trend line
  defaultStyle: {
    color: '#2962ff',
    width: 2,
    lineStyle: 'solid',
    extend: 'none',
    arrows: 'end',
    midPoint: false,
    priceLabels: false,
  },
  // share the trend line's Style/Text schema (evaluated lazily, after both load)
  get settings() {
    const t = TL();
    return t ? t.settings : undefined;
  },
  /** @param {...any} a */
  marks(...a) {
    const t = TL();
    if (t) return t.marks(...a);
  },
  /** @param {...any} a */
  drawText(...a) {
    const t = TL();
    if (t) return t.drawText(...a);
  },
  /** @param {...any} a */
  textGeom(...a) {
    const t = TL();
    if (t) return t.textGeom(...a);
  },
  /** @param {...any} a */
  textGap(...a) {
    const t = TL();
    if (t) return t.textGap(...a);
  },
});
