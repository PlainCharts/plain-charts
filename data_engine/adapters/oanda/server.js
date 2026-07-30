'use strict';
// OANDA SERVER HOOK -- v20 CORS proxy, shipped inside the adapter folder and mounted by
// the app's local server via the generic adapter-hook contract (see
// server/adapter-hooks.js). Simpler than Schwab: a static personal API token (no OAuth,
// nothing to refresh), so there's NO server-side credential file — the token lives on
// the account in accounts.json and the adapter passes it per request via the
// X-OANDA-Token / X-OANDA-Env headers. We just attach it as the Bearer and route to the
// practice/live host. UNIX datetime -> epoch-second timestamps.
//
// NOTE: this adapter follows the LEGACY pre-contract architecture (REST proxied through
// the local server). It will eventually transition to the contract-based model the CQG
// and MT5 adapters established; the hook keeps its server-side needs portable meanwhile.

// The toolkit injected by server/adapter-hooks.js. Node req/res stay `any` at this boundary.
/** @typedef {{ sendJson: Function, readBody: Function, readSettingsFile: Function, writeSettingsFile: Function, httpsRequest: Function }} HookApi */

/** @param {HookApi} api */
module.exports = (api) => {
  const { sendJson, httpsRequest } = api;

  /** @param {string} env */
  const oandaHost = (env) => (env === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com');

  /** @param {any} req @param {any} res */
  async function handleOanda(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const token = req.headers['x-oanda-token'] || '';
    const env = req.headers['x-oanda-env'] === 'live' ? 'live' : 'practice';

    // connectivity check — does the token resolve any account?
    if (p === '/api/oanda/status') {
      if (!token) return sendJson(res, 200, { authorized: false });
      const r = await httpsRequest('GET', oandaHost(env) + '/v3/accounts', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      });
      return sendJson(res, 200, { authorized: r.status === 200 });
    }

    // proxy GETs to the OANDA REST API with the Bearer token attached
    if (p.startsWith('/api/oanda/md/')) {
      if (!token) return sendJson(res, 401, { error: 'no token' });
      const target = oandaHost(env) + '/' + p.slice('/api/oanda/md/'.length) + (u.search || '');
      const r = await httpsRequest('GET', target, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Accept-Datetime-Format': 'UNIX' },
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(r.body || '{}');
    }

    // trading: proxy the method (POST orders, PUT cancels, …) + body with the token attached
    if (p.startsWith('/api/oanda/tx/')) {
      if (!token) return sendJson(res, 401, { error: 'no token' });
      const target = oandaHost(env) + '/' + p.slice('/api/oanda/tx/'.length) + (u.search || '');
      const body = await new Promise((resolve) => {
        let raw = '';
        req.on('data', (/** @type {any} */ c) => {
          raw += c;
        });
        req.on('end', () => resolve(raw));
      });
      const r = await httpsRequest(req.method, target, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Datetime-Format': 'UNIX',
        },
        body: body || null,
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(r.body || '{}');
    }

    sendJson(res, 404, { error: 'unknown oanda endpoint' });
  }

  return { prefix: '/api/oanda/', handle: handleOanda };
};
