// Ambient declarations for the study-authoring environment. A user indicator module is a script that
// calls the loader-provided global `Studies.register({...})` (no imports). This declares that global and
// the shared study shapes so `tsc` can type-check the module files. TYPE-ONLY -- never shipped.

interface StudyBar { time: number; open: number; high: number; low: number; close: number; volume?: number; [k: string]: any }
interface StudyInput { key: string; name?: string; type?: string; default?: any; min?: number; max?: number; step?: number; options?: any; [k: string]: any }
interface StudyPlotPoint { time: number; value: number; [k: string]: any }
interface StudyPlot { key: string; name?: string; type?: string; color?: string; lineWidth?: number; lineStyle?: number; data: StudyPlotPoint[]; [k: string]: any }
interface StudyFill { top: string; bottom: string; color?: string; [k: string]: any }
/** One alertable condition a study declares (its own named moment, e.g. "Bullish FVG"). */
interface StudyAlertCondition { key: string; name: string }
/** One occurrence of a declared condition, emitted from calc() at the bar where it becomes knowable. */
interface StudyEvent { key: string; time: number; [k: string]: any }
interface StudyResult { plots?: StudyPlot[]; fills?: StudyFill[]; events?: StudyEvent[]; [k: string]: any }
/** A study descriptor. Open/author-defined -- known fields typed, the rest (draw/marks/meta hooks) left open. */
interface StudySpec {
  id: string;
  name: string;
  overlay?: boolean;
  inputs?: StudyInput[];
  alertConditions?: StudyAlertCondition[];
  calc?(bars: StudyBar[], p: Record<string, any>, ctx?: any): StudyResult;
  [k: string]: any;
}
interface StudiesApi {
  register(spec: StudySpec): void;
  unregister(id: string): void;
  priceOf(bar: StudyBar, source: string): number;
  SOURCES: any;
}

declare var Studies: StudiesApi;
interface Window { Studies: StudiesApi }

// A custom render-primitive `view`: the engine's addCustomPlot contract a study/pack registers via
// the global `Primitives` API (installed by src/primitives/global.js). `draw(scope)` gets the engine
// render scope (ctx + data<->screen converters) -- an `any` boundary; `priceValues(point)` returns the
// numbers that drive the pane auto-scale + crosshair. Author-open, so string-indexed. TYPE-ONLY.
interface PrimitiveView {
  defaultOptions?(): Record<string, any>;
  priceValues?(point: any): number[];
  draw?(scope: any): void;
  isWhitespace?(point: any): boolean;
  destroy?(): void;
  [k: string]: any;
}
interface PrimitivesApi {
  register(id: string, view: PrimitiveView): void;
  unregister(id: string): void;
  get(id: string): PrimitiveView | undefined;
}
declare var Primitives: PrimitivesApi;
interface Window { Primitives: PrimitivesApi }
