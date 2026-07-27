// @ts-check
// Step engine -- runs a "step study" over ONE shared read-only window and assembles the same result shape a
// whole-array calc() returns, so the host renders it unchanged (parity by construction).
//
// A step study is PURE VANILLA JS -- no expression strings, no std lib, no interpreter. It reads a shared
// window the engine owns (the bars, exposed as column arrays) and returns THIS bar's value per plot:
//
//   requires: { bars?: true, intrabars?: true }        // what data it consumes (for dedup later)
//   init?(params, ctx) -> state                        // once per run: constants (colors, thresholds)
//   plots(params, ctx, state) -> PlotMeta[]            // once: declare the output plots (static meta)
//   step(i, shared, params, ctx, state) -> Record<plotKey, number | { value, color? }>   // per bar
//
// The engine loops the bars ONCE and calls step per bar; N step studies advance over the SAME shared window,
// not N private copies. Because step returns points and the engine accumulates them into { plots:[{...meta,
// data }] }, the output is byte-identical to the study's old calc() -- that is the migration's safety net.

/** @typedef {import('../core/types.js').Bar} Bar */
/** A shared read-only window over the bars: column arrays + length. Studies read these; they never own data.
 *  `openInterest` is sparse -- present only on bars that carry it (daily/weekly), else undefined. */
/** @typedef {{ n: number, time: number[], open: number[], high: number[], low: number[], close: number[], volume: number[], openInterest: (number|undefined)[], sub?: Bar[][] }} Shared */

/** Build the shared column-array window from a bar array. This is the ONE place bars are traversed to columns;
 *  every study on the pane then reads the same arrays.
 *  @param {Bar[]} bars @returns {Shared} */
export function sharedFromBars(bars) {
  const n = bars.length;
  const time = new Array(n), open = new Array(n), high = new Array(n), low = new Array(n), close = new Array(n), volume = new Array(n), openInterest = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    time[i] = b.time; open[i] = b.open; high[i] = b.high; low[i] = b.low; close[i] = b.close; volume[i] = b.volume; openInterest[i] = b.openInterest;
  }
  return { n, time, open, high, low, close, volume, openInterest };
}

/** @typedef {{ study: any, params: Record<string, any>, ctx?: Record<string, any> }} StepEntry */

/** Run MANY step studies over ONE traversal of the shared window. The bars are walked once; at each bar every
 *  study steps. N studies = one pass, not N. Returns one { plots } per entry, in the entry order -- each shape-
 *  identical to that study's calc(). This is the data-flow core: all studies are pure consumers of one window.
 *  @param {StepEntry[]} entries @param {Shared} sh @returns {{ plots: any[] }[]} */
export function runStepBatch(entries, sh) {
  const runs = entries.map((e) => {
    // init sees the shared window so it can precompute window-wide constants (e.g. a "recent days" cutoff
    // derived from the last bar's time) -- it still reads, never owns.
    const state = e.study.init ? e.study.init(e.params, e.ctx, sh) : undefined;
    const metas = e.study.plots(e.params, e.ctx, state) || [];
    // Optional study-level channels computed once like plots: static `shapes` (e.g. a zero hline) and `fills`
    // (a shaded band naming two plot keys). Per-bar shapes/markers ride on the plot point (segments/wicks/lines).
    const shapes = e.study.shapes ? e.study.shapes(e.params, e.ctx, state) : undefined;
    const fills = e.study.fills ? e.study.fills(e.params, e.ctx, state) : undefined;
    const scale = e.study.scale ? e.study.scale(e.params, e.ctx, state) : undefined;
    return {
      e, state, metas, shapes, fills, scale,
      /** @type {any[][]} */ data: metas.map(() => []),
      /** @type {Map<string, number>} */ idx: new Map(metas.map((/** @type {any} */ m, /** @type {number} */ i) => [m.key, i])),
    };
  });

  for (let i = 0; i < sh.n; i++) {   // <-- ONE traversal, shared by every study
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const row = run.e.study.step(i, sh, run.e.params, run.e.ctx, run.state);
      if (!row) continue;
      for (const k in row) {
        const pi = run.idx.get(k);
        if (pi === undefined) continue;
        const v = row[k];
        // A step returns either a scalar (-> { time, value }) or a full point object (value + color / segments /
        // any per-point field) which is spread after time -- so segmented, colored, and plain points all work.
        run.data[pi].push((v && typeof v === 'object') ? { time: sh.time[i], ...v } : { time: sh.time[i], value: v });
      }
    }
  }

  return runs.map((run) => {
    /** @type {any} */
    const res = { plots: run.metas.map((/** @type {any} */ m, /** @type {number} */ i) => ({ ...m, data: run.data[i] })) };
    if (run.shapes) res.shapes = run.shapes;
    if (run.fills) res.fills = run.fills;
    if (run.scale) res.scale = run.scale;
    return res;
  });
}

/** Run ONE step study over a shared window -> { plots: [...] }, same shape as calc(). Thin wrapper over the batch.
 *  @param {any} study @param {Shared} sh @param {Record<string, any>} params @param {Record<string, any>} [ctx] @returns {{ plots: any[] }} */
export function runStep(study, sh, params, ctx) {
  return runStepBatch([{ study, params, ctx }], sh)[0];
}
