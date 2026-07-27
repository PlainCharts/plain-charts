// @ts-check
// kapelka/studies — the study layer: a study declares data (calc) and the channels turn it into the
// engine's render vocabulary (series, fills, shapes, markers, segments, scale). Framework-free and
// DOM-free; a host (yours or the app's) drives the lifecycle.
//
//   import { Studies } from 'kapelka/studies';
//   Studies.register({ id, name, calc(bars, params, ctx) { return { plots: [...] } } });
//
//   // then render with the channels + your chart:
//   import { effectiveStyle, styleToOptions, SERIES_CTOR } from 'kapelka/studies';
export { StudyHost } from './host.js';
export { Studies, registerStudy, unregisterStudy, getStudy, listStudies, setRegisterHook } from './registry.js';
export { priceOf, SOURCES } from './util.js';
export {
  SERIES_CTOR, defaultsFor, mergeBars, tfFromId, fmtVal, rgba,
  effectiveStyle, styleToOptions, applyStacking, buildFillBands, scaleProvider, bucketIntrabar, shapesToMarks,
} from './channels.js';
export { timeToX } from './primitives/geometry.js';
export { createBandPrimitive } from './primitives/band.js';
export { createMarkPrimitive, paintMark, paintMarks } from './primitives/marks.js';   // the ether: open geometry (marks) renderer + shared paint core
export { registerShape, unregisterShape, getShape, listShapes, resolveShape } from './shape-lib.js';
