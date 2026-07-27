// @ts-check
// TELEGRAM notification action for the alert engine. Sends via the Telegram Bot API over Node's https in the
// Node-enabled window -- no npm dep, no CORS. Config { token, chatId } lives in the git-excluded
// settings/brokers/telegram.json (the bot token is a secret). Modelled on the proven position_manager
// notifier: Markdown formatting, a 10s timeout, and a getMe-first verify (validate the token, then the chat).
// `require`/`Buffer` are Node globals here, reached through tsc-safe casts.
const nodeRequire = /** @type {any} */ (globalThis).require;
const https = nodeRequire ? nodeRequire('https') : null;

/** @typedef {{ token?: string, chatId?: string }} TelegramConfig */

/** @param {string} s */
function byteLen(s) { const B = /** @type {any} */ (globalThis).Buffer; return B ? B.byteLength(s) : s.length; }

/**
 * One Bot API call. GET when there's no payload (getMe), POST JSON otherwise (sendMessage). Rejects on
 * transport error, a 10s timeout, or a non-ok API response (surfacing Telegram's own `description`, e.g.
 * "Unauthorized" for a bad token / "chat not found" for a bad chat id).
 * @param {string} token @param {string} method @param {any} [payload]
 * @returns {Promise<any>}
 */
function tgCall(token, method, payload) {
  return new Promise((resolve, reject) => {
    if (!https) return reject(new Error('Telegram unavailable (no Node https in this window)'));
    const body = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: '/bot' + token + '/' + method,
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': byteLen(body) } : {},
      },
      (/** @type {any} */ res) => {
        let d = '';
        res.on('data', (/** @type {any} */ c) => { d += c; });
        res.on('end', () => {
          try { const j = JSON.parse(d); if (j && j.ok) resolve(j.result); else reject(new Error((j && j.description) || ('HTTP ' + res.statusCode))); }
          catch (_) { reject(new Error('bad response from Telegram')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Telegram request timed out')));
    req.end(body || undefined);
  });
}

/**
 * Send one Telegram message. Markdown by default (matching the reference's formatted alerts); pass
 * { markdown: false } for user/symbol-derived text that may contain a Markdown metacharacter (underscore,
 * asterisk) -- legacy Markdown can't be reliably escaped, so alert notifications send PLAIN. Fire-and-forget
 * friendly: the caller need not await. Rejects on any error so callers can log.
 * @param {TelegramConfig} cfg @param {string} text @param {{ markdown?: boolean }} [opts]
 * @returns {Promise<any>}
 */
export function sendTelegram(cfg, text, opts = {}) {
  if (!cfg || !cfg.token) return Promise.reject(new Error('no bot token configured'));
  if (!cfg.chatId) return Promise.reject(new Error('no chat id configured'));
  /** @type {any} */
  const payload = { chat_id: cfg.chatId, text };
  if (opts.markdown !== false) payload.parse_mode = 'Markdown';
  return tgCall(cfg.token, 'sendMessage', payload);
}

/**
 * Verify the bot: getMe validates the TOKEN (and returns the bot @username), then a test message validates the
 * CHAT ID -- so a bad token and a bad chat id give distinct, clear errors. For the settings "Test" button.
 * @param {TelegramConfig} cfg
 * @returns {Promise<{ botName: string }>}
 */
export async function verifyTelegram(cfg) {
  if (!cfg || !cfg.token) throw new Error('no bot token configured');
  const me = await tgCall(cfg.token, 'getMe');
  const botName = (me && me.username) ? '@' + me.username : 'bot';
  // PLAIN text (no parse_mode) -- exactly like the reference test_connection: the bot @username can contain a
  // Markdown metacharacter (e.g. the underscore in @satsebeli_bot), which would break Markdown parsing.
  if (cfg.chatId) await tgCall(cfg.token, 'sendMessage', { chat_id: cfg.chatId, text: 'Connected as ' + botName });
  return { botName };
}
