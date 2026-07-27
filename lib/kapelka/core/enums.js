// @ts-check
// Public enums + series type tags. These are part of the engine's API surface (re-exported from
// index.js): CursorMode / Stroke are option enums; Candles/Line/Area/Baseline/Columns/Segments/HBars
// are the type tags passed to addPlot(type, ...). Kept in their own leaf module so any core module
// can import a tag (e.g. Stroke) without importing the Chart shell -- no import cycle.

export const CursorMode = { Free: 0, Magnet: 1, Hidden: 2 };
export const Stroke = { Solid: 0, Dotted: 1, Dashed: 2, LongDash: 3, SparseDot: 4 };
export const Candles = { type: 'Candlestick' };
export const Line = { type: 'Line' };
export const Area = { type: 'Area' };
export const Baseline = { type: 'Baseline' };
export const Columns = { type: 'Histogram' };
// A partitionable bar. Each data point: { time, segments:[{from,to,color,fill?,lineWidth?}],
// lines?:[{level,color,width?,lineStyle?}], wick?:{from,to,color?,width?}, value? }. Segments are
// filled regions of the bar (stacked partitions); a segment with fill:false is drawn as an OUTLINE
// (hollow) rectangle instead -- so one bar can carry a solid part and a hollow part (e.g. net delta
// solid, absorbed/opposing volume hollow). Lines are bar-WIDTH horizontal delineations sharing the
// bar's exact geometry (no glyph drift); wick is a thin centered vertical stem. The matplotlib/pandas
// bar vocabulary: stacked bars, up/down volume with a delta line, candle-like wicked/hollow bars.
export const Segments = { type: 'Segmented' };
// A HORIZONTAL bar series — the 90°-rotated twin of Histogram. Each point { price, value, color? }
// sits at a PRICE level (value->y via the pane price scale) and extends horizontally by `value`
// (value->x, auto-scaled to the widest bar). Anchored at a chart edge (opts.side) within a fraction
// of the width (opts.widthFrac). This is what volume profiles / anything drawn on the Y axis use.
export const HBars = { type: 'HBar' };
