// @ts-check
// Consumer event emission: the crosshair-move and click callbacks the app subscribes to via
// onCursorMove / onClick. Builds the per-series data snapshot at the hovered time and fans the
// callbacks out. Lifted out of the Chart shell; the entry points take the chart reference `c`.
// (Range emission -- _emitRange -- stays in the shell: it is called from far more places and leans
// on the timeAxis() API that lives there.)

// crosshair seriesData: Map(series -> its data point at the hovered time)
/**
 * @param {any} c chart reference (engine hub: _series/_gridAt/_cbs...)
 * @param {number} tms hovered time in ms
 * @returns {Map<any, any>}
 */
function seriesDataMap(c, tms) {
  const map = new Map();
  for (const s of c._series) {
    const d = s._rows;
    if (!d.length) continue;
    let lo = 0,
      hi = d.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (d[m][0] < tms) lo = m + 1;
      else hi = m;
    }
    let i = lo;
    if (i > 0 && Math.abs(d[i - 1][0] - tms) <= Math.abs(d[i][0] - tms)) i = i - 1;
    const r = d[i];
    const seg = s._type.type === 'Segmented' && r[3]; // segmented value = payload.value (else its lo)
    let val = seg && seg.value != null ? seg.value : r[1];
    if (s._view && r[3] != null) {
      try {
        const pv = s._view.priceValues(r[3]);
        val = pv[pv.length - 1];
      } catch (_) {}
    } // custom: last priceValue
    map.set(
      s,
      s._isCandle()
        ? { time: r[0] / 1000, open: r[1], high: r[2], low: r[3], close: r[4], value: r[4] }
        : { time: r[0] / 1000, value: val },
    );
  }
  return map;
}

// leaveEvent: set on a real mouse-leave so the empty (time:undefined) emit carries a sourceEvent —
// the app treats sourceEvent===undefined as programmatic and won't clear the synced crosshair otherwise.
/**
 * @typedef {Object} CrossPoint
 * @property {number} [time] hovered time (seconds)
 * @property {{x: number, y: number}} [point]
 * @property {*} [hoveredObjectId]
 * @property {*} [sourceEvent]
 */
/**
 * @param {any} c chart reference (engine hub)
 * @param {CrossPoint | null | undefined} p hovered point, or falsy for the empty/leave emit
 * @param {*} [leaveEvent] real mouse-leave event, carried as sourceEvent on the empty emit
 */
export function emitCross(c, p, leaveEvent) {
  if (!c._cbs.crosshair.size) return;
  let arg;
  if (p) {
    const seriesData = p.time != null ? seriesDataMap(c, p.time * 1000) : new Map();
    arg = { time: p.time, point: p.point, seriesData, hoveredObjectId: p.hoveredObjectId, sourceEvent: p.sourceEvent };
  } else {
    arg = { time: undefined, point: undefined, seriesData: new Map(), sourceEvent: leaveEvent || undefined };
  }
  c._cbs.crosshair.forEach((/** @type {(a: any) => void} */ cb) => {
    try {
      cb(arg);
    } catch (_) {}
  });
}

// fire the click event (onClick) at a root-relative point — used by a touch TAP so mobile
// gets the same "click to select/place" the app wires through onClick -> pane:click.
/**
 * @param {any} c chart reference (engine hub)
 * @param {number} px root-relative x
 * @param {number} py root-relative y
 */
export function emitClick(c, px, py) {
  if (!c._cbs.click.size) return;
  const g = c._gridAt(0);
  const t = g ? c._i2t(g.screen2t(px - c._chartLeftPx)) / 1000 : null;
  const arg = { time: t, point: { x: px, y: py } };
  c._cbs.click.forEach((/** @type {(a: any) => void} */ cb) => {
    try {
      cb(arg);
    } catch (_) {}
  });
}
