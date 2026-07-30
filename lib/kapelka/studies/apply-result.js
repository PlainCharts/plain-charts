// @ts-check
// The StudyHost's render sink — turning a study's computed result into engine series + primitives.
// Full application (applyResult: plots diffed in place, panes claimed, scales, shapes/fills/marker
// primitives attached) and the streaming path (applyIncremental: only the changed tail point(s) move,
// nothing is rebuilt), plus the teardown mirror (detachStudy). The host decides WHEN to compute and
// WHAT the result is; these functions only push it into the chart. `host` is the StudyHost instance
// (chart handle + _show/_mainSeries/_barTimes/_onComputed); `a` is the attachment bag.
import {
  SERIES_CTOR,
  effectiveStyle,
  styleToOptions,
  applyStacking,
  buildFillBands,
  scaleProvider,
  getCustomPlot,
  shapesToMarks,
} from './channels.js';
import { Line } from '../core/enums.js';
import { createBandPrimitive } from './primitives/band.js';
import { createMarkPrimitive } from './primitives/marks.js'; // the ether: renders shapes-as-marks

/** @typedef {Record<string, any>} Attachment */

// feedBar-equivalent for a plain point array (fill-band points): replace the last row on a time match,
// append when newer, insert in place otherwise. Keeps the band aligned as the series streams.
/** @param {any[]} arr @param {{ time: number, [k: string]: any }} p */
export function feedPoint(arr, p) {
  const n = arr.length;
  if (n && arr[n - 1].time === p.time) arr[n - 1] = p;
  else if (!n || p.time > arr[n - 1].time) arr.push(p);
  else {
    const i = arr.findIndex((x) => x.time >= p.time);
    if (i >= 0 && arr[i].time === p.time) arr[i] = p;
    else arr.splice(i < 0 ? n : i, 0, p);
  }
}

// Apply a streaming tick: feed only the changed tail point(s) into each affected series (feedBar replaces the
// last row when the time matches, appends when newer), re-pair the tail into each fill band's last point,
// refresh the legend, and repaint. No metas, primitives, panes, scales, or shapes are rebuilt -- a tick just
// moves the last point(s). Step studies with per-bar shapes/markers or run geometry do NOT take this path
// (the worker runs those fully), so only plots + line-to-line fills move here.
/** @param {any} host @param {Attachment} a @param {{ key: string, points: any[] }[]} tail @param {number} seq */
export function applyIncremental(host, a, tail, seq) {
  if (a._calcSeq !== seq) return; // superseded by a newer recompute -> drop
  if (a.error) {
    a.error = null;
    a.errLogged = null;
  }
  if (!tail || !tail.length) return;
  /** @type {Record<string, any[]>} */
  const tailByKey = {};
  for (const t of tail) {
    tailByKey[t.key] = t.points;
    const s = a.plots.get(t.key);
    if (s)
      for (const p of t.points) {
        try {
          s.feedBar(p);
        } catch (_) {}
      }
    const pm = (a.plotMeta || []).find((/** @type {any} */ m) => m.key === t.key);
    if (pm && t.points.length) pm.last = t.points[t.points.length - 1].value;
  }
  // fill bands: re-pair the top/bottom plots' tail points by time and move the band's own last point(s).
  if (a.fillBands && a.fillBands.length) {
    let touched = false;
    for (const band of a.fillBands) {
      const tops = tailByKey[band.top],
        bots = tailByKey[band.bottom];
      if (!tops || !bots) continue;
      const botAt = new Map(bots.map((/** @type {any} */ p) => [p.time, p.value]));
      for (const tp of tops) {
        const bv = botAt.get(tp.time);
        if (tp.value == null || bv == null || !isFinite(tp.value) || !isFinite(bv)) continue;
        feedPoint(band.points, { time: tp.time, top: tp.value, bottom: bv });
        touched = true;
      }
    }
    if (touched && a.fillPrim) a.fillPrim.repaint();
  }
  host._onComputed(a); // skin hook: refresh the legend's last value
}

// Turn a study's result (out = { plots, shapes, fills, markers, scale }) into engine series + primitives.
// Shared by BOTH the inline path and the batched worker flush, so results apply identically.
/** @param {any} host @param {Attachment} a @param {any} out @param {number} seq */
export function applyResult(host, a, out, seq) {
  if (a._calcSeq !== seq) return; // a newer recompute already superseded this result -> drop the stale one
  if (a.error) {
    a.error = null;
    a.errLogged = null;
  }
  if (!out) return;

  const plots = Array.isArray(out.plots) ? out.plots : [];
  a.shapes = Array.isArray(out.shapes) ? out.shapes : [];
  const stackBands = applyStacking(plots);
  a.fillBands = /** @type {any[]} */ (buildFillBands(Array.isArray(out.fills) ? out.fills : [], plots)).concat(
    stackBands,
  );
  a.markers = Array.isArray(out.markers) ? out.markers : [];

  // non-overlay study -> its own pane below; claim a fresh index on first render. EXCEPT: if the main
  // pane (0) has no series (a chart-less study-board window), the first oscillator OWNS pane 0.
  if (!a.overlay && plots.length && a.paneIndex == null) {
    try {
      const ps = host.chart.panes();
      const mainEmpty = ps[0] && ps[0].getSeries().length === 0;
      a.paneIndex = mainEmpty ? 0 : ps.length;
    } catch (_) {
      a.paneIndex = 1;
    }
  }
  const paneIndex = a.overlay ? 0 : a.paneIndex != null ? a.paneIndex : 0;
  if (!a.overlay) applyScale(host, a, paneIndex, out.scale);

  a.plotMeta = plots.map((/** @type {any} */ pl) => ({
    key: pl.key,
    name: pl.name || pl.key,
    type: pl.type || 'line',
    color: pl.color,
    colorUp: pl.colorUp,
    colorDown: pl.colorDown,
    lineWidth: pl.lineWidth,
    lineStyle: pl.lineStyle,
    lineType: pl.lineType,
    markers: pl.markers,
    fillOpacity: pl.fillOpacity,
    visible: pl.visible,
    legend: pl.legend,
    precision: pl.precision,
    last: pl.data && pl.data.length ? pl.data[pl.data.length - 1].value : null,
  }));

  reconcilePlots(host, a, plots, paneIndex);
  applyMarkers(host, a);

  if (!a.overlay && !a.stretched && a.paneIndex > 0) {
    // a pane-0 study (chart-less) fills the pane, no shrink
    try {
      const ps = host.chart.panes();
      if (ps[a.paneIndex]) {
        ps[a.paneIndex].setStretchFactor(0.3);
        a.stretched = true;
      }
    } catch (_) {}
  }

  attachResultPrimitives(host, a);

  host._onComputed(a); // skin hook (legend, controls, surfaces…)
}

// Diff the desired plots against the live series map: create a missing series, recreate on a type
// change, reconfigure + feed an existing one, and drop series whose plot key disappeared.
/** @param {any} host @param {Attachment} a @param {any[]} plots @param {number} paneIndex */
function reconcilePlots(host, a, plots, paneIndex) {
  const seen = new Set();
  plots.forEach((/** @type {any} */ pl) => {
    seen.add(pl.key);
    const eff = effectiveStyle(a.style, pl);
    let s = a.plots.get(pl.key);
    if (s && a.seriesType.get(pl.key) !== eff.type) {
      // a type change can't apply in place — recreate
      try {
        host.chart.removePlot(s);
      } catch (_) {}
      a.plots.delete(pl.key);
      a.seriesType.delete(pl.key);
      s = null;
    }
    if (!s) {
      const view = getCustomPlot(eff.type); // a registered custom primitive (plug-in) for this type?
      s = view
        ? host.chart.addCustomPlot(view, styleToOptions(eff, host._show(a)), paneIndex)
        : host.chart.addPlot(
            /** @type {Record<string, any>} */ (SERIES_CTOR)[eff.type] || Line,
            styleToOptions(eff, host._show(a)),
            paneIndex,
          );
      a.plots.set(pl.key, s);
      a.seriesType.set(pl.key, eff.type);
    } else {
      s.configure(styleToOptions(eff, host._show(a)));
    }
    s.feed(pl.data || []);
  });
  [...a.plots.keys()].forEach((k) => {
    if (!seen.has(k)) {
      try {
        host.chart.removePlot(a.plots.get(k));
      } catch (_) {}
      a.plots.delete(k);
      a.seriesType.delete(k);
    }
  });
}

// shapes + fills primitives — attach once to the anchor series, then repaint.
// A shape can carry `overlay:true` to render on the MAIN price pane even when the study lives in
// its own sub-pane; those are split off to a second primitive on the main series.
// Teardown mirror: detachStudy.
/** @param {any} host @param {Attachment} a */
function attachResultPrimitives(host, a) {
  if (a.shapes.length && !a.shapesPrim) {
    a.shapesSeries = a.overlay ? host._mainSeries() : a.plots.values().next().value || host._mainSeries();
    if (a.shapesSeries) {
      a.shapesPrim = createMarkPrimitive(
        host.chart,
        () => host._barTimes(),
        () => a.shapesSeries,
        () =>
          shapesToMarks(
            host._show(a) ? (a.overlay ? a.shapes : a.shapes.filter((/** @type {any} */ s) => !s.overlay)) : [],
          ),
      );
      try {
        a.shapesSeries.addLayer(a.shapesPrim);
      } catch (_) {}
    }
  }
  if (a.shapesPrim) a.shapesPrim.repaint();
  if (!a.overlay && a.shapes.some((/** @type {any} */ s) => s.overlay) && !a.mainShapesPrim) {
    a.mainShapesSeries = host._mainSeries();
    if (a.mainShapesSeries) {
      a.mainShapesPrim = createMarkPrimitive(
        host.chart,
        () => host._barTimes(),
        () => a.mainShapesSeries,
        () => shapesToMarks(host._show(a) ? a.shapes.filter((/** @type {any} */ s) => s.overlay) : []),
      );
      try {
        a.mainShapesSeries.addLayer(a.mainShapesPrim);
      } catch (_) {}
    }
  }
  if (a.mainShapesPrim) a.mainShapesPrim.repaint();
  if (a.fillBands.length && !a.fillPrim) {
    a.fillSeries = a.plots.values().next().value || (a.overlay ? host._mainSeries() : null);
    if (a.fillSeries) {
      a.fillPrim = createBandPrimitive(
        host.chart,
        () => host._barTimes(),
        () => a.fillSeries,
        () => (host._show(a) ? a.fillBands || [] : []),
      );
      try {
        a.fillSeries.addLayer(a.fillPrim);
      } catch (_) {}
    }
  }
  if (a.fillPrim) a.fillPrim.repaint();
}

/** @param {any} host @param {Attachment} a */
export function applyMarkers(host, a) {
  const own = a.plots.values().next().value;
  const s = own || (a.overlay ? host._mainSeries() : null);
  if (!s || !s.setMarkers) return;
  // The candle (main) series' markers are SHARED with the trade-execution overlay (index.js draws
  // markers there too). A study with no plot series of its own borrows the candle series -- but it
  // must NOT clear that series when it has no markers, or it wipes the trade marks on every recompute.
  // Only touch the borrowed main series when this study actually has markers; a study's OWN plot
  // series it may set/clear freely.
  if (s !== own && (!a.markers || !a.markers.length)) return;
  try {
    s.setMarkers(a.markers || []);
  } catch (_) {}
}

/** @param {any} host @param {Attachment} a @param {number} paneIndex @param {any} scale */
export function applyScale(host, a, paneIndex, scale) {
  const fn = scaleProvider(scale);
  if (a._scalePane != null && (a._scalePane !== paneIndex || !fn)) {
    try {
      host.chart.setPaneScale(a._scalePane, null);
    } catch (_) {}
    a._scalePane = null;
  }
  if (fn) {
    try {
      host.chart.setPaneScale(paneIndex, fn);
      a._scalePane = paneIndex;
    } catch (_) {}
  }
}

/** @param {any} host @param {Attachment} a */
export function detachStudy(host, a) {
  a._animStep = null;
  a._animRunning = false; // stop any in-flight tween loop
  if (a.shapesPrim && a.shapesSeries) {
    try {
      a.shapesSeries.removeLayer(a.shapesPrim);
    } catch (_) {}
  }
  a.shapesPrim = null;
  a.shapesSeries = null;
  if (a.mainShapesPrim && a.mainShapesSeries) {
    try {
      a.mainShapesSeries.removeLayer(a.mainShapesPrim);
    } catch (_) {}
  }
  a.mainShapesPrim = null;
  a.mainShapesSeries = null;
  if (a.fillPrim && a.fillSeries) {
    try {
      a.fillSeries.removeLayer(a.fillPrim);
    } catch (_) {}
  }
  a.fillPrim = null;
  a.fillSeries = null;
  if (a._scalePane != null) {
    try {
      host.chart.setPaneScale(a._scalePane, null);
    } catch (_) {}
    a._scalePane = null;
  }
}
