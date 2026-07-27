// @ts-check
// The STUDY-AUTHORING contract -- the canonical shapes a study module declares to Studies.register().
// kapelka owns these; the host app mirrors them (its src/studies/studies-global.d.ts). Module @typedefs
// referenced via import('./types.js').Name; this file exports nothing at run time.

export {};

/** One OHLCV bar a study's calc() receives. Open (feeds carry extra fields). @typedef {{
 *   time: number, open: number, high: number, low: number, close: number, volume?: number, [k: string]: any }} StudyBar */

/** One declared input (rendered as a settings control; seeds `p` in calc). `type`: number|source|bool|
 *  select|color|text. @typedef {{ key: string, name?: string, type?: string, default?: any, min?: number,
 *   max?: number, step?: number, options?: any, legend?: boolean, [k: string]: any }} StudyInput */

/** One plotted point of a study output. @typedef {{ time: number, value: number, [k: string]: any }} StudyPlotPoint */

/** One output plot (a line/area/histogram/hbar/... the study draws). `data` is plot-type-specific:
 *  {time,value} points for lines, price-keyed points for hbars, richer payloads for segmented -- so `any[]`.
 *  @typedef {{ key: string, name?: string, type?: string, color?: string, lineWidth?: number,
 *   lineStyle?: number, data: any[], [k: string]: any }} StudyPlot */

/** A shaded fill between two plots/levels. @typedef {{ top: any, bottom: any, color?: string, [k: string]: any }} StudyFill */

/** What calc() returns: the plots (and optional fills / marks / meta) to render. @typedef {{
 *   plots?: StudyPlot[], fills?: StudyFill[], [k: string]: any }} StudyResult */

/** A study descriptor -- the object passed to Studies.register(). Open (studies add draw/marks/meta hooks).
 * @typedef {Object} StudySpec
 * @property {string} id
 * @property {string} name
 * @property {boolean} [overlay]
 * @property {boolean} [worker]   set false to FORCE inline; off-thread compute is default-on for pure studies
 * @property {StudyInput[]} [inputs]
 * @property {(bars: StudyBar[], p: Record<string, any>, ctx?: any) => StudyResult} [calc]
 * @property {any} [key]
 */
/** @typedef {StudySpec & Record<string, any>} StudySpecOpen  the descriptor plus the open author-defined hooks */
