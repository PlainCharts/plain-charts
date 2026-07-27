// The MCP server -- the channel an agent (Claude) uses to drive this terminal's live engine: connect a
// broker, read the book, and send order commands to the order worker. Runs in-process (same engine the TUI
// monitors), Streamable-HTTP on 127.0.0.1. Mirrors the app's src/assistant/mcp-server.js transport wiring,
// but tools call data_engine directly (broker / platform stores / command()) instead of the app surface.
//
// The `command` tool is the point: it forwards a semantic order command to the order worker (booted in
// bootEngine), which owns all order business logic (OCO, reconcile, stop auto-size). No logic lives here.
// Localhost only -- this can place real orders once a broker is connected.

import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { record as recordStat, snapshot as statsSnapshot } from './stats.js';

const pickQuote = (q) => {
  const o = {};
  for (const k of ['bid', 'ask', 'last', 'bidSize', 'askSize', 'lastSize']) if (q[k] != null) o[k] = q[k];
  return o;
};

function matchAccount(accounts, q) {
  const lc = String(q).toLowerCase();
  return accounts.find((a) => (a.protocol || '').toLowerCase() === lc) || accounts.find((a) => (a.name || '').toLowerCase() === lc) || null;
}

function resolveSymbol(engine, sym) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    engine.broker.resolveSymbol(sym, (inst, err) => inst ? finish(resolve, inst) : finish(reject, new Error('symbol not resolved' + (err && err.status != null ? ' (status ' + err.status + ')' : ''))));
    setTimeout(() => finish(reject, new Error('resolveSymbol timeout')), 5000);
  });
}

async function quoteSnapshot(engine, sym) {
  const t0 = Date.now();
  const inst = await resolveSymbol(engine, sym);
  const rttMs = Date.now() - t0;
  return await new Promise((resolve) => {
    let snap = {};
    const cb = (q) => { snap = { ...snap, ...pickQuote(q) }; };
    engine.broker.subscribeQuotes(inst.id, cb);
    setTimeout(() => {
      try { engine.broker.unsubscribeQuotes(inst.id, cb); } catch (_) {}
      resolve({ symbol: sym, id: inst.id, priceDecimals: inst.priceDecimals, tickSize: inst.tickSize, rttMs, ...snap });
    }, 1200);
  });
}

/** @param {any} engine @param {any[]} accounts */
function buildServer(engine, accounts) {
  const server = new McpServer({ name: 'engine-terminal', version: '0.1.0' });
  const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data === undefined ? { ok: true } : data, null, 2) }] });
  const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String((e && e.message) || e) }] });
  const wrap = (fn) => async (a) => { try { return ok(await fn(a || {})); } catch (e) { return fail(e); } };
  const tool = (name, description, shape, fn) => server.registerTool(name, shape ? { description, inputSchema: shape } : { description }, wrap(fn));

  // ---- read: the book (what the human monitors, and the agent inspects) ----
  tool('connections', 'Broker connections and their status.', null, () => (engine.broker.connections ? engine.broker.connections() : []));
  tool('positions', 'Open positions (netted view), keyed broker:symbol.', null, () => engine.platform.positions.all());
  tool('position_lots', 'Individual position lots (hedging), keyed broker:ticket.', null, () => engine.platform.positionLots.all());
  tool('orders', 'Order book -- every order, working and terminal.', null, () => engine.platform.orders.all());
  tool('fills', 'Executions (cumulative fill per order).', null, () => engine.platform.fills.all());
  tool('accounts', 'Trading accounts -- balances and equity.', null, () => engine.platform.accounts.all());
  tool('logs', 'Recent engine console lines (the IN/OUT command stream), newest last.', { limit: z.number().int().positive().optional() }, (a) => {
    const c = engine.platform.console;
    const h = (c && typeof c.history === 'function') ? c.history() : [];
    return h.slice(-(a.limit || 50));
  });

  // ---- read: market data ----
  tool('resolve_symbol', 'Resolve a symbol to its instrument (id, tick size, price decimals) on the active broker.', { symbol: z.string() }, (a) => resolveSymbol(engine, a.symbol));
  tool('quote', 'Snapshot a live quote (bid/ask/last) for a symbol, with the resolve round-trip in ms. Subscribes briefly, then returns.', { symbol: z.string() }, (a) => quoteSnapshot(engine, a.symbol));

  // ---- control: connection ----
  tool('connect', 'Connect a broker by protocol id or saved-account name (e.g. "cqg"). Uses settings/brokers/accounts.json.', { broker: z.string() }, async (a) => {
    const acct = matchAccount(accounts, a.broker);
    if (!acct) throw new Error('no saved account matches "' + a.broker + '"');
    await engine.broker.connect(acct);
    return { connecting: acct.name, protocol: acct.protocol };
  });
  tool('disconnect', 'Disconnect a broker by id, or the active one if omitted.', { id: z.string().optional() }, (a) => { engine.broker.disconnect(a.id); return { disconnected: a.id || '(active)' }; });
  tool('clear', 'Clear the engine console (store + terminal display). Use after a task to reset the view.', null, () => { if (engine.platform.console.clear) engine.platform.console.clear(); return { cleared: true }; });

  // ---- execute: the order channel ----
  tool('command',
    'Send a semantic order command to the order worker, which owns all order logic (OCO, reconcile, stop auto-size). '
    + 'Pass the command object as `cmd`. Types: place (orderType market/limit/stop, side, qty, symbol, price, brackets), '
    + 'cancel (id), modifyOrder (id, price/qty/stopLoss/takeProfit), closePosition (symbol), closeLot (ticket, qty), '
    + 'cancelWorking (symbol), setStop/setTarget (ctx, price), script (a DSL string). Places REAL orders on the connected broker.',
    { cmd: z.object({ type: z.string() }).passthrough() },
    async (a) => {
      const cmd = a.cmd;
      const bk = cmd.broker || (cmd.ctx && cmd.ctx.broker) || 'engine';
      const t0 = Date.now();
      const r = await engine.command(cmd);
      const execMs = Date.now() - t0;   // send -> broker reply (order round-trip)
      recordStat(bk + ':' + cmd.type, execMs);
      return { execMs, ...(r && typeof r === 'object' ? r : { result: r }) };
    });

  tool('stats', 'Execution-speed stats: per broker:command round-trip latency in ms (n, last, avg, min, max).', null, () => statsSnapshot());

  return server;
}

/**
 * Start the MCP HTTP server. Returns { port, url, close }.
 * @param {any} engine @param {{ accounts?: any[], port?: number, host?: string }} [opts]
 */
export function startMcp(engine, opts = {}) {
  const port = opts.port || Number(process.env.MCP_PORT) || 8790;
  const host = opts.host || '127.0.0.1';
  const accounts = opts.accounts || [];
  const transports = {};   // mcp-session-id -> transport
  const isInit = (b) => b && b.method === 'initialize';

  const readJson = (request, cb) => {
    let data = '';
    request.on('data', (c) => { data += c; if (data.length > 4e6) request.destroy(); });
    request.on('end', () => { let body; try { body = data ? JSON.parse(data) : undefined; } catch (_) { body = undefined; } cb(body); });
    request.on('error', () => cb(undefined));
  };

  const httpServer = http.createServer((request, response) => {
    const url = String(request.url || '');
    if (!url.startsWith('/mcp')) { response.statusCode = 404; response.end('not found'); return; }
    const sid = request.headers['mcp-session-id'];
    if (request.method === 'POST') {
      readJson(request, async (body) => {
        try {
          let transport = sid && transports[sid];
          if (!transport) {
            if (!isInit(body)) { response.statusCode = 400; response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session' }, id: null })); return; }
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (id) => { transports[id] = transport; },
            });
            transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
            await buildServer(engine, accounts).connect(transport);
          }
          await transport.handleRequest(request, response, body);
        } catch (e) { try { response.statusCode = 500; response.end('mcp error'); } catch (_) {} }
      });
      return;
    }
    const transport = sid && transports[sid];
    if (!transport) { response.statusCode = 400; response.end('Invalid or missing session id'); return; }
    transport.handleRequest(request, response).catch(() => {});
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => resolve({ port, url: 'http://' + host + ':' + port + '/mcp', close: () => { try { httpServer.close(); } catch (_) {} } }));
  });
}
