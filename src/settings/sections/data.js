// @ts-check
// Settings -> Data section (Tier 3 of the chart-dialog de-monolith). The opt-in persistent
// historical-bar cache: a Preload form (fetch a broker/symbol/tf date range into the cache now) and
// a library of opted-in symbols kept cached + maintained. A curated list of (broker, symbol, start
// date) the app keeps local and updates over time; everything else stays on the lazy in-memory
// cache. See memory: historical-bar-cache-design. Imports its own domain deps directly.
import { barCache } from '../../market/bar-cache.js';
import { openSymbolSearch } from '../../market/symbol-search.js';
import { broker } from '../../../data_engine/index.js';
import { lookFor, byId } from '../../workspace/timeframes.js';
import { getSetting } from '../settings.js';
import { DAY_MS, fmtBytes, fmtCovDate, msToDateInput, dateInputToMs } from '../sd-format.js';
import { openDateTimePicker } from '../../ui/datetime-picker.js';   // the app's themed calendar (date-only)
import { t as tr } from '../../i18n/i18n.js';   // vocabulary lookup (aliased -- `t` is a bar-record param here)

// A read-only "YYYY-MM-DD" field that opens the app's themed calendar (date-only) on click, replacing the
// browser's native date popup. Keeps its .value as the date string; calls onPick(value) after a pick.
/** @param {string} initValue @param {(v: string) => void} onPick @returns {HTMLInputElement} */
function themedDate(initValue, onPick) {
  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.type = 'text'; input.readOnly = true; input.className = 'sd-text'; input.style.width = '150px'; input.style.cursor = 'pointer';
  input.value = initValue;
  input.onclick = () => openDateTimePicker({
    time: false, title: tr('Pick your date'), value: dateInputToMs(input.value),
    onSet: (ms) => { input.value = msToDateInput(ms); onPick(input.value); },
  });
  return input;
}

// preload form state, survives re-render
/** @typedef {{ brokerId?: string, symbol?: string, tfId?: string, fromV?: string, toV?: string }} PreloadFormState */
/** @type {PreloadFormState} */
const formState = {};

// resolve a symbol to its contractId once (proxy/core both callback-based)
/** @param {any} api @param {string} symbol */
const resolveOnce = (api, symbol) => new Promise((resolve) => api.resolveSymbol(symbol, (/** @type {any} */ inst) => resolve(inst)));
// one logical history fetch -> resolves with all bars when the report is complete
// (some brokers stream several chunks; others send one complete reply).
/** @param {any} api @param {any} params @returns {Promise<{ bars: any[], error?: any }>} */
function getBarsOnce(api, params) {
  return new Promise((resolve) => {
    /** @type {any[]} */
    const acc = []; let done = false;
    api.getBars(params, (/** @type {any} */ u) => {
      if (done || !u) return;
      if (u.error) { done = true; resolve({ bars: acc, error: u.error }); return; }
      if (u.bars) acc.push(...u.bars);
      if (u.complete) { done = true; resolve({ bars: acc }); }
    });
  });
}
// Preload a [fromMs, toMs] range for one (broker, symbol, tf) into the cache by walking
// the range in lookFor-sized windows (the per-request size brokers serve), storing each.
// Sequential (one request in flight) to respect broker rate limits. onProgress(step,total,bars).
/**
 * @param {{ brokerId: string, symbol: string, tf: any, fromMs: number, toMs: number }} params
 * @param {(step: number, total: number, bars: number) => void} onProgress
 * @returns {Promise<{ error?: any, bars?: number }>}
 */
async function preloadRange({ brokerId, symbol, tf, fromMs, toMs }, onProgress) {
  const api = broker.for(brokerId);
  if (!api) return { error: tr('Broker not connected.') };
  const inst = await resolveOnce(api, symbol);
  if (!inst) return { error: tr('Symbol not resolved (connect the broker?).') };
  const id = inst.id;
  const step = lookFor(tf);
  const totalSteps = Math.max(1, Math.ceil((toMs - fromMs) / step));
  let cursor = toMs, n = 0, bars = 0;
  while (cursor > fromMs) {
    const winTo = cursor, winFrom = Math.max(fromMs, cursor - step);
    const u = await getBarsOnce(api, { id, tf, fromMs: winFrom, toMs: winTo });
    if (u.error) return { error: u.error, bars };
    if (u.bars.length) {
      const put = await barCache.putBars(brokerId, symbol, tf.id, u.bars);
      if (!put || !put.ok) return { error: tr('Cache write failed — restart the app to load the data server.'), bars };
      bars += u.bars.length;
    }
    cursor = winFrom; n++;
    onProgress(n, totalSteps, bars);
  }
  return { bars };
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, renderContent, labeled } = ctx;
  const sel = formState;

  // ---- PRELOAD: fetch a specific broker/symbol/tf over a date range into the cache now ----
  section('PRELOAD HISTORY');
  const ph = document.createElement('div');
  ph.style.cssText = 'color:var(--tx-dim);font-size:12px;line-height:1.6;margin:6px 0 12px;';
  ph.textContent = tr('Download a date range from the broker straight into the local cache. Pick a symbol, timeframe and range, then Preload. The symbol is added to the library below.');
  content.appendChild(ph);

  const pickRow = document.createElement('div'); pickRow.className = 'data-card-ctl';
  const pickBtn = document.createElement('button');
  pickBtn.textContent = sel.symbol ? ((broker.labelOf(sel.brokerId) || sel.brokerId) + ' · ' + sel.symbol) : tr('Pick symbol…');
  pickBtn.onclick = () => openSymbolSearch((b, s) => { sel.brokerId = b; sel.symbol = s; if (ctx.activeCat === 'Data') renderContent(); });
  const intervals = getSetting('intervals') || [];
  if (!sel.tfId && intervals[0]) sel.tfId = intervals[0].id;
  const tfSel = document.createElement('select');
  intervals.forEach((/** @type {any} */ iv) => { const o = document.createElement('option'); o.value = iv.id; o.textContent = iv.id; tfSel.appendChild(o); });
  tfSel.value = sel.tfId || '';
  tfSel.onchange = () => { sel.tfId = tfSel.value; };
  pickRow.append(pickBtn, tfSel);
  content.appendChild(pickRow);

  const dateRow = document.createElement('div'); dateRow.className = 'data-card-ctl';
  const fromI = themedDate(sel.fromV || msToDateInput(Date.now() - 30 * DAY_MS), (v) => { sel.fromV = v; });
  const toI = themedDate(sel.toV || msToDateInput(Date.now()), (v) => { sel.toV = v; });
  dateRow.append(labeled('From', fromI), labeled('To', toI));
  content.appendChild(dateRow);

  const go = document.createElement('button'); go.textContent = tr('Preload');
  const prog = document.createElement('div'); prog.className = 'data-card-cov'; prog.style.marginTop = '8px';
  go.onclick = async () => {
    if (!sel.brokerId || !sel.symbol) { prog.textContent = tr('Pick a symbol first.'); return; }
    const tf = byId(tfSel.value);
    if (!tf) { prog.textContent = tr('Pick a timeframe.'); return; }
    const fromMs = dateInputToMs(fromI.value), toMs = dateInputToMs(toI.value) + DAY_MS;   // include the To day
    if (!(toMs > fromMs)) { prog.textContent = tr('To date must be after From.'); return; }
    go.disabled = pickBtn.disabled = true;
    // keep the symbol in the library (preserve an existing start date)
    const lib = await barCache.library();
    const ex = lib.find((r) => r.broker === sel.brokerId && r.symbol === sel.symbol);
    await barCache.addLibrary(sel.brokerId, sel.symbol, /** @type {number} */ (ex ? ex.startMs : fromMs));
    const r = await preloadRange({ brokerId: sel.brokerId, symbol: sel.symbol, tf, fromMs, toMs },
      (n, total, bars) => { prog.textContent = tr('Preloading {tf}: window {n}/{total} · {bars} bars').replace('{tf}', tf.id).replace('{n}', String(n)).replace('{total}', String(total)).replace('{bars}', bars.toLocaleString('en-US')); });
    go.disabled = pickBtn.disabled = false;
    prog.textContent = r.error
      ? tr('Error:') + ' ' + r.error + (r.bars ? ' ' + tr('(cached {bars} before stop)').replace('{bars}', r.bars.toLocaleString('en-US')) : '')
      : tr('Done — {bars} bars cached.').replace('{bars}', (/** @type {number} */ (r.bars)).toLocaleString('en-US'));
    populateCards(listWrap, ctx);   // refresh coverage; keep the message above
  };
  content.append(go, prog);

  // ---- LIBRARY: opt-in symbols kept cached + maintained ----
  section('CACHED SYMBOLS');
  const hint = document.createElement('div');
  hint.style.cssText = 'color:var(--tx-dim);font-size:12px;line-height:1.6;margin:6px 0 12px;';
  hint.textContent = tr('Opt in a broker + symbol to keep its bars in a local library, built from a start date and updated as time goes. Any timeframe you open for it gets cached. Symbols not listed here stay on the live lazy cache.');
  content.appendChild(hint);

  const add = document.createElement('button');
  add.textContent = tr('+ Add symbol');
  add.onclick = () => openSymbolSearch((brokerId, symbol) => {
    barCache.addLibrary(brokerId, symbol, Date.now() - 90 * DAY_MS).then(() => { if (ctx.activeCat === 'Data') renderContent(); });
  });
  content.appendChild(add);

  const listWrap = document.createElement('div'); listWrap.style.marginTop = '12px';
  content.appendChild(listWrap);
  populateCards(listWrap, ctx);
}

// (re)load the library and render one card per opted-in symbol into listWrap.
/** @param {HTMLElement} listWrap @param {import('../sd-controls.js').SettingsCtx} ctx */
function populateCards(listWrap, ctx) {
  listWrap.innerHTML = '';
  const loading = document.createElement('div'); loading.className = 'sd-placeholder'; loading.textContent = tr('Loading…');
  listWrap.appendChild(loading);
  barCache.library().then((rows) => {
    if (ctx.activeCat !== 'Data') return;   // navigated away while loading
    listWrap.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'sd-placeholder';
      empty.textContent = tr('No cached symbols yet — add one above.');
      listWrap.appendChild(empty);
      return;
    }
    rows.forEach((r) => listWrap.appendChild(dataRow(r, ctx)));
  });
}

/** @param {any} r @param {import('../sd-controls.js').SettingsCtx} ctx @returns {HTMLElement} */
function dataRow(r, ctx) {
  const reload = () => { if (ctx.activeCat === 'Data') ctx.renderContent(); };
  const card = document.createElement('div'); card.className = 'data-card';

  // header: BROKER · SYMBOL .......... remove (revert to lazy, keep data)
  const head = document.createElement('div'); head.className = 'data-card-head';
  const title = document.createElement('span'); title.className = 'data-card-title';
  const tfList = (Array.isArray(r.tfs) ? r.tfs : []).map((/** @type {any} */ t) => t.tf).join(', ');
  title.textContent = (broker.labelOf(r.broker) || r.broker) + ' · ' + r.symbol + (tfList ? ' · ' + tfList : '');
  const rm = document.createElement('span'); rm.className = 'lib-x'; rm.textContent = '✕';
  rm.title = tr('Stop caching (revert to lazy; keep files)');
  rm.onclick = () => barCache.removeLibrary(r.broker, r.symbol).then(reload);
  head.append(title, rm);
  card.appendChild(head);

  // From [date] ............ Trim to date
  const ctl = document.createElement('div'); ctl.className = 'data-card-ctl';
  const lbl = document.createElement('span'); lbl.className = 'sd-label'; lbl.textContent = tr('From');
  const date = themedDate(msToDateInput(r.startMs || (Date.now() - 90 * DAY_MS)), (v) => barCache.addLibrary(r.broker, r.symbol, dateInputToMs(v)).then(reload));
  const trim = document.createElement('button'); trim.textContent = tr('Trim to date');
  trim.title = tr('Delete cached bars older than the start date');
  trim.onclick = () => barCache.trim(r.broker, r.symbol, dateInputToMs(date.value)).then(reload);
  ctl.append(lbl, date, trim);
  card.appendChild(ctl);

  // per-timeframe coverage + total size
  const tfs = Array.isArray(r.tfs) ? r.tfs : [];
  const cov = document.createElement('div'); cov.className = 'data-card-cov';
  if (!tfs.length) {
    cov.textContent = tr('No bars cached yet — open this symbol on any timeframe to start filling.');
  } else {
    tfs.forEach((/** @type {any} */ t) => {
      const line = document.createElement('div'); line.className = 'data-cov-line';
      const prefix = tfs.length > 1 ? `${t.tf}:  ` : '';   // tf is already in the title for single-tf cards
      line.textContent = `${prefix}${fmtCovDate(t.from)} → ${fmtCovDate(t.to)}  (${t.count.toLocaleString('en-US')} ${tr('bars')} · ${fmtBytes(t.bytes)})`;
      cov.appendChild(line);
    });
  }
  card.appendChild(cov);

  // delete cached data (row + files)
  const del = document.createElement('button'); del.className = 'data-del'; del.textContent = tr('Delete cached data');
  del.onclick = () => barCache.deleteData(r.broker, r.symbol).then(reload);
  card.appendChild(del);

  return card;
}
