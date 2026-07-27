// @ts-check
// The MCP server -- the run-time face of "expose the app to AI". Runs inside the node-integrated addon-host
// renderer, pulling the CJS MCP SDK + Node http/crypto through win.require (the same idiom runtime.js uses for
// fs). It stands up a Streamable-HTTP endpoint bound to 127.0.0.1 and registers each gated-surface operation
// as an MCP tool. The surface (surface.js) enforces the Assistant permission policy; a denied call is turned
// into an MCP error result, so an external client (Claude Code / Cursor) sees a clean "not permitted".
//
// Localhost only, by design: this endpoint can place orders when the Execution permission is on, so it must
// never be network-reachable. Reads and data never leave the machine.
import { surface } from './surface.js';
import { isAssistantServerEnabled } from '../settings/assistant-policy.js';
import { loadSettings } from '../settings/settings.js';

const win = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
const req = (win && win.require) ? win.require : null;

const PORT = 8788;   // 127.0.0.1:8788/mcp
/** @type {any} */
let httpServerRef = null;   // the running http.Server, or null when stopped

// Write a status blob to settings/assistant-status.json so the server's state (and any startup error) is
// observable from outside this headless renderer -- the addon-host has no visible console.
/** @param {Record<string, any>} obj */
function writeStatus(obj) {
  try {
    const fs = req('fs'), path = req('path');
    const ROOT = decodeURIComponent(new URLSearchParams(location.search).get('root') || '');
    if (!ROOT) return;
    fs.writeFileSync(path.join(ROOT, 'settings', 'assistant-status.json'), JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj)));
  } catch (_) {}
}

// Register every tool on a fresh McpServer (one per MCP session). Each tool wraps a gated-surface call:
// success -> a JSON text result; AssistantDenied (or any throw) -> an isError result.
/** @param {any} McpServer @param {any} z */
function buildServer(McpServer, z) {
  const server = new McpServer({ name: 'plain-charts', version: '0.1.0' });
  const ok = (/** @type {any} */ data) => ({ content: [{ type: 'text', text: JSON.stringify(data === undefined ? { ok: true } : data, null, 2) }] });
  const fail = (/** @type {any} */ e) => ({ isError: true, content: [{ type: 'text', text: String((e && e.message) || e) }] });
  /** @param {(a:any)=>Promise<any>} fn */
  const wrap = (fn) => async (/** @type {any} */ a) => { try { return ok(await fn(a || {})); } catch (e) { return fail(e); } };
  /** @param {string} name @param {string} description @param {any} shape @param {(a:any)=>Promise<any>} fn */
  const tool = (name, description, shape, fn) => server.registerTool(name, shape ? { description, inputSchema: shape } : { description }, wrap(fn));

  // ---- read.account ----
  tool('get_positions', 'Open positions across connected brokers.', null, () => surface.positions());
  tool('get_orders', 'Orders (all statuses) across connected brokers.', null, () => surface.orders());
  tool('get_fills', 'Recent fills.', null, () => surface.fills());
  tool('get_accounts', 'Account balances and equity.', null, () => surface.accounts());
  tool('list_connections', 'Broker and data-feed connections with their status.', null, () => surface.connections());
  // ---- read.diagnostics ----
  tool('get_logs', 'Recent console / diagnostic log lines.', { limit: z.number().int().positive().optional() }, (a) => surface.logs(a.limit));
  // ---- read.market ----
  tool('resolve_symbol', 'Resolve a symbol to its instrument (id, tick size, price decimals) via the active broker.', { symbol: z.string() }, (a) => surface.resolveSymbol(a.symbol));
  tool('get_bars', 'Historical OHLCV bars from the active broker. tf like 1m, 5m, 1h, D. count = number of recent bars (default 300), or pass fromMs/toMs (unix ms).', { symbol: z.string(), tf: z.string(), count: z.number().int().positive().optional(), fromMs: z.number().optional(), toMs: z.number().optional() }, (a) => surface.bars(a));
  // ---- read.workspace ----
  tool('list_tabs', 'Open tabs and which is active; each tab references a workspace (wsId).', null, () => surface.tabs());
  tool('get_workspace', 'A workspace\'s panes -- symbol, timeframe, broker, and loaded studies. Defaults to the active tab.', { wsId: z.string().optional() }, (a) => surface.workspace(a.wsId));
  tool('get_selection', 'What the user is currently looking at on the active chart: symbol, timeframe, visible range, the last bar (current price), and any drawings they have selected (with points). The chart equivalent of a highlighted text selection. Needs a chart active (works best with the AI Workspace on its own window).', null, () => surface.getSelection());
  // ---- author.studies ----
  tool('list_studies', 'The user study module files that exist.', null, () => surface.listStudies());
  tool('get_study', 'Read a study module\'s source code by name (without the .js).', { name: z.string() }, (a) => surface.getStudy(a.name));
  tool('write_study', 'Create or replace a study module -- a plain-JS `Studies.register({ id, name, overlay, inputs, calc })` file (no imports; `Studies` is a global). It loads on the charts immediately. `name` is the file name without .js.', { name: z.string(), code: z.string() }, (a) => surface.writeStudy(a.name, a.code));
  // ---- author.workspace (live pane mutations; needs a chart open) ----
  tool('add_study', 'Add a study to a chart pane. studyId is the study\'s registered id (from get_workspace or the id in write_study). paneIndex from get_workspace (defaults to the active pane).', { paneIndex: z.number().int().nonnegative().optional(), studyId: z.string(), params: z.object({}).passthrough().optional() }, (a) => surface.addStudy(a));
  tool('set_symbol', 'Change a chart pane\'s symbol. paneIndex defaults to the active pane.', { paneIndex: z.number().int().nonnegative().optional(), symbol: z.string(), broker: z.string().optional() }, (a) => surface.setSymbol(a));
  tool('set_timeframe', 'Change a chart pane\'s timeframe (e.g. 5m, 1h, D). paneIndex defaults to the active pane.', { paneIndex: z.number().int().nonnegative().optional(), tf: z.string() }, (a) => surface.setTimeframe(a));
  // ---- author.alerts ----
  tool('add_alert', 'Add a price alert at a level on a chart pane (fires when price reaches it), on the pane\'s symbol. paneIndex defaults to the active pane.', { paneIndex: z.number().int().nonnegative().optional(), price: z.number() }, (a) => surface.addAlert(a));
  // ---- author.drawings ----
  tool('add_drawing', 'Add a drawing to a chart pane. tool: hline / hray (1 point), arrow / trendline (2 points), rect (2 points -- opposite corners of a box, style.fillOn + style.fill for a shaded zone), fib (2 points), path (2+ points), vline (1 point). points: array of { time (unix seconds), price }. Optional style { color, width, lineStyle, fillOn, fill }. paneIndex defaults to the active pane.', { paneIndex: z.number().int().nonnegative().optional(), tool: z.string(), points: z.array(z.object({ time: z.number(), price: z.number() })), style: z.object({}).passthrough().optional() }, (a) => surface.addDrawing(a));
  tool('list_drawings', 'The drawings on the active chart pane -- each id, tool, and points. Use with remove_drawing.', null, () => surface.listDrawings());
  tool('remove_drawing', 'Remove a drawing from the active chart pane by id (from list_drawings or add_drawing).', { id: z.string() }, (a) => surface.removeDrawing(a.id));
  // ---- author.appearance ----
  tool('list_themes', 'Available app themes.', null, () => surface.listThemes());
  tool('apply_theme', 'Apply an app theme by name (see list_themes).', { name: z.string() }, (a) => surface.applyTheme(a.name));
  // ---- control.addons ----
  tool('list_addons', 'Installed addons with their enabled / running status. Requires the Control permission.', null, () => surface.listAddons());
  tool('enable_addon', 'Enable or disable an addon by id. Requires the Control permission.', { id: z.string(), enabled: z.boolean() }, (a) => surface.enableAddon(a.id, a.enabled));
  tool('reload_addon', 'Reload (restart) an addon by id. Requires the Control permission.', { id: z.string() }, (a) => surface.reloadAddon(a.id));
  // ---- execute.orders (gated; a backstop also enforces at the data-host order boundary) ----
  tool('place_order', 'Place an order. Requires the Execution permission.', { order: z.object({}).passthrough() }, (a) => surface.placeOrder(a.order));
  tool('modify_order', 'Modify an order. Requires the Execution permission.', { mod: z.object({}).passthrough() }, (a) => surface.modifyOrder(a.mod));
  tool('cancel_order', 'Cancel an order by id. Requires the Execution permission.', { orderId: z.string() }, (a) => surface.cancelOrder(a.orderId));
  tool('close_position', 'Flatten a position by symbol. Requires the Execution permission.', { symbol: z.string() }, (a) => surface.closePosition(a.symbol));
  // ---- control.connections ----
  tool('broker_connect', 'Connect a broker/feed account. Requires the Control permission.', { account: z.object({}).passthrough() }, (a) => surface.connect(a.account));
  tool('broker_disconnect', 'Disconnect a connection by id. Requires the Control permission.', { id: z.string() }, (a) => surface.disconnect(a.id));
  tool('broker_set_active', 'Make a connection the active one. Requires the Control permission.', { id: z.string() }, (a) => surface.setActive(a.id));

  return server;
}

export function startMcpServer() {
  if (!req) { console.warn('[mcp] no Node (win.require) -- MCP server not started'); return; }
  let http, crypto, McpServer, StreamableHTTPServerTransport, z;
  try {
    http = req('http');
    crypto = req('crypto');
    ({ McpServer } = req('@modelcontextprotocol/sdk/server/mcp.js'));
    ({ StreamableHTTPServerTransport } = req('@modelcontextprotocol/sdk/server/streamableHttp.js'));
    ({ z } = req('zod'));
  } catch (e) {
    console.error('[mcp] failed to load SDK', e);
    writeStatus({ running: false, error: 'SDK load: ' + String((e && /** @type {any} */ (e).stack) || e) });
    return;
  }

  /** @type {Record<string, any>} */
  const transports = {};   // mcp-session-id -> transport (one MCP server per session)
  const isInit = (/** @type {any} */ b) => b && b.method === 'initialize';

  /** @param {any} request @param {(body:any)=>void} cb */
  const readJson = (request, cb) => {
    let data = '';
    request.on('data', (/** @type {any} */ c) => { data += c; if (data.length > 4e6) request.destroy(); });
    request.on('end', () => { let body; try { body = data ? JSON.parse(data) : undefined; } catch (_) { body = undefined; } cb(body); });
    request.on('error', () => cb(undefined));
  };

  const httpServer = http.createServer((/** @type {any} */ request, /** @type {any} */ response) => {
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
              onsessioninitialized: (/** @type {string} */ id) => { transports[id] = transport; },
            });
            transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
            await buildServer(McpServer, z).connect(transport);
          }
          await transport.handleRequest(request, response, body);
        } catch (e) { console.error('[mcp] request error', e); try { response.statusCode = 500; response.end('mcp error'); } catch (_) {} }
      });
      return;
    }
    // GET (server-sent events stream) / DELETE (end session) reuse the session's transport
    const transport = sid && transports[sid];
    if (!transport) { response.statusCode = 400; response.end('Invalid or missing session id'); return; }
    transport.handleRequest(request, response).catch((/** @type {any} */ e) => console.error('[mcp] stream error', e));
  });

  httpServer.on('error', (/** @type {any} */ e) => { console.error('[mcp] http server error', e); writeStatus({ running: false, error: 'listen: ' + String((e && e.message) || e) }); });
  httpServer.listen(PORT, '127.0.0.1', () => { console.log('[mcp] Streamable HTTP on http://127.0.0.1:' + PORT + '/mcp'); writeStatus({ running: true, port: PORT }); });
  httpServerRef = httpServer;
}

export function stopMcpServer() {
  if (!httpServerRef) return;
  try { httpServerRef.close(); } catch (_) {}
  httpServerRef = null;
  console.log('[mcp] server stopped');
}

// Follow the master switch (Settings > App > Assistant > Enable assistant server): start within ~2s of it
// turning on, stop when it turns off. Polling also rides out the settings store loading after the addon-host
// boots. No-op where there's no Node (win.require).
if (req) {
  const tick = async () => {
    // The addon-host has no live settings feed, so re-fetch each poll -- this also keeps the capability
    // policy the gated surface reads current. Without it, getSetting() only ever returns the store defaults.
    try { await loadSettings(); } catch (e) { writeStatus({ running: !!httpServerRef, error: 'settings load: ' + String((e && /** @type {any} */ (e).message) || e) }); }
    const want = isAssistantServerEnabled();
    if (want && !httpServerRef) startMcpServer();
    else if (!want && httpServerRef) stopMcpServer();
  };
  tick();
  setInterval(tick, 2000);
}
