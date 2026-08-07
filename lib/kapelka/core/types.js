// @ts-check
// The engine's shared TYPE CONTRACTS -- the shapes that flow through kapelka, defined once and
// referenced from the other modules via `import('./types.js').Name` (module @typedefs, NOT ambient,
// so they travel the import graph -- which matters when the host app eventually type-checks the engine
// through its imports). This module exports nothing at run time; it is only ever referenced in JSDoc
// `import()` type positions, so it costs nothing to ship.
//
// PRECISE where it helps (the data the app feeds in, resolved colors, the cursor, the layout inputs);
// LOOSE where the author's internal Vue-surrogate objects (comp / $props / the built layout grids) are
// intricate and dynamically shaped -- those carry their known fields plus an open index signature.

export {};

// ---- data model (what the app feeds Series.feed / feedBar) ---------------------------------------

/**
 * One data point handed to Series.feed()/feedBar(). HETEROGENEOUS by series type -- the fields present
 * depend on the plot type; `_row()` in series.js dispatches on them:
 *   candlestick  { time, open, high, low, close, volume? }
 *   value        { time, value, color? }                       (line / area / baseline / histogram)
 *   hbar         { price, value?, segments?, color? }           (horizontal bar -- keyed by PRICE, not time)
 *   segmented    { time, segments:[{from,to,color,fill?,lineWidth?}], lines?, wick?, value? }
 *   custom       the plug-in view (addCustomPlot) gets the point back untouched
 * `time` is UNIX SECONDS (public API); the engine stores milliseconds internally.
 * @typedef {Object} Bar
 * @property {number} [time]
 * @property {number} [open]
 * @property {number} [high]
 * @property {number} [low]
 * @property {number} [close]
 * @property {number} [volume]
 * @property {number} [openInterest]
 * @property {number} [value]
 * @property {string} [color]
 * @property {number} [price]
 * @property {any[]} [segments]
 * @property {any[]} [lines]
 * @property {{ from?: number, to?: number, color?: string, width?: number }} [wick]
 */

/**
 * A stored data row: a POSITIONAL array. Numeric columns first, with an optional object payload in the
 * last slot for the richer series types. Shapes by type:
 *   candle    [t_ms, o, h, l, c, v]
 *   value     [t_ms, value]  |  [t_ms, value, color]
 *   segmented [t_ms, lo, hi, payload]      custom [t_ms, min, max, point]      hbar [price, total, payload]
 * @typedef {any[]} Row
 */

/**
 * An on-bar glyph (Series.setMarkers). `price` pins an exact level; otherwise `position` places it
 * relative to the series value at that time.
 * @typedef {Object} Marker
 * @property {number} time
 * @property {number} [price]
 * @property {'aboveBar'|'belowBar'|'inBar'} [position]
 * @property {'tick'|'text'|'circle'|'square'|'arrowUp'|'arrowDown'} [shape]
 * @property {string} [text]
 * @property {string} [color]
 * @property {number} [size]
 * @property {number} [lineWidth]
 * @property {number} [fontSize]
 */

/** A series type tag (from core/enums.js): { type: 'Candlestick'|'Line'|'Area'|'Baseline'|'Histogram'|'Segmented'|'HBar' }.
 * @typedef {{ type: string }} SeriesType */

// ---- options + resolved theme --------------------------------------------------------------------

/** The options object passed to mountChart(el, options). Deep-merged over the engine DEFAULTS; open,
 * since the app extends it. Known top-level groups below.
 * @typedef {Object} ChartOptions
 * @property {{ background?: { color?: string }, textColor?: string, fontSize?: number, fontFamily?: string }} [layout]
 * @property {{ vertLines?: any, horzLines?: any }} [grid]
 * @property {Object} [cursor]
 * @property {Object} [timeAxis]
 * @property {Object} [rightPriceAxis]
 * @property {number} [conflate]
 * @property {boolean} [ib]
 * @property {boolean} [autoSize]
 */

/** The author's resolved render-class color keys (colorsFor()). @typedef {{
 *   back: string, grid: string, gridVert: string, gridHorz: string, gridDashVert: any, gridDashHorz: any,
 *   scale: string, text: string, cross: string, crossWidth: number, crossDash: any, panel: string, textHL: string
 * }} Colors */

// ---- the cursor + the Vue-surrogate the render classes read --------------------------------------

/** The shared cursor state (CursorUpdater writes it, render classes read it). x/y are CSS px (or
 * undefined off-chart); t = time ms under the cursor; y$ = price under the cursor.
 * `mode` is the interaction mode ('explore' etc.), set by the input/mouse layer and read by Crosshair.
 * @typedef {{ x: number|undefined, y: number|undefined, t: number|undefined, y$: number|undefined,
 *   grid_id: number, locked: boolean, values: Record<string, any>, mode?: string }} Cursor */

/** The `$props` bag the author's render classes (Grid/Sidebar/Botbar/Crosshair) read off. Intricate
 * Vue-reactivity surrogate -- known fields typed, the rest open (see CompProps below).
 * @typedef {Object} CompPropsKnown
 * @property {number} width
 * @property {number} height
 * @property {any} layout
 * @property {any[]} sub
 * @property {[number, number]} range
 * @property {number} grid_id
 * @property {number} interval
 * @property {Cursor} cursor
 * @property {Partial<Colors>} colors
 * @property {string} font
 * @property {any} config
 * @property {any[]} shaders
 * @property {number} timezone
 * @property {number} [dayRoll]
 * @property {Record<string, any>} meta
 * @property {any} [ib]
 */
/** The full $props bag: the known fields above PLUS the open, dynamically-shaped surrogate -- the app
 * injects extra fields (settings, last, tickMarkFormatter, timeFormatter, ...) that the render classes
 * read off `comp.$props`. @typedef {CompPropsKnown & Record<string, any>} CompProps */

/** The render-input surrogate the author's classes are constructed against (config + cursor + $props +
 * the dynamically-attached sections/layout/interval). Open. */
/** @typedef {{ config: any, cursor: Cursor, $props: CompProps, [k: string]: any }} Comp */

// ---- branded scalars (coordinate spaces) --------------------------------------------------------
// Nominal brands: a plain number does NOT satisfy a branded type, and one brand does not satisfy
// another -- the checker separates "price", "time/index x-value", and pixel coordinates at compile
// time (the classic "plugged a price into an x slot" bug class). Values crossing INTO a branded
// slot from untyped data (`any` rows) pass unchecked -- the brands bite between typed locals, and
// their reach grows as `any` boundaries shrink. Produce a brand with a cast at the conversion
// source: `return /** @type {import('./types.js').YPx} */ (v)`.

/** A price in instrument units. @typedef {number & { __brand: 'price' }} Price */
/** An x-domain value: time in ms, or a bar index in ib mode. @typedef {number & { __brand: 'timex' }} TimeX */
/** A horizontal pixel coordinate within a grid. @typedef {number & { __brand: 'xpx' }} XPx */
/** A vertical pixel coordinate within a grid. @typedef {number & { __brand: 'ypx' }} YPx */

// ---- layout ------------------------------------------------------------------------------------

/** The buildLayout() input -- the full frame description the engine hands the author's Layout/GridMaker. */
/**
 * @typedef {Object} BuildLayoutOptions
 * @property {Row[]} rows
 * @property {[number, number]} range
 * @property {number} width
 * @property {number} height
 * @property {Partial<Colors>} [colors]
 * @property {string} [font]
 * @property {number} [timezone]
 * @property {number} [dayRoll]
 * @property {Record<number, any>} [yTransforms]
 * @property {Record<string, any>} [layersMeta]
 * @property {Array<{ rows: Row[], grid?: any }>} [offcharts]
 * @property {Row[]} [future]
 * @property {boolean} [logScale]
 * @property {number} [scaleMode]
 * @property {{ top?: number, bottom?: number }} [scaleMargins]
 * @property {boolean} [ib]
 * @property {number} [mainGridHeight]
 * @property {boolean} [hidePrice]
 * @property {boolean} [hideTime]
 * @property {number} candleWidth   the Chart always passes a number (0 = use the config default)
 * @property {number} labelGap      the Chart always passes a number (0 = use the config default)
 * @property {number} [minMove]
 * @property {number} [tickPrec]
 */

/** One built grid (a pane) from the author's Layout. The render classes read many fields off it; the
 * coordinate mappers are the stable surface, BRANDED so price/time/pixel spaces can't cross.
 * Open index signature for the rest.
 * @typedef {Object} GridLayoutKnown
 * @property {number} height
 * @property {number} width
 * @property {number} [px_step]
 * @property {any} [ti_map]
 * @property {(t: TimeX) => XPx} t2screen
 * @property {(x: XPx) => TimeX} screen2t
 * @property {(v: Price) => YPx} [$2screen]
 * @property {(y: YPx) => Price} [screen2$]
 */
/** @typedef {GridLayoutKnown & Record<string, any>} GridLayout */

/** A value->pixel overlay price scale (makeScaleView): a g-like coordinate view for one overlay scale. */
/**
 * @typedef {Object} ScaleViewKnown
 * @property {number} A
 * @property {number} B
 * @property {number} height
 * @property {number} width
 * @property {number} [px_step]
 * @property {any} [ti_map]
 * @property {(v: Price) => YPx} $2screen
 * @property {(y: YPx) => Price} screen2$
 * @property {(t: TimeX) => XPx} t2screen
 * @property {(x: XPx) => TimeX} screen2t
 */
/** @typedef {ScaleViewKnown & Record<string, any>} ScaleView */
