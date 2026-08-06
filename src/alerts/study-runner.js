// @ts-check
// Headless SERIES-term resolver -- the alert engine's study runtime. One kapelka StudyWorker per bar FEED
// (broker|symbol|interval): the feed's reports mirror into the worker's resident bars (set-bars once, then
// forming/append increments; any ambiguity -- backfill, multi-bar jump -- falls back to a full replace),
// and each report execs the armed series terms' studies in one pass, deduped by study+params so ten alerts
// on one SMA cost one compute. Values substitute into plain level terms host-side (eval.js
// substituteSeries), so the pure eval core never learns about studies. Grew out of study-probe.js (the
// spike); the probe stays as the standalone diagnostic.
import { StudyWorker } from '../../lib/kapelka/studies/study-worker.js';
import { barMs } from '../../data_engine/index.js';
import { plotValueAt } from './eval.js';

/** @typedef {{ time:number, open:number, high:number, low:number, close:number }} Bar */
/** @typedef {{ id:string, unit:string, n:number }} Tf */
/** @typedef {{ kind:'series', studyId:string, studyUrl:string, params:any, plot:string }} SeriesExtent */
/** @typedef {{ w: StudyWorker, tfObj: (Tf|null), have: boolean, lastTime: number, tick: (object|null),
 *   outs: Map<string, Promise<any>>, sids: Map<string, number>, sidSeq: number }} Runner */

/** @type {Map<string, Runner>} */
const runners = new Map();

/** the runner key = the feed identity. @param {string|null} broker @param {string} symbol @param {any} tfObj */
export const runnerKeyOf = (broker, symbol, tfObj) => (broker || '*') + '|' + symbol + '|' + (tfObj && tfObj.id);

/** @param {string} key @param {Tf|null} tfObj @returns {Runner} */
function ensure(key, tfObj) {
  let r = runners.get(key);
  if (!r) {
    r = {
      w: new StudyWorker(),
      tfObj,
      have: false,
      lastTime: 0,
      tick: null,
      outs: new Map(),
      sids: new Map(),
      sidSeq: 0,
    };
    runners.set(key, r);
  }
  return r;
}

/** Mirror one feed report into the resident bars -- once per report (all alerts on a feed share the same
 * `ev` object, which is the dedup key) -- and reset the per-report exec cache. @param {Runner} r @param {any} ev */
function sync(r, ev) {
  if (r.tick === ev) return;
  r.tick = ev;
  r.outs.clear();
  const last = ev && ev.last;
  /** @type {Bar[]} */
  const tail = (ev && ev.tail) || [];
  if (!r.have || !last) {
    r.w.send({ type: 'set-bars', bars: tail });
    r.have = true;
    r.lastTime = last ? last.time : 0;
    return;
  }
  if (last.time === r.lastTime) {
    r.w.send({ type: 'update-forming-bar', bar: last });
    return;
  }
  // a newer bar: a single step appends; anything else (multi-bar jump, backfill, reset) replaces fully
  const prevTime = tail.length > 1 ? tail[tail.length - 2].time : null;
  if (last.time > r.lastTime && prevTime === r.lastTime) r.w.send({ type: 'append-bar', bar: last });
  else r.w.send({ type: 'set-bars', bars: tail });
  r.lastTime = last.time;
}

/** Exec one study over the resident bars (per-report dedup by study+params: many alerts, one compute).
 * Resolves to the worker's full output (plots). @param {Runner} r @param {SeriesExtent} ext @param {number|undefined} decimals */
function execStudy(r, ext, decimals) {
  const ek = ext.studyId + '|' + JSON.stringify(ext.params);
  let p = r.outs.get(ek);
  if (!p) {
    let sid = r.sids.get(ek);
    if (!sid) {
      sid = ++r.sidSeq;
      r.sids.set(ek, sid);
    }
    const meta = {
      decimals: decimals != null ? decimals : 2,
      tickSize: null,
      candle: null,
      visibleRange: null,
      chartSec: r.tfObj ? barMs(r.tfObj) / 1000 : 0,
    };
    p = r.w
      .execBatch([
        { eid: 1, studyId: ext.studyId, studyUrl: ext.studyUrl, params: ext.params, meta, sid, mode: 'full' },
      ])
      .then((res) => {
        const x = res && res[0];
        if (!x || x.error) throw new Error((x && x.error) || 'study exec: empty result');
        return x.out;
      });
    r.outs.set(ek, p);
  }
  return p;
}

/**
 * Resolve every SERIES term of a compiled condition to its plot samples at the tested bar -- {cur, prev}
 * by term index (null = unresolvable; the substitution turns it 'unsupported'). `prev` (the value one bar
 * earlier, for the study-vs-Value crossing family) resolves null when no earlier bar exists. Syncs the
 * feed report into the worker first (idempotent per report). A study error logs once per exec and resolves
 * null -- a broken study must not wedge the eval loop.
 * @param {string|null} broker @param {string} symbol @param {any} tfObj @param {any} ev
 * @param {{ terms?: any[] }} compiled @param {number} barTime @param {number|null} prevBarTime
 * @param {number} [decimals]
 * @returns {Promise<({ cur:(number|null), prev:(number|null) }|null)[]>}
 */
export function resolveSeries(broker, symbol, tfObj, ev, compiled, barTime, prevBarTime, decimals) {
  const r = ensure(runnerKeyOf(broker, symbol, tfObj), tfObj || null);
  sync(r, ev);
  const terms = (compiled && compiled.terms) || [];
  return Promise.all(
    terms.map((t) => {
      const e = t && t.extent;
      if (!e || e.kind !== 'series') return Promise.resolve(null);
      return execStudy(r, e, decimals)
        .then((out) => ({
          cur: plotValueAt(out, e.plot, barTime),
          prev: prevBarTime != null ? plotValueAt(out, e.plot, prevBarTime) : null,
        }))
        .catch((err) => {
          console.error('[alert-studies]', e.studyId, (err && /** @type {any} */ (err).message) || err);
          return null;
        });
    }),
  );
}

/** Drop runners whose feed is no longer armed (called from the host's reconcile with the live key set),
 * so a disabled/removed series alert doesn't leave an idle worker. @param {Set<string>} live */
export function gcRunners(live) {
  for (const [k, r] of runners) {
    if (!live.has(k)) {
      r.w.destroy();
      runners.delete(k);
    }
  }
}
