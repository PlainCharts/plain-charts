// @ts-check
// StudyWorker -- runs a study's pure calc(bars, params, ctx) on a BACKGROUND thread, so heavy per-bar
// math (VWAP, CVD, volume profile) never blocks the render thread. Adapted from trading-vue-js's WebWork
// (author C451): a promise-by-id message transport over a Worker. kapelka has no build step, so the worker
// loads as a NATIVE ES module (new Worker(url, { type: 'module' })) -- no compiled/compressed blob like the
// original. The worker imports the SAME study registry the main thread uses and runs getStudy(id).calc();
// only the pure result (plots/shapes/fills/markers/scale -- all data) crosses back, and the host renders it.
//
// The worker OWNS the data resident: the host `send()`s it small mutations (set-bars, append-intrabar,
// reset), then `exec()`s a study with meta only -- no bars, no sub-bars cross the wire per study. This is
// what keeps stacking studies cheap: one small data sync per change, not one megabyte clone per study.

export class StudyWorker {
  constructor() {
    /** @type {Worker | null} */
    this._w = null;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void }>} */
    this._tasks = new Map();
    this._seq = 1;
  }

  /** @returns {Worker} lazily spawn the worker on first use */
  _ensure() {
    if (this._w) return this._w;
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const d = e.data || {};
      const t = this._tasks.get(d.id);
      if (!t) return;
      this._tasks.delete(d.id);
      if (d.error) t.reject(new Error(d.error));
      else t.resolve(d.results);
    };
    // a worker-level failure (e.g. the module graph failed to load) rejects everything in flight, WITH the real
    // reason so a broken worker is diagnosable, not silent
    w.onerror = (/** @type {any} */ e) => {
      const msg =
        'study worker: ' + ((e && (e.message || e.filename)) || 'load failed') + (e && e.lineno ? ' @' + e.lineno : '');
      try {
        console.error('[study-worker]', msg, e);
      } catch (_) {}
      for (const [, t] of this._tasks) t.reject(new Error(msg));
      this._tasks.clear();
    };
    this._w = w;
    return w;
  }

  /**
   * Send a fire-and-forget data mutation to the worker's resident state (no reply). The host calls this once
   * per data-change -- NOT once per study -- so a tick syncs bytes, not a per-study megabyte snapshot.
   * @param {import('./resident.js').ResidentMsg} msg
   */
  send(msg) {
    this._ensure().postMessage(msg);
  }

  /**
   * Run a BATCH of studies over the worker's resident data. The worker builds the shared window once; each step
   * study advances from its checkpoint on a data tick (returning just the changed `tail`) or recomputes fully
   * (returning `out`). No bars/sub-bars cross the wire. Each entry is `{ eid, studyId, studyUrl, params, meta,
   * sid, mode }`. Resolves to `[{ eid, out | tail | error }]`.
   * @param {Array<{ eid: any, studyId: string, studyUrl: string, params: any, meta: any, sid?: any, mode?: string }>} entries
   * @returns {Promise<Array<{ eid: any, out?: any, tail?: { key: string, points: any[] }[], error?: string }>>}
   */
  execBatch(entries) {
    const w = this._ensure();
    const id = this._seq++;
    return new Promise((resolve, reject) => {
      this._tasks.set(id, { resolve, reject });
      w.postMessage({ type: 'exec-batch', id, entries });
    });
  }

  destroy() {
    if (this._w) {
      try {
        this._w.terminate();
      } catch (_) {}
      this._w = null;
    }
    for (const [, t] of this._tasks) t.reject(new Error('study worker destroyed'));
    this._tasks.clear();
  }
}
