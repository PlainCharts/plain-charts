// @ts-check
// Settings -> App -> Notifications. App-wide accounts used by ALERT ACTIONS, split into sub-tabs: Email (SMTP)
// and Telegram. Email needs the user's own SMTP relay (a desktop app can't deliver mail directly -- see
// src/alerts/email.js); Telegram needs a bot token + chat id. Both hold a secret, so they persist in the
// git-excluded settings/brokers/*.json (email-smtp.json / telegram.json); the alert-host reads the same files
// when an alert fires.
import { getJSON, postJSON } from '../../api.js';
import { t } from '../../i18n/i18n.js';

const SMTP_EP = '/api/email-smtp';
const TG_EP = '/api/telegram';
let subTab = 'Email';   // Email | Telegram (module-scoped, kept across re-renders)

/** @param {any} e */
const errMsg = (e) => (e && e.message) || String(e);
/** @param {() => void} fn @param {number} ms */
function debounce(fn, ms) {
  /** @type {any} */
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}
/** @param {string} type */
const input = (type) => { const i = /** @type {HTMLInputElement} */ (document.createElement('input')); i.type = type; i.className = 'sd-text'; if (type !== 'checkbox') i.style.width = '240px'; return i; };

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, renderContent } = ctx;
  const bar = document.createElement('div'); bar.className = 'sd-subtabs';
  ['Email', 'Telegram'].forEach((tb) => {
    const b = document.createElement('div'); b.className = 'sd-subtab' + (tb === subTab ? ' active' : ''); b.textContent = t(tb);
    b.onclick = () => { subTab = tb; renderContent(); };
    bar.appendChild(b);
  });
  content.appendChild(bar);
  if (subTab === 'Telegram') renderTelegram(ctx); else renderEmail(ctx);
}

/** shared status line + setter. @param {HTMLElement} content */
function statusLine(content) {
  const el = document.createElement('div'); el.className = 'sd-placeholder'; el.style.marginTop = '6px';
  content.appendChild(el);
  return (/** @type {string} */ m, /** @type {boolean} */ isErr = false) => { el.textContent = m; el.style.color = isErr ? 'var(--sell, #d66)' : 'var(--tx2)'; };
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
function renderEmail(ctx) {
  const { content, row } = ctx;
  const server = input('text'); server.placeholder = 'smtp.company.com';
  const port = input('number'); port.placeholder = '465';
  const login = input('text'); login.placeholder = 'you@example.com';
  const pass = input('password');
  const from = input('text'); from.placeholder = t('defaults to the login');
  const to = input('text'); to.placeholder = t('where alerts are sent');

  content.append(
    row('SMTP server', server),
    row('Port', port),
    row('SMTP login', login),
    row('SMTP password', pass),
    row('From', from),
    row('To', to),
  );

  const setStatus = statusLine(content);
  // port 465 = implicit TLS, anything else = STARTTLS (587/25/2525). Default 587 if left blank.
  const cfgOf = () => { const p = Number(port.value) || 587; return { host: server.value.trim(), port: p, secure: p === 465, user: login.value.trim(), pass: pass.value, from: from.value.trim(), to: to.value.trim() }; };

  // Persist live on edit -- App settings have no Save button (they apply on change; OK just closes the dialog).
  const saveSoon = debounce(() => { postJSON(SMTP_EP + '/merge', cfgOf()).catch(() => {}); }, 300);
  [server, port, login, pass, from, to].forEach((el) => el.addEventListener('input', saveSoon));

  const testConn = document.createElement('button'); testConn.textContent = t('Test connection');
  testConn.onclick = async () => { setStatus(t('Testing…')); try { const { verifySmtp } = await import('../../alerts/email.js'); await verifySmtp(cfgOf()); setStatus(t('Connection OK.')); } catch (e) { setStatus(t('Connection failed') + ': ' + errMsg(e), true); } };

  const testSend = document.createElement('button'); testSend.textContent = t('Send test email');
  testSend.onclick = async () => {
    setStatus(t('Sending…'));
    try { const { sendEmail } = await import('../../alerts/email.js'); const r = await sendEmail(cfgOf(), { subject: t('Plain Charts — test email'), text: t('This is a test email from Plain Charts alert notifications.') }); setStatus(t('Sent to') + ' ' + ((r && r.accepted) || []).join(', ')); }
    catch (e) { setStatus(t('Send failed') + ': ' + errMsg(e), true); }
  };

  const btns = document.createElement('div'); btns.className = 'sd-inline'; btns.style.marginTop = '8px'; btns.style.justifyContent = 'flex-end';
  btns.append(testConn, testSend);
  content.appendChild(btns);

  getJSON(SMTP_EP).then((/** @type {any} */ c) => {
    if (!c) return;
    server.value = c.host || ''; if (c.port != null) port.value = String(c.port);
    login.value = c.user || ''; pass.value = c.pass || ''; from.value = c.from || ''; to.value = c.to || '';
  }).catch(() => {});
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
function renderTelegram(ctx) {
  const { content, row } = ctx;
  const token = input('password');
  const chatId = input('text'); chatId.placeholder = '123456789';

  content.append(
    row('Bot Token', token),
    row('Chat ID', chatId),
  );

  const setStatus = statusLine(content);
  const cfgOf = () => ({ token: token.value.trim(), chatId: chatId.value.trim() });

  const saveSoon = debounce(() => { postJSON(TG_EP + '/merge', cfgOf()).catch(() => {}); }, 300);
  [token, chatId].forEach((el) => el.addEventListener('input', saveSoon));

  const test = document.createElement('button'); test.textContent = t('Test');
  test.onclick = async () => {
    setStatus(t('Testing…'));
    try { const { verifyTelegram } = await import('../../alerts/telegram.js'); const r = await verifyTelegram(cfgOf()); setStatus(t('Connected as') + ' ' + (r.botName || '')); }
    catch (e) { setStatus(t('Connection failed') + ': ' + errMsg(e), true); }
  };

  const testSend = document.createElement('button'); testSend.textContent = t('Send test notification');
  testSend.onclick = async () => {
    setStatus(t('Sending…'));
    try { const { sendTelegram } = await import('../../alerts/telegram.js'); await sendTelegram(cfgOf(), t('Test message from Plain Charts alert notifications.')); setStatus(t('Sent.')); }
    catch (e) { setStatus(t('Send failed') + ': ' + errMsg(e), true); }
  };

  const btns = document.createElement('div'); btns.className = 'sd-inline'; btns.style.marginTop = '8px'; btns.style.justifyContent = 'flex-end';
  btns.append(test, testSend);
  content.appendChild(btns);

  getJSON(TG_EP).then((/** @type {any} */ c) => {
    if (!c) return;
    token.value = c.token || ''; chatId.value = c.chatId || '';
  }).catch(() => {});
}
