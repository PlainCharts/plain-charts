// @ts-check
// Broker alert popups. The Connections dialog shows broker:notice in its status line, but that only
// helps when the dialog is OPEN -- on autoconnect at startup it is not, so a failed connection would
// be invisible. This surfaces every broker ERROR notice as a floating, dismissible popup card
// (top-right, stacking, one card per broker so repeated failures don't pile up), with an action to
// open the Connections dialog. broker:notice is bridged to every UI window, so this one listener
// catches errors from the headless data-host too.
import { bus } from '../../data_engine/index.js';   // engine events only (broker:notice)
import { t } from '../i18n/i18n.js';   // vocabulary lookup (broker error text stays runtime data)

// One broker connection notice (opaque source, known fields surfaced here).
/** @typedef {{ id?: string, error?: boolean, label?: string, message?: string }} BrokerNotice */

/** @param {string} tag @param {string|null} [cls] @param {string|null} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/** @type {HTMLElement | null} */
let wrap = null;
/** @type {Map<string, HTMLElement>} */
const cards = new Map();   // broker id -> card element (so a new error replaces the old one)

function ensureWrap() {
  if (wrap) return wrap;
  wrap = el('div', 'broker-alert-wrap');
  document.body.appendChild(wrap);
  return wrap;
}

function openConnections() {
  const btn = document.getElementById('btnOpenConnect');
  if (btn) btn.click();
}

// Show (or replace) the alert for a broker. Errors persist until dismissed; a later success for the
// same broker clears its card.
/** @param {BrokerNotice} notice */
function showAlert(notice) {
  const id = (notice && notice.id) || 'broker';
  ensureWrap();
  const prev = cards.get(id);
  if (prev) { prev.remove(); cards.delete(id); }

  if (!notice.error) return;   // a success/clear notice just removes any existing card (done above)

  const card = el('div', 'broker-alert err');
  const head = el('div', 'ba-head');
  const title = el('div', 'ba-title', (notice.label || id.charAt(0).toUpperCase() + id.slice(1)) + ' ' + t('connection problem'));
  const x = el('span', 'ba-x', '✕');
  head.append(title, x);
  const msg = el('div', 'ba-msg', notice.message || t('Connection error.'));
  const actions = el('div', 'ba-actions');
  const openBtn = el('button', 'primary', t('Open Connections'));
  const dismiss = el('button', null, t('Dismiss'));
  actions.append(openBtn, dismiss);
  card.append(head, msg, actions);

  const close = () => { card.remove(); cards.delete(id); };
  x.onclick = close;
  dismiss.onclick = close;
  openBtn.onclick = () => { openConnections(); close(); };

  /** @type {HTMLElement} */ (wrap).appendChild(card);
  cards.set(id, card);
}

export function initBrokerAlerts() {
  bus.on('broker:notice', (/** @type {BrokerNotice} */ n) => { if (n) showAlert(n); });
}
