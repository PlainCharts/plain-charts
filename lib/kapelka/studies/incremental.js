// @ts-check
// Per-study checkpoint engine -- the streaming half of the study worker. A step study keeps running state
// (a cumulative sum, a window ring, an MA recurrence). Re-traversing every bar on every live tick is what a
// checkpoint avoids: the worker holds each study's state AS OF THE LAST CLOSED BAR, and on a tick re-steps
// only the forming bar from that checkpoint -- O(1) per tick instead of O(bars).
//
// This mirrors the DataCube model: resident state + one step per tick + last-point-out. The one requirement
// is that a study's mutable state be SNAPSHOT-ABLE. We snapshot generically: plain values (numbers, arrays,
// nested objects) are deep-copied; functions (a study's pure `keyOf` / colour closures) are kept by reference
// -- so a study just needs to keep its mutable accumulators in plain fields, never hidden inside a closure.
//
// A session produces the SAME per-plot points a full traversal would, so the host renders identically whether
// a study was fully recomputed (symbol change) or advanced one bar (a tick). That equivalence is the safety net.

/** Deep-copy plain state; keep functions (pure closures) by reference so they aren't cloned.
 *  @template T @param {T} s @returns {T} */
export function snapshotState(s) {
  if (!s || typeof s !== 'object') return s;
  const out = /** @type {any} */ (Array.isArray(s) ? [] : {});
  for (const k in s) {
    const v = /** @type {any} */ (s)[k];
    out[k] = v && typeof v === 'object' ? snapshotState(v) : v;
  }
  return out;
}

/** Overwrite `live` in place with a fresh deep copy of `snap` (so `live`'s arrays are independent of the
 *  checkpoint again). In place because study code holds the `live` reference.
 *  @param {any} live @param {any} snap */
export function restoreState(live, snap) {
  if (!live || !snap) return;
  for (const k in snap) {
    const v = snap[k];
    live[k] = v && typeof v === 'object' ? snapshotState(v) : v;
  }
}

/** Assemble one step() row into the plot data arrays, returning the points added (keyed by plot) so the
 *  incremental paths can forward just the tail. A scalar becomes { time, value }; an object spreads after time.
 *  @param {any} row @param {number} time @param {any[][]} data @param {Map<string, number>} idx
 *  @returns {Record<string, any> | null} */
function assembleRow(row, time, data, idx) {
  if (!row) return null;
  /** @type {Record<string, any>} */
  const pts = {};
  for (const k in row) {
    const pi = idx.get(k);
    if (pi === undefined) continue;
    const v = row[k];
    const p = v && typeof v === 'object' ? { time, ...v } : { time, value: v };
    data[pi].push(p);
    pts[k] = p;
  }
  return pts;
}

/** A live session for one attached study instance (one `sid`). Holds the study + its resident state and the
 *  checkpoint taken before the forming bar. @typedef {{
 *    study: any, params: any, ctx: any, state: any, checkpoint: any, metas: any[], shapes: any, fills: any, n: number }} StepSession */

/** @param {any} study @param {any} params @param {any} ctx @returns {StepSession} */
export function createStepSession(study, params, ctx) {
  return { study, params, ctx, state: null, checkpoint: null, metas: [], shapes: undefined, fills: undefined, n: 0 };
}

/** Full traversal: (re)build state, walk every bar, and CHECKPOINT the state right before the forming (last)
 *  bar. Returns the full result shape { plots, shapes?, fills? } -- identical to step-engine's runStep for one
 *  study. Used on first run, symbol change, backfill, or a settings change.
 *  @param {StepSession} sess @param {import('./step-engine.js').Shared} sh @returns {{ plots: any[], shapes?: any, fills?: any }} */
export function stepFull(sess, sh) {
  const st = sess.study;
  const state = st.init ? st.init(sess.params, sess.ctx, sh) : undefined;
  const metas = st.plots(sess.params, sess.ctx, state) || [];
  const shapes = st.shapes ? st.shapes(sess.params, sess.ctx, state) : undefined;
  const fills = st.fills ? st.fills(sess.params, sess.ctx, state) : undefined;
  const scale = st.scale ? st.scale(sess.params, sess.ctx, state) : undefined;
  /** @type {any[][]} */
  const data = metas.map(() => []);
  const idx = new Map(metas.map((/** @type {any} */ m, /** @type {number} */ i) => [m.key, i]));
  for (let i = 0; i < sh.n; i++) {
    if (i === sh.n - 1) sess.checkpoint = snapshotState(state); // state as of bars 0..n-2 (before the forming bar)
    assembleRow(st.step(i, sh, sess.params, sess.ctx, state), sh.time[i], data, idx);
  }
  sess.state = state;
  sess.metas = metas;
  sess.shapes = shapes;
  sess.fills = fills;
  sess.n = sh.n;
  /** @type {any} */
  const res = { plots: metas.map((/** @type {any} */ m, /** @type {number} */ i) => ({ ...m, data: data[i] })) };
  if (shapes) res.shapes = shapes;
  if (fills) res.fills = fills;
  if (scale) res.scale = scale;
  return res;
}

/** Forming-bar tick: restore to the checkpoint and re-step only the last (forming) bar. Returns the changed
 *  tail -- one point per plot that emitted -- to feed by time (replace-last).
 *  @param {StepSession} sess @param {import('./step-engine.js').Shared} sh @returns {{ tail: { key: string, points: any[] }[] }} */
export function stepForming(sess, sh) {
  restoreState(sess.state, sess.checkpoint); // back to 0..n-2
  const idx = new Map(sess.metas.map((m, j) => [m.key, j]));
  const i = sh.n - 1;
  const pts = assembleRow(
    sess.study.step(i, sh, sess.params, sess.ctx, sess.state),
    sh.time[i],
    sess.metas.map(() => []),
    idx,
  );
  sess.n = sh.n;
  return { tail: tailFrom(sess.metas, [pts]) };
}

/** Bar-close tick (one new bar appended): the previously-forming bar is now final -- commit it into the
 *  checkpoint -- then step the new forming bar. Returns the finalized closed point + the new forming point per
 *  plot, in time order (feed by time: replace the closed one, append the new one).
 *  @param {StepSession} sess @param {import('./step-engine.js').Shared} sh @returns {{ tail: { key: string, points: any[] }[] }} */
export function stepAppend(sess, sh) {
  restoreState(sess.state, sess.checkpoint); // 0..n_old-2
  const idx = new Map(sess.metas.map((m, j) => [m.key, j]));
  const closedI = sh.n - 2;
  const closedPts = assembleRow(
    sess.study.step(closedI, sh, sess.params, sess.ctx, sess.state),
    sh.time[closedI],
    sess.metas.map(() => []),
    idx,
  );
  sess.checkpoint = snapshotState(sess.state); // new checkpoint now includes the just-closed bar (0..n_old-1)
  const formI = sh.n - 1;
  const formPts = assembleRow(
    sess.study.step(formI, sh, sess.params, sess.ctx, sess.state),
    sh.time[formI],
    sess.metas.map(() => []),
    idx,
  );
  sess.n = sh.n;
  return { tail: tailFrom(sess.metas, [closedPts, formPts]) };
}

/** Collect per-plot tail points across a sequence of assembled rows (a row is the pts map from assembleRow,
 *  or null). Preserves plot order and drops plots that emitted no point in any row.
 *  @param {any[]} metas @param {(Record<string, any> | null)[]} rows @returns {{ key: string, points: any[] }[]} */
function tailFrom(metas, rows) {
  /** @type {{ key: string, points: any[] }[]} */
  const out = [];
  for (const m of metas) {
    /** @type {any[]} */
    const points = [];
    for (const r of rows) {
      if (r && r[m.key]) points.push(r[m.key]);
    }
    if (points.length) out.push({ key: m.key, points });
  }
  return out;
}
