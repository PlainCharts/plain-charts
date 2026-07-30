'use strict';
// Schwab SERVER HOOK -- OAuth + market-data proxy, shipped inside the adapter folder and
// mounted by the app's local server via the generic adapter-hook contract (see
// server/adapter-hooks.js). The browser/data-host hits /api/schwab/* and this hook
// attaches the Bearer token; app creds (clientId/secret/redirectUri) live on the account
// and are passed in on authorize/connect; tokens — with those creds for refresh — are
// persisted (auto-refreshed) in settings/brokers/schwab-tokens.json.
//
// NOTE: this adapter follows the LEGACY pre-contract architecture (REST proxied through
// the local server). It will eventually transition to the contract-based model the CQG
// and MT5 adapters established; the hook keeps its server-side needs portable meanwhile.

// The toolkit injected by server/adapter-hooks.js. Node req/res and broker payloads stay `any`
// at this boundary (the server side has no DOM/broker typings).
/** @typedef {{ sendJson: Function, readBody: Function, readSettingsFile: Function, writeSettingsFile: Function, httpsRequest: Function }} HookApi */

/** @param {HookApi} api */
module.exports = (api) => {
  const { sendJson, readBody, readSettingsFile, writeSettingsFile, httpsRequest } = api;

  const SCHWAB_AUTH = 'https://api.schwabapi.com/v1/oauth/authorize';
  const SCHWAB_TOKEN = 'https://api.schwabapi.com/v1/oauth/token';
  const SCHWAB_API = 'https://api.schwabapi.com';

  const schwabTokens = () => readSettingsFile('brokers/schwab-tokens.json');

  // Exchange an auth code / refresh token for a fresh access token, then persist.
  // The account's app creds (clientId/secret/redirectUri) are stored alongside the
  // tokens so refresh works later without the browser re-sending them.
  /** @param {any} creds @param {any} form */
  async function schwabTokenExchange(creds, form) {
    if (!creds.clientId || !creds.clientSecret) return { error: 'missing app key/secret' };
    const basic = Buffer.from(creds.clientId + ':' + creds.clientSecret).toString('base64');
    const body = new URLSearchParams(form).toString();
    const r = await httpsRequest('POST', SCHWAB_TOKEN, {
      headers: {
        Authorization: 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    }).catch((/** @type {any} */ e) => ({ status: 0, body: '', netError: String((e && e.message) || e) }));
    let j;
    try {
      j = JSON.parse(r.body);
    } catch (_) {
      j = {};
    }
    if (r.status !== 200 || !j.access_token) {
      // 4xx from the token endpoint = Schwab rejected the grant (dead/invalid refresh
      // token -> user must re-Authorize). status 0 / 5xx = network or server blip we can
      // retry. 'kind' lets auth/status distinguish "expired" (red) from "transient" (amber).
      const kind = r.status >= 400 && r.status < 500 ? 'auth' : 'transient';
      return { error: j.error_description || j.error || r.netError || 'HTTP ' + r.status, kind };
    }
    writeSettingsFile('brokers/schwab-tokens.json', {
      access: j.access_token,
      refresh: j.refresh_token,
      expiresAt: Date.now() + (j.expires_in || 1800) * 1000,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: creds.redirectUri || 'https://127.0.0.1',
    });
    return { ok: true };
  }

  // return a valid access token (refreshing if within 60s of expiry) plus a reason
  // code describing the outcome. Reasons: 'ok', 'no_token' (never authorized),
  // 'refresh_expired' (7-day refresh token dead -> re-Authorize), 'transient'
  // (network/5xx -> retry). This is the single source of truth for "are we live".
  async function schwabAccessDetailed() {
    const t = schwabTokens();
    if (!t.access || !t.refresh)
      return { access: null, reason: 'no_token', error: 'no stored Schwab token — Authorize first' };
    if (t.expiresAt && t.expiresAt - Date.now() > 60000) return { access: t.access, reason: 'ok' };
    if (!t.clientId) return { access: t.access, reason: 'ok' }; // can't refresh; use what we have
    const r = await schwabTokenExchange(
      { clientId: t.clientId, clientSecret: t.clientSecret, redirectUri: t.redirectUri },
      { grant_type: 'refresh_token', refresh_token: t.refresh },
    );
    if (r.ok) return { access: schwabTokens().access, reason: 'ok' };
    // carry Schwab's actual words (e.g. "Refresh token is invalid, expired or revoked") so the UI can show it
    return { access: null, reason: r.kind === 'auth' ? 'refresh_expired' : 'transient', error: r.error };
  }
  // thin wrapper: callers that only need the token (md proxy, streamer info).
  async function schwabAccess() {
    return (await schwabAccessDetailed()).access;
  }

  /** @param {any} req @param {any} res */
  async function handleSchwab(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    // prime the stored token file with this account's app creds, so token refresh
    // works without the browser re-sending them. Blank fields keep existing values.
    if (p === '/api/schwab/creds' && req.method === 'POST') {
      return readBody(req, (/** @type {any} */ d) => {
        const t = schwabTokens();
        writeSettingsFile('brokers/schwab-tokens.json', {
          ...t,
          clientId: (d.clientId || '').trim() || t.clientId || '',
          clientSecret: (d.clientSecret || '').trim() || t.clientSecret || '',
          redirectUri: (d.redirectUri || '').trim() || t.redirectUri || 'https://127.0.0.1',
        });
        sendJson(res, 200, { ok: true });
      });
    }

    // build the authorize URL from the account's clientId/redirectUri
    if (p === '/api/schwab/auth/url' && req.method === 'POST') {
      return readBody(req, (/** @type {any} */ d) => {
        const clientId = (d.clientId || '').trim();
        if (!clientId) return sendJson(res, 400, { error: 'enter your App Key (Client ID) first' });
        const redirectUri = (d.redirectUri || '').trim() || 'https://127.0.0.1';
        const url =
          SCHWAB_AUTH +
          '?response_type=code&client_id=' +
          encodeURIComponent(clientId) +
          '&redirect_uri=' +
          encodeURIComponent(redirectUri);
        sendJson(res, 200, { url });
      });
    }

    // exchange the pasted code using the account's creds
    if (p === '/api/schwab/auth/exchange' && req.method === 'POST') {
      return readBody(req, async (/** @type {any} */ data) => {
        let code = (data.code || '').trim();
        if (!code && data.url) {
          try {
            code = new URL(data.url).searchParams.get('code') || '';
          } catch (_) {}
        }
        if (!code) return sendJson(res, 400, { error: 'no authorization code found in input' });
        const creds = {
          clientId: (data.clientId || '').trim(),
          clientSecret: (data.clientSecret || '').trim(),
          redirectUri: (data.redirectUri || '').trim() || 'https://127.0.0.1',
        };
        if (!creds.clientId || !creds.clientSecret)
          return sendJson(res, 400, { error: 'enter App Key and App Secret first' });
        const r = await schwabTokenExchange(creds, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: creds.redirectUri,
        });
        sendJson(res, r.error ? 400 : 200, r);
      });
    }

    if (p === '/api/schwab/auth/status') {
      // Truthful status: actually resolve a live token (triggers a silent refresh when
      // the access token has lapsed). Only report authorized if a valid token comes back
      // -- a present-but-expired token is NOT authorized. 'reason' drives the UI warning.
      const { access, reason, error } = await schwabAccessDetailed();
      const t = schwabTokens();
      return sendJson(res, 200, {
        authorized: !!access,
        reason,
        error: error || null, // Schwab's real message when a refresh/exchange failed
        expiresInSec: t.expiresAt ? Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000)) : 0,
      });
    }

    // streamer connection details (needs the Accounts and Trading product). The
    // browser opens the streamer WebSocket directly with the short-lived token.
    if (p === '/api/schwab/stream-info') {
      const access = await schwabAccess();
      if (!access) return sendJson(res, 401, { error: 'not authorized' });
      const r = await httpsRequest('GET', SCHWAB_API + '/trader/v1/userPreference', {
        headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' },
      });
      let pref;
      try {
        pref = JSON.parse(r.body);
      } catch (_) {
        pref = null;
      }
      const s = pref && Array.isArray(pref.streamerInfo) && pref.streamerInfo[0];
      if (r.status !== 200 || !s) {
        return sendJson(res, 200, {
          error: 'no streamer access (add the Accounts and Trading product and re-authorize)',
        });
      }
      return sendJson(res, 200, {
        socketUrl: s.streamerSocketUrl,
        customerId: s.schwabClientCustomerId,
        correlId: s.schwabClientCorrelId,
        channel: s.schwabClientChannel,
        functionId: s.schwabClientFunctionId,
        accessToken: access,
      });
    }

    // proxy GETs to the Schwab Market Data API with the Bearer token attached
    if (p.startsWith('/api/schwab/md/')) {
      const access = await schwabAccess();
      if (!access) return sendJson(res, 401, { error: 'not authorized' });
      const target = SCHWAB_API + '/marketdata/v1/' + p.slice('/api/schwab/md/'.length) + (u.search || '');
      const r = await httpsRequest('GET', target, {
        headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' },
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(r.body || '{}');
    }

    // proxy GETs to the Schwab TRADER API (accounts / positions / orders) with the Bearer token.
    // READ-ONLY BY CONSTRUCTION: only GET passes through, so this path cannot place/modify/cancel an
    // order -- execution stays deferred to a deliberate, separately-added write path.
    if (p.startsWith('/api/schwab/trader/')) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'trader proxy is read-only (GET only)' });
      const access = await schwabAccess();
      if (!access) return sendJson(res, 401, { error: 'not authorized' });
      const target = SCHWAB_API + '/trader/v1/' + p.slice('/api/schwab/trader/'.length) + (u.search || '');
      const r = await httpsRequest('GET', target, {
        headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' },
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(r.body || '{}');
    }

    sendJson(res, 404, { error: 'unknown schwab endpoint' });
  }

  return { prefix: '/api/schwab/', handle: handleSchwab };
};
