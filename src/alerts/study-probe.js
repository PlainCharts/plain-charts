// @ts-check
// DEV PROBE (headless-study spike): prove the alert-host can compute a study with kapelka's StudyWorker
// against its own bar feed -- no chart, no pane. Not wired into the host; a devtools/CDP session
// dynamic-imports this module in the alert-host page and calls probe(). This is the seed of the real
// series-term resolver (the next step); deliberately minimal until that lands.
import { StudyWorker } from '../../lib/kapelka/studies/study-worker.js';
import { subscribeBarFeed } from './feed.js';

/**
 * Compute one study over a live feed's bars and report each plot's LAST value.
 * `params` must be COMPLETE (the chart host merges input defaults before exec; the real resolver will
 * snapshot the attachment's already-merged params, so the probe takes the same shape).
 * @param {{ broker?: (string|null), symbol: string, tf: { id:string, unit:string, n:number },
 *   folder: string, studyId: string, params: Record<string, any>, decimals?: number }} spec
 * @returns {Promise<{ bars: number, lastBarTime: number, values: Record<string, number|null> }>}
 */
export function probe(spec) {
  return new Promise((resolve, reject) => {
    const w = new StudyWorker();
    let done = false;
    /** @type {() => void} */
    let unsub = () => {};
    /** @param {(v: any) => void} fn @param {any} v */
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      try {
        unsub();
      } catch (_) {}
      w.destroy();
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new Error('probe timeout (no bars in 20s)')), 20000);
    unsub = subscribeBarFeed(spec.broker || null, spec.symbol, spec.tf, async (ev) => {
      if (done || !ev.tail || ev.tail.length < 5) return;
      try {
        const bars = ev.tail;
        w.send({ type: 'set-bars', bars: /** @type {any} */ (bars) });
        const meta = {
          decimals: spec.decimals != null ? spec.decimals : 2,
          tickSize: null,
          candle: null,
          visibleRange: null,
          chartSec: 0,
        };
        const url = new URL('/packages/studies/' + spec.folder + '/' + spec.folder + '.js', location.href).href;
        const res = await w.execBatch([
          { eid: 1, studyId: spec.studyId, studyUrl: url, params: spec.params, meta, sid: 1, mode: 'full' },
        ]);
        const r = res && res[0];
        if (!r || r.error) throw new Error((r && r.error) || 'probe: empty worker result');
        const plots = (r.out && r.out.plots) || [];
        /** @type {Record<string, number|null>} */
        const values = {};
        for (const p of plots) {
          const d = p.data || [];
          const last = d.length ? d[d.length - 1] : null;
          values[p.key] = last && last.value != null ? last.value : null;
        }
        clearTimeout(timer);
        finish(resolve, { bars: bars.length, lastBarTime: bars[bars.length - 1].time, values });
      } catch (err) {
        clearTimeout(timer);
        finish(reject, err);
      }
    });
  });
}
