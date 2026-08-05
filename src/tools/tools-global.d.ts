// Ambient declarations for the tool-authoring environment. Each drawing-tool module
// (src/tools/modules/*/tool.js) calls `Tools.register({...})` with NO imports by design —
// the global `Tools` API is installed by src/tools/global.js before any tool loads. This
// declares that loader-provided global, plus the shared data shapes a tool descriptor works
// with (points, style, marks, view/pane handles), so `tsc` can type-check the tool files.
// TYPE-ONLY — never shipped, no runtime effect.

// A drawing anchor in DATA space, and its resolved SCREEN pixel.
type ToolDataPoint = { time: number; price: number };
type ToolScreenPoint = { x: number; y: number };

// A tool's line/box style bag (color/width/dash/fills/toggles). Heterogeneous across tools,
// so string-indexed with the common fields spelled out for legibility.
type ToolStyle = {
  color?: string;
  width?: number;
  lineStyle?: string | number;
  arrows?: string;
  bgOn?: boolean;
  bg?: string;
  borderOn?: boolean;
  border?: string;
  borderWidth?: number;
  wrap?: boolean;
  glyph?: string;
  size?: number;
  priceLabels?: boolean;
  [k: string]: unknown;
};

// A drawing's text styling (color/size/weight + alignment).
type ToolTextStyle = {
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  vAlign?: string;
  hAlign?: string;
  orientation?: string;
  [k: string]: unknown;
};

// One drawing object as a tool reads/writes it: data-space anchors + its style/text bags.
type ToolDrawing = {
  points?: ToolDataPoint[];
  style?: ToolStyle;
  text?: string;
  textStyle?: ToolTextStyle;
  [k: string]: unknown;
};

// One render "mark" a tool emits declaratively (geometry-as-data; the shared renderer paints it).
// Path vertices mix data anchors {t,p} and pixel offsets {vpx,vp,dx,dy}; fully heterogeneous.
type ToolMark = { [k: string]: unknown };

// The per-render viewport handle passed to marks()/drawText()/textGeom(). It is the vendored
// kapelka engine surface — data<->screen conversion plus viewport metrics. Opaque beyond these.
type ToolView = {
  timeToX(time: number): number | null;
  priceToY(price: number): number;
  xToTime(x: number): number | null;
  width: number;
  height: number;
  priceDecimals?: number;
  tickSize?: number | null;
  tickValue?: number | null;
  snapX?: (x: number) => number;
  bars?: Array<{ time: number; [k: string]: unknown }>;
  [k: string]: any;
};

// The pane handle passed to onCreate() — its chart/timeAxis + bar data. Vendored engine, opaque.
type ToolPane = {
  chart: { timeAxis(): { timeToX(time: number): number | null; xToTime(x: number): number | null } };
  barArr?: Array<{ time: number; low?: number | null; high?: number | null; [k: string]: unknown }>;
  barTimes?: number[];
  [k: string]: any;
};

// The result of a hitTest(): which part of a drawing (and which handle) the point is over.
type ToolHitResult = { part: string; index?: number } | null;

// A tool descriptor as handed to Tools.register(). Identity + defaults + optional draw/hit
// methods. Methods are declared with an index signature so each tool may add its own helpers
// (arrowMark, _box, …) and per-method `this`-typed JSDoc without fighting a rigid interface.
interface ToolSpec {
  id: string;
  name?: string;
  description?: string;   // one-line summary (package manager only)
  glyph?: string;         // toolbar character shown when no image icon is set
  icon?: string;          // image filename in the package folder, shown by the package manager
  kind?: string;
  points?: number | string;
  sliceable?: boolean;
  editOnCreate?: boolean;
  shiftConstrain?: string;
  defaultStyle?: ToolStyle;
  settings?: unknown;
  [k: string]: any;
}

// The global tool-authoring API installed by src/tools/global.js.
interface ToolsApi {
  register(spec: ToolSpec): void;
  unregister(id: string): void;
  get(id: string): ToolSpec | undefined;
  geom: any;
  dash(s: string | number | undefined): number[];
}

declare var Tools: ToolsApi;
