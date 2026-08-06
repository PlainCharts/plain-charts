// @ts-check
// ALERT ENGINE — runtime (app layer). Runs in the hidden alert-host window (role=alerts), the single owner
// of all alert business logic. It CONSUMES the sealed data_engine through its public facade only (quotes,
// bars, connection state) and never couples into it. Nothing here touches a broker socket.
//
// This mirrors the Order Worker: a dedicated headless host so an alert fault is isolated. Phases:
//   P1  host boots, joins the data bridge as a proxy, proves it can read live engine state.       [done]
//   P2  authoritative alert store + command funnel + read-only window mirrors + persistence.      [done]
//   P3  evaluation loop -- price crossings vs a fixed level (hline anchor).                        [this]
//   P4  actions (toast / email / telegram / sound / webhook).
//   P5  moving levels (trendline via a synced drawing store) + headless study compute.
//
// LAWS (enforced): ONE authoritative store, owned HERE; other windows hold read-only mirrors (store.js);
// the ONLY mutator is this host via the command funnel (funnel.js). event -> command -> mutate -> save +
// broadcast -> mirrors -> render. Rendering never mutates; actions never build DOM.
import { broker, bus } from '../../data_engine/index.js';
import { getJSON, postJSON } from '../api.js';
import { createAlertStore } from './store.js';
import { createAlertLog } from './log-store.js';
import { registerAlertHandler } from './funnel.js';
import { subscribeBarFeed, retryIdle } from './feed.js';
import {
  conditionFires,
  cadenceAllows,
  markFired,
  isExpired,
  cadenceOf,
  conditionEvaluable,
  substituteSeries,
} from './eval.js';
import { resolveSeries, runnerKeyOf, gcRunners } from './study-runner.js'; // headless study compute for SERIES terms
import { nextFire, scheduleValid } from './schedule.js';
import { sourceOf, applyOf, rtFor, withRt, listSymbols, fillPlaceholders } from './alert-record.js';
import { alertTzOffsetMin, alertSoundPath, soundObjectUrl, fmtAlertTime } from './alert-display.js';
import { loadSettings } from '../settings/settings.js';
import { IPC } from '../ipc-contract.js';

/** @type {BroadcastChannel|null} */
let firedChan = null;
try {
  firedChan = new BroadcastChannel(IPC.ALERT_FIRED);
} catch (_) {}
// A window dismissing an alert (popup/toast) posts { kind:'dismiss' } back on this channel; the host stops
// the notification sound it's playing (a long sound file shouldn't outlive the alert the user just cleared).
if (firedChan)
  firedChan.onmessage = (/** @type {MessageEvent} */ e) => {
    if (e && e.data && e.data.kind === 'dismiss') stopSound();
  };

// ---- authoritative store ---------------------------------------------------------------------------
const store = createAlertStore(); // authoritative: writes + broadcasts to every window's mirror
const log = createAlertLog(); // authoritative fire LOG (the mailbox): host appends, mirrors read

// ---- persistence (settings/market/alert-rules.json) ------------------------------------------------
/** @type {any} */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => postJSON('/api/alert-rules/merge', { alerts: store.all() }), 200);
}

// ---- log persistence (settings/market/alert-log.json) ----------------------------------------------
// The log is a capped ring; we persist the WHOLE ordered array under one `entries` key (merge folds it in).
/** @type {any} */
let saveLogTimer = null;
function scheduleSaveLog() {
  clearTimeout(saveLogTimer);
  saveLogTimer = setTimeout(() => postJSON('/api/alert-log/merge', { entries: log.all() }), 200);
}
async function loadLog() {
  try {
    const doc = await getJSON('/api/alert-log');
    const entries = doc && Array.isArray(doc.entries) ? doc.entries : [];
    log.reset(
      entries
        .filter((/** @type {any} */ e) => e && e.at)
        .map((/** @type {any} */ e) => (e.id ? e : { ...e, id: newLogId() })),
    );
    console.info(
      `[alert-host] loaded ${log.size()} log entr${log.size() === 1 ? 'y' : 'ies'} from settings/market/alert-log.json`,
    );
  } catch (err) {
    console.error(
      '[alert-host] failed to load alert-log.json',
      /** @type {any} */ (err && /** @type {any} */ (err).message) || err,
    );
  }
}
// Persist on every real mutation (a fire append or a clear); the load-time `reset` is skipped -- it would
// only re-save what we just read.
log.subscribe((ev) => {
  if (ev.type !== 'reset') scheduleSaveLog();
});
async function loadRules() {
  try {
    const doc = await getJSON('/api/alert-rules');
    /** @type {any[]} */
    const list = doc && Array.isArray(doc.alerts) ? doc.alerts : [];
    store.reset(
      list
        .filter((a) => a && a.id)
        .map((a) => {
          // stamp the producer once: every record that predates the field is a price alert (the only kind there was).
          if (a.source == null) a = { ...a, source: 'price' };
          // stamp the stable cadence once for any record that predates the field (so the eval loop never parses a label).
          if (a.cadence == null) a = { ...a, cadence: cadenceOf(a.trigger) };
          // normalize legacy records: a Once-only alert that already fired is Stopped (the auto-stop-on-fire rule).
          if (a.enabled && a.rt && a.rt.fired && a.cadence === 'once') a = { ...a, enabled: false };
          return /** @type {[string, any]} */ ([a.id, a]);
        }),
    );
    scheduleSave(); // persist any normalization
    console.info(`[alert-host] loaded ${store.size()} rule(s) from settings/market/alert-rules.json`);
  } catch (err) {
    console.error(
      '[alert-host] failed to load alert-rules.json',
      /** @type {any} */ (err && /** @type {any} */ (err).message) || err,
    );
  }
}

// ---- watchlist snapshot (for watchlist-scoped alerts) ----------------------------------------------
// A watchlist alert applies to every symbol in a named list. The host reads the list membership as a plain
// FILE snapshot (/api/watchlist) -- it never imports the DOM-coupled panel state; the schema read lives in the
// pure alert-record leaf (listSymbols). The watchlist store isn't cross-window broadcast, so we refresh the
// snapshot on our existing re-arm triggers (boot / logon / connections) and on a light poll, reconciling only
// when membership actually changed. The fetch is skipped entirely unless some alert is watchlist-scoped.
/** @type {any} */
let wlDoc = { lists: [] };
let wlSig = '';
/** cheap signature of every list's ordered symbol membership -- reconcile only when this changes. @param {any} doc */
function wlSignature(doc) {
  const lists = doc && Array.isArray(doc.lists) ? doc.lists : [];
  return lists
    .map(
      (/** @type {any} */ l) =>
        l.id +
        ':' +
        listSymbols(doc, l.id)
          .map((s) => (s.broker || '*') + s.symbol)
          .join(','),
    )
    .join('|');
}
async function refreshWatchlists() {
  if (!store.all().some((r) => applyOf(r).kind === 'watchlist')) return; // no watchlist alert -> nothing to track
  try {
    const doc = await getJSON('/api/watchlist');
    const sig = wlSignature(doc);
    if (sig === wlSig) return; // membership unchanged -> no re-arm
    wlDoc = doc;
    wlSig = sig;
    reconcile(); // a symbol was added/removed -> bring feeds in line
  } catch (err) {
    console.error('[alert-host] failed to load watchlist snapshot', errStr(err));
  }
}
setInterval(refreshWatchlists, 4000); // membership edits land within a few seconds (gated: no-ops with no watchlist alert)

/** hex id unique within the store */
function newId() {
  const seed = (performance.now() * 1e3) | 0;
  let id = (seed ^ (store.size() << 8)).toString(16);
  while (store.get(id)) id = (parseInt(id, 16) + 1).toString(16);
  return id;
}

// a per-session monotonic id for a log entry, so a single entry can be deleted precisely (legacy entries that
// predate the field get one assigned on load).
let logSeq = 0;
const newLogId = () => Date.now().toString(36) + '-' + (logSeq++).toString(36);

// ---- command handlers (the ONLY writers) -----------------------------------------------------------
// create: assign an id + createdAt to the dialog draft and store it. update/toggle: patch by id.
// remove: drop by id. Every write persists. NO evaluation/firing yet (P3).
registerAlertHandler('create', (draft) => {
  const id = newId();
  const rec = { id, createdAt: Date.now(), ...draft };
  store.set(id, rec);
  scheduleSave();
  console.info('[alert-host] create', id, rec.name || '(unnamed)');
  return rec;
});
registerAlertHandler('update', ({ id, patch }) => {
  const cur = store.get(id);
  if (!cur) throw new Error('no such alert: ' + id);
  const rec = { ...cur, ...patch, id };
  store.set(id, rec);
  scheduleSave();
  return rec;
});
registerAlertHandler('toggle', ({ id, enabled }) => {
  const cur = store.get(id);
  if (!cur) throw new Error('no such alert: ' + id);
  const rec = { ...cur, enabled: enabled != null ? !!enabled : !cur.enabled };
  store.set(id, rec);
  scheduleSave();
  return rec;
});
registerAlertHandler('remove', ({ id }) => {
  store.remove(id);
  log.pruneByAlert(id); // CASCADE: an alert's fire history is part of the alert -- it goes when the alert goes
  scheduleSave();
  return { id, removed: true };
});
// Clear the mailbox. The log is host-owned, so the panel's "Clear log" routes here (windows never write it).
// log.clear() broadcasts to mirrors; the log.subscribe wire persists the now-empty ring.
registerAlertHandler('log-clear', () => {
  log.clear();
  return { cleared: true };
});
// Remove ONE mailbox entry by id -- the alert stays untouched (this only edits the log).
registerAlertHandler('log-remove', ({ id }) => {
  log.remove(id);
  return { id, removed: true };
});

// ---- evaluation loop -------------------------------------------------------------------------------
// Each ARMED alert (enabled, not expired, with at least one supported price term) holds a shared bar-feed
// subscription. On every bar report we re-read the alert (fresh runtime state), test its compiled condition
// on the relevant bar, and if the trigger cadence permits, FIRE. Firing latches runtime state back into the
// store (broadcast to mirrors + persisted). Actions are dispatched in P4 -- for now a fire is logged.

/** @param {any} rec  is this alert armed (should hold a live feed or timer)? */
function armed(rec) {
  if (!rec || !rec.enabled) return false;
  if (isExpired(rec.expiryMs, Date.now())) return false;
  // TIME alerts arm a timer -- all they need is a valid schedule (no symbol/tf/condition).
  if (sourceOf(rec) === 'time') return scheduleValid(rec.schedule);
  // PRICE alerts arm a bar feed at the alert's OWN interval (rec.tfObj, set in the dialog's interval picker --
  // NOT the chart's), plus a condition that can actually fire (conditionEvaluable, the same predicate
  // conditionFires enforces -- an ALL match with an unsupported term used to hold a feed it could never fire on).
  if (!rec.tfObj || !rec.tfObj.id) return false;
  return conditionEvaluable(rec.compiled);
}
/** the (broker, symbol) targets a price alert covers: just its own symbol, or every symbol in its watchlist.
 * @param {any} rec @returns {{ broker:(string|null), symbol:string }[]} */
function targetsOf(rec) {
  const ap = applyOf(rec);
  if (ap.kind === 'watchlist')
    return listSymbols(wlDoc, ap.listId).map((s) => ({ broker: s.broker || rec.broker || null, symbol: s.symbol }));
  return [{ broker: rec.broker || null, symbol: rec.symbol }];
}
/** @param {string|null} broker @param {string} symbol @param {any} tfObj */
const sigOf = (broker, symbol, tfObj) => (broker || '*') + '|' + symbol + '|' + (tfObj && tfObj.id);

/** the deepest history (epoch ms) this alert's extent terms need: the oldest anchor time (drawing anchors
 * are epoch SECONDS, the tool-layer unit) with a day of slack, so the feed's bar grid reaches every anchor
 * and the eval interpolates on real bars. null = no extent terms (the default span is enough).
 * @param {any} rec @returns {number|null} */
function sinceMsOf(rec) {
  const terms = (rec && rec.compiled && rec.compiled.terms) || [];
  /** @type {number|null} */
  let min = null;
  for (const t of terms) {
    const pts = t && t.extent && t.extent.points;
    if (!Array.isArray(pts)) continue;
    for (const p of pts) {
      const ms = Number(p && p.time) * 1000;
      if (Number.isFinite(ms) && (min == null || ms < min)) min = ms;
    }
  }
  return min == null ? null : min - 86400000;
}

// keyed by `alertId|symbol` -- a watchlist alert holds ONE entry per list symbol; a single-symbol alert holds one.
/** @type {Map<string, { unsub: () => void, sig: string }>} */
const subs = new Map();

// ---- time producer: timers -------------------------------------------------------------------------
// A TIME alert holds a setTimeout to its next scheduled instant (nextFire, in the alert tz) instead of a bar
// feed. Arming is idempotent -- re-running with the same next instant leaves the timer. The FIRE itself
// (cadence latch + actions + Log entry) is wired in Task 6; for now onTimer just re-arms to the next instant.
/** @type {Map<string, { handle: any, at: number }>} */
const timers = new Map();

/** @param {string} id */
function clearTimer(id) {
  const ex = timers.get(id);
  if (ex) {
    clearTimeout(ex.handle);
    timers.delete(id);
  }
}

/** Arm (or re-arm) a time alert's timer to its next fire. @param {any} rec */
function armTimer(rec) {
  const now = Date.now();
  const at = nextFire(rec.schedule, now, alertTzOffsetMin());
  if (at == null) {
    clearTimer(rec.id);
    return;
  } // a spent one-shot: nothing more to schedule
  const ex = timers.get(rec.id);
  if (ex && ex.at === at) return; // already armed to this exact instant
  if (ex) clearTimeout(ex.handle);
  timers.set(rec.id, { handle: setTimeout(() => onTimer(rec.id), Math.max(0, at - now)), at });
}

/** A time alert's timer elapsed -> FIRE: record it, run its actions, and latch the cadence. A one-shot is
 * spent (auto-stops); daily/weekly re-arm to the NEXT instant -- store.set below triggers reconcile(), which
 * re-arms the timer (a spent once, now disabled, drops out). @param {string} id */
function onTimer(id) {
  timers.delete(id);
  const rec = store.get(id);
  const now = Date.now();
  if (!rec || !rec.enabled || isExpired(rec.expiryMs, now)) return; // gone / disabled / expired -> stay disarmed
  const once = rec.schedule && rec.schedule.kind === 'once';
  const next = { ...rec, rt: { ...(rec.rt || {}), fired: true, lastFireMs: now }, lastFire: { at: now } };
  if (once) next.enabled = false;
  store.set(id, next); // broadcast + (via store.subscribe) reconcile -> re-arm daily/weekly, drop a spent once
  scheduleSave();
  console.info(`[alert-host] FIRE (time) "${rec.name || id}" (${rec.schedule && rec.schedule.kind})`);
  logFire(rec, null, now); // mailbox first (no bar -> no price) -- then the loud actions
  runActions(rec, null);
}

/** does this record carry a SERIES (study) term? @param {any} rec */
const hasSeriesTerms = (rec) =>
  ((rec && rec.compiled && rec.compiled.terms) || []).some(
    (/** @type {any} */ t) => t && t.extent && t.extent.kind === 'series',
  );

/** @param {string} id @param {string} symbol  the symbol this feed carries (=rec.symbol for a single-symbol
 * alert; one of the list members for a watchlist alert) @param {{ last: any, closed: any, tail?: any[] }} ev */
function onFeed(id, symbol, ev) {
  const rec = store.get(id);
  if (!rec || !rec.enabled) return;
  const now = Date.now();
  if (isExpired(rec.expiryMs, now)) {
    reconcile();
    return;
  }
  const cadence = /** @type {any} */ (rec.cadence); // stable field stamped by the dialog / normalized on load (never a label parse)
  const onClosed = cadence === 'per-bar-close';
  const bar = onClosed ? ev.closed : ev.last;
  if (!bar) return;
  if (hasSeriesTerms(rec)) {
    // SERIES terms resolve through the study runner (an async worker roundtrip), then the same fire path
    // runs with a values-substituted condition. The bar is captured WITH its values, so a late arrival
    // still tests a consistent (bar, level) pair; the cadence latch dedupes. The broker is the target's
    // own (a watchlist member may live on another broker), never the active adapter. The bar BEFORE the
    // tested one feeds the study-vs-Value crossing family (consecutive samples).
    const tgt = targetsOf(rec).find((x) => x.symbol === symbol);
    const tail = ev.tail || [];
    let prevBarTime = null;
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i] && tail[i].time < bar.time) {
        prevBarTime = tail[i].time;
        break;
      }
    }
    resolveSeries(
      tgt ? tgt.broker : rec.broker || null,
      symbol,
      rec.tfObj,
      ev,
      rec.compiled,
      bar.time,
      prevBarTime,
      rec.priceDecimals,
    )
      .then((vals) => {
        const cur = store.get(id); // re-read: the alert may have been edited/disabled during the roundtrip
        if (!cur || !cur.enabled || isExpired(cur.expiryMs, Date.now())) return;
        tryFire(cur, symbol, ev, bar, substituteSeries(rec.compiled, vals));
      })
      .catch((err) => console.error('[alert-host] series resolve failed', errStr(err)));
    return;
  }
  tryFire(rec, symbol, ev, bar, rec.compiled);
}

/** The fire path: test the (possibly series-substituted) condition on the captured bar, gate the cadence,
 * latch + persist + notify. @param {any} rec @param {string} symbol @param {{ tail?: any[] }} ev
 * @param {any} bar @param {any} compiled */
function tryFire(rec, symbol, ev, bar, compiled) {
  const now = Date.now();
  const cadence = /** @type {any} */ (rec.cadence);
  const onClosed = cadence === 'per-bar-close';
  if (!conditionFires(compiled, bar, ev.tail)) return; // ev.tail feeds the relative Moving % terms
  const isWatch = applyOf(rec).kind === 'watchlist';
  // the latch is per-symbol for a watchlist alert (one symbol firing must not latch another) and flat otherwise.
  if (!cadenceAllows(cadence, rtFor(rec, symbol), bar.time, now, onClosed)) return;
  const next = {
    ...rec,
    ...withRt(rec, symbol, markFired(bar.time, now)),
    lastFire: { at: now, price: bar.close, barTime: bar.time, symbol },
  };
  // 'Once only' is spent after it fires -> auto-STOP the alert (enabled=false). For a WATCHLIST
  // alert "once" is once-PER-SYMBOL: the per-symbol latch above spends that symbol; the rule stays armed for the
  // rest of the list. Recurring cadences stay armed either way. Disabling disarms the feeds on the next reconcile.
  if (cadence === 'once' && !isWatch) next.enabled = false;
  store.set(rec.id, next);
  scheduleSave();
  console.info(`[alert-host] FIRE "${rec.name || rec.id}" ${symbol} @ ${bar.close} (${rec.trigger})`);
  logFire(rec, bar, now, isWatch ? symbol : undefined); // watchlist fires tag the symbol; single-symbol reads the alert's own
  runActions(rec, bar);
}

// The mailbox append. EVENT DATA ONLY: when, which alert, the fire price. The Log tab looks up the alert's
// spec (name/symbol/tf/message) live by alertId -- nothing about the alert is copied here. A time fire (no
// bar) simply omits the price. One entry per fire; the baseline outcome even when the rule chose no action.
/** @param {any} rec @param {{ close?: number } | null} bar @param {number} at @param {string} [symbol]  the fired
 * list symbol (watchlist alerts only) -- a single-symbol alert omits it and the Log reads the alert's own symbol */
function logFire(rec, bar, at, symbol) {
  /** @type {import('./log-store.js').LogEntry} */
  const entry = { id: newLogId(), at, alertId: rec.id };
  if (bar && bar.close != null) entry.price = bar.close;
  if (symbol) entry.symbol = symbol;
  log.push(entry); // broadcasts to mirrors; the log.subscribe wire persists it
}

// ---- actions --------------------------------------------------------------------------------------
// When an alert fires, run each action the user selected (any combination, all a preference):
//   'System notification'  -> an OS notification emitted from the host (persists in the OS tray).
//   'Toast notification'   -> a small auto-dismissing corner toast in every visible window (broadcast).
//   'Popup window'         -> a center-of-workspace dialog in every visible window that STAYS until dismissed.
//   'Send email'           -> SMTP email via nodemailer, using the account in Settings > Notifications.
//   'Telegram notification'-> a Telegram message via the bot in Settings > Notifications.
// The host is headless, so toast + popup are BROADCAST (IPC.ALERT_FIRED, tagged by kind) and rendered by
// src/alerts/toast.js in the visible windows. Email/Telegram send from HERE (Node) using the git-excluded
// creds files; both are fire-and-forget -- a send failure only logs, never disturbs the eval loop.
/** @param {any} rec @param {{ close?: number } | null} [bar]  a price fire carries the bar; a time fire has none */
function runActions(rec, bar) {
  const acts = (rec && rec.actions) || [];
  // Title = the alert's Name; body = the alert's Message with #placeholders substituted at fire time.
  // NOTHING is invented: no message means no body, and an action only decides WHERE that content goes.
  const title = (rec.name && String(rec.name)) || 'Untitled';
  const body = rec.message
    ? fillPlaceholders(String(rec.message), {
        symbol: rec.symbol || '',
        broker: rec.broker || '',
        interval: rec.tf || '',
        price: bar && bar.close != null ? String(bar.close) : '',
        timenow: fmtAlertTime(Date.now()),
      })
    : '';
  if (acts.includes('System notification')) osNotify(title, body);
  if (acts.includes('Toast notification')) emitFired('toast', rec, title, body);
  if (acts.includes('Popup window')) emitFired('popup', rec, title, body);
  if (acts.includes('Send email')) emailAction(rec, title, body);
  if (acts.includes('Telegram notification')) telegramAction(rec, title, body);
  if (acts.includes('Play sound')) playSound();
}
// Play the user's chosen notification sound — the mp3 they picked, read in place from its path on disk.
// The host is an Electron renderer with full Node, so it reads the file directly; no sound picked just no-ops.
// The playing element is kept so a Dismiss can cut it short (stopSound), however long the file is.
/** @type {HTMLAudioElement|null} */
let soundEl = null;
function playSound() {
  try {
    stopSound(); // never stack two sounds
    const url = soundObjectUrl(alertSoundPath());
    if (!url) return; // no sound chosen (or file gone)
    soundEl = new Audio(url);
    soundEl.play().catch((e) => console.warn('[alert-host] Play sound skipped -', (e && e.message) || e));
  } catch (err) {
    console.error('[alert-host] Play sound failed', errStr(err));
  }
}
// Stop the sound a fire started -- called when the user dismisses the alert.
function stopSound() {
  if (!soundEl) return;
  try {
    soundEl.pause();
    soundEl.currentTime = 0;
  } catch (_) {}
  soundEl = null;
}
/** @param {string} title @param {string} body */
function osNotify(title, body) {
  try {
    new Notification(title, { body });
  } catch (err) {
    console.error('[alert-host] system notification failed', errStr(err));
  }
}
/** @param {'toast'|'popup'} kind @param {any} rec @param {string} title @param {string} body */
function emitFired(kind, rec, title, body) {
  if (firedChan) {
    try {
      firedChan.postMessage({ kind, id: rec.id, title, body, at: Date.now() });
    } catch (_) {}
  }
}
/** @param {any} err */
const errStr = (err) => /** @type {any} */ (err && /** @type {any} */ (err).message) || String(err);

// Read the current SMTP account and send. Config is fetched per fire (email alerts are cadence-gated, not
// per-tick) so a just-edited account takes effect immediately. Loads nodemailer lazily (only when used).
/** @param {any} rec @param {string} subject @param {string} text */
async function emailAction(rec, subject, text) {
  try {
    const cfg = await getJSON('/api/email-smtp');
    if (!cfg || !cfg.host || !(cfg.to || cfg.user)) {
      console.warn('[alert-host] Send email skipped for', rec.id, '- SMTP not configured');
      return;
    }
    const { sendEmail } = await import('./email.js');
    await sendEmail(cfg, { subject, text });
    console.info('[alert-host] email sent for', rec.id);
  } catch (err) {
    console.error('[alert-host] email send failed for', rec.id, '-', errStr(err));
  }
}
// Read the current Telegram bot config and send PLAIN text (alert content may contain Markdown metacharacters).
/** @param {any} rec @param {string} title @param {string} body */
async function telegramAction(rec, title, body) {
  try {
    const cfg = await getJSON('/api/telegram');
    if (!cfg || !cfg.token || !cfg.chatId) {
      console.warn('[alert-host] Telegram skipped for', rec.id, '- not configured');
      return;
    }
    const { sendTelegram } = await import('./telegram.js');
    await sendTelegram(cfg, body ? title + '\n' + body : title, { markdown: false });
    console.info('[alert-host] telegram sent for', rec.id);
  } catch (err) {
    console.error('[alert-host] telegram send failed for', rec.id, '-', errStr(err));
  }
}

// Bring live feed subscriptions in line with the armed set. Re-subscribes when an alert's broker/symbol/tf
// changes; drops feeds for disarmed/removed alerts. Cheap + idempotent -- run on every store change.
function reconcile() {
  const liveFeeds = new Set();
  const liveTimers = new Set();
  /** @type {Set<string>} feeds whose alerts carry SERIES terms -- their study workers stay alive */
  const liveRunners = new Set();
  for (const rec of store.all()) {
    if (!armed(rec)) continue;
    // TIME alerts branch to a timer; PRICE alerts branch to a bar feed. That is the ONLY divergence.
    if (sourceOf(rec) === 'time') {
      liveTimers.add(rec.id);
      armTimer(rec);
      continue;
    }
    // one feed per target symbol -- a single-symbol alert has one target, a watchlist alert one per list member.
    // All sample at the alert's own interval (rec.tfObj, from the dialog's picker), never the chart's.
    for (const tgt of targetsOf(rec)) {
      const key = rec.id + '|' + tgt.symbol;
      liveFeeds.add(key);
      if (hasSeriesTerms(rec)) liveRunners.add(runnerKeyOf(tgt.broker, tgt.symbol, rec.tfObj));
      // the depth requirement rides the signature (day-quantized so a drag inside one day doesn't churn):
      // dragging an anchor further into the past re-registers the listener, which deepens the shared feed.
      const since = sinceMsOf(rec);
      const sig = sigOf(tgt.broker, tgt.symbol, rec.tfObj) + '|' + (since == null ? '' : Math.floor(since / 86400000));
      const ex = subs.get(key);
      if (ex && ex.sig !== sig) {
        ex.unsub();
        subs.delete(key);
      }
      if (!subs.has(key)) {
        const unsub = subscribeBarFeed(
          tgt.broker,
          tgt.symbol,
          rec.tfObj,
          (ev) => onFeed(rec.id, tgt.symbol, ev),
          since == null ? undefined : since,
        );
        subs.set(key, { unsub, sig });
      }
    }
  }
  for (const [id, e] of subs)
    if (!liveFeeds.has(id)) {
      e.unsub();
      subs.delete(id);
    }
  for (const [id] of timers) if (!liveTimers.has(id)) clearTimer(id); // drop timers for disarmed/removed time alerts
  gcRunners(liveRunners); // drop study workers whose series alerts disarmed
}

store.subscribe(() => reconcile()); // any create/update/toggle/remove re-arms the loop

// ---- boot ------------------------------------------------------------------------------------------
// P1 liveness probe: prove the proxy bridge is live by reporting the connection snapshot / active adapter.
/** @param {string} reason */
function report(reason) {
  const conns = (broker.connections && broker.connections()) || [];
  const label = broker.active && broker.active() ? broker.labelOf && broker.labelOf() : '(none)';
  console.info(`[alert-host] ${reason}: ${conns.length} connection(s), active=${label}, rules=${store.size()}`);
}
// A broker connecting can un-idle feeds created while disconnected -- retry, then re-arm.
bus.on('connections:changed', () => {
  report('connections:changed');
  retryIdle();
  reconcile();
  refreshWatchlists();
});
bus.on('logon', () => {
  report('logon');
  retryIdle();
  reconcile();
  refreshWatchlists();
});

// Load rules + the mailbox + settings (the alert tz the time branch schedules in) BEFORE the first reconcile,
// so nothing arms or fires against half-loaded state. Then pull the watchlist snapshot (needs rules loaded to
// know whether any alert is watchlist-scoped) and re-reconcile if it added targets.
Promise.all([loadRules(), loadLog(), loadSettings()]).then(reconcile).then(refreshWatchlists);
console.info('[alert-host] ready (P3: price-crossing evaluation loop; actions still stubbed)');
report('boot');
