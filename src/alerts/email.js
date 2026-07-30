// @ts-check
// SMTP EMAIL action for the alert engine. Runs in the Node-enabled alert-host via nodemailer (the app's only
// Node-side mail path). The SMTP account (host/port/secure/user/pass/from) is the USER's own relay -- there is
// no built-in sender and a desktop app cannot deliver mail directly (ISPs block port 25, no SPF/DKIM/reputation),
// so mail goes through a configured relay. Credentials live in an EXCLUDED settings file
// (settings/brokers/email-smtp.json via /api/email-smtp), never committed.
//
// `require` isn't a module-scope binding in an ES module; in the Node-enabled host it's a global, reached here
// through a tsc-safe cast (the app has no other require in src/).
const nodeRequire = /** @type {any} */ (globalThis).require;
const nodemailer = nodeRequire ? nodeRequire('nodemailer') : null;

/** @typedef {{ host?: string, port?: number, secure?: boolean, user?: string, pass?: string, from?: string, to?: string }} SmtpConfig */

/** @type {{ transport: any, sig: string }|null} */
let cached = null;
/** one transport per distinct account (reused across sends). @param {SmtpConfig} cfg */
function transportFor(cfg) {
  const sig = [cfg.host, cfg.port, cfg.secure, cfg.user].join('|');
  if (cached && cached.sig === sig) return cached.transport;
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: !!cfg.secure, // true = port 465 (implicit TLS); false = 587 with STARTTLS
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cached = { transport: t, sig };
  return t;
}

/**
 * Send one email through the configured SMTP relay. Resolves with the transport's result, rejects on any
 * SMTP/auth/connection error (the caller decides how loud to be).
 * @param {SmtpConfig} cfg
 * @param {{ subject: string, text: string, to?: string }} msg
 */
export async function sendEmail(cfg, msg) {
  if (!nodemailer) throw new Error('nodemailer unavailable (no Node require in this window)');
  if (!cfg || !cfg.host) throw new Error('SMTP not configured (no host)');
  const to = msg.to || cfg.to;
  if (!to) throw new Error('no recipient (to)');
  const info = await transportFor(cfg).sendMail({
    from: cfg.from || cfg.user,
    to,
    subject: msg.subject,
    text: msg.text,
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

/**
 * Verify the SMTP account works without sending mail (nodemailer's connection + auth probe). For a "Test
 * connection" button.
 * @param {SmtpConfig} cfg
 */
export async function verifySmtp(cfg) {
  if (!nodemailer) throw new Error('nodemailer unavailable');
  if (!cfg || !cfg.host) throw new Error('SMTP not configured (no host)');
  await transportFor(cfg).verify();
  return true;
}
