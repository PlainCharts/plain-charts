// Command dispatcher for the engine terminal. Commands are async and write to the log through a ctx the
// App supplies: { engine, accounts, print(str|str[]), clear(), exit() }. `engine` is the engine public API
// (or null while booting); `accounts` are the saved broker accounts (settings/brokers/accounts.json).

const HELP = [
  'commands:',
  '  help                  this list',
  '  adapters              adapters registered in the engine',
  '  accounts              saved broker accounts (from settings/brokers)',
  '  connect <proto|name>  connect a broker (e.g. connect cqg)',
  '  disconnect [id]       disconnect a broker (default: active)',
  '  status                engine role + connections',
  '  quote <symbol>        stream a live quote (requires a connection)',
  '  quote stop [symbol]   stop one quote (or all)',
  '  clear                 clear the log',
  '  quit | exit           leave (or Ctrl-C)',
];

const now = () => Date.now();

function help(ctx) { ctx.print(HELP); }
function clear(ctx) { ctx.clear(); }
function quit(ctx) { ctx.exit(); }

function adapters(ctx) {
  if (!ctx.engine) return ctx.print('  engine not ready');
  const list = ctx.engine.listBrokers();
  ctx.print(list.length ? list.map((a) => '  ' + a.id + (a.name ? '   ' + a.name : '')) : ['  (none)']);
}

function accounts(ctx) {
  const list = ctx.accounts || [];
  if (!list.length) return ctx.print('  no saved accounts (settings/brokers/accounts.json)');
  ctx.print(list.map((a) => '  ' + String(a.name || '?').padEnd(16) + ' ' + (a.protocol || '?') + (a.autoConnect ? '   [autoConnect]' : '')));
}

function connectionsOf(engine) {
  try { return engine.broker.connections ? engine.broker.connections() : []; } catch { return []; }
}

function status(ctx) {
  if (!ctx.engine) return ctx.print('  booting...');
  const conns = connectionsOf(ctx.engine);
  ctx.print([
    '  role: solo (in-process)',
    '  adapters: ' + ctx.engine.listBrokers().length,
    '  connections: ' + (conns.length ? conns.map((c) => c.id + (c.connected ? '*' : '')).join(' ') : 'none'),
  ]);
}

// find a saved account by protocol id (single token, e.g. "cqg") or by full name (case-insensitive).
function matchAccount(list, q) {
  const lc = q.toLowerCase();
  return list.find((a) => (a.protocol || '').toLowerCase() === lc) || list.find((a) => (a.name || '').toLowerCase() === lc) || null;
}

async function connect(ctx, args) {
  if (!ctx.engine) return ctx.print('  engine not ready');
  const q = args.join(' ').trim();
  if (!q) return ctx.print('  usage: connect <protocol|name>   (e.g. connect cqg)');
  const acct = matchAccount(ctx.accounts || [], q);
  if (!acct) return ctx.print('  no saved account matches "' + q + '"   (try: accounts)');
  ctx.print('  connecting ' + acct.name + ' (' + acct.protocol + ')...');
  const t0 = now();
  try {
    await ctx.engine.broker.connect(acct);
    ctx.print('  connect() returned in ' + (now() - t0) + 'ms; logon resolves asynchronously (watch the status bar)');
  } catch (e) {
    ctx.print('  connect failed: ' + e.message);
  }
}

function disconnect(ctx, args) {
  if (!ctx.engine) return ctx.print('  engine not ready');
  const id = args[0];
  try { ctx.engine.broker.disconnect(id); ctx.print('  disconnected ' + (id || '(active)')); }
  catch (e) { ctx.print('  disconnect failed: ' + e.message); }
}

function quote(ctx, args) {
  if (!ctx.engine) return ctx.print('  engine not ready');
  if (args[0] === 'stop' || args[0] === 'off') {
    const sym = args[1];
    if (ctx.stopQuote) ctx.stopQuote(sym);
    return ctx.print(sym ? '  stopped ' + sym : '  stopped all quotes');
  }
  const sym = args[0];
  if (!sym) return ctx.print('  usage: quote <symbol>   |   quote stop [symbol]');
  if (!ctx.engine.broker.isConnected || !ctx.engine.broker.isConnected()) return ctx.print('  not connected -- run: connect <protocol>');
  ctx.print('  resolving ' + sym + '...');
  if (ctx.startQuote) ctx.startQuote(sym);
}

const COMMANDS = { help, adapters, accounts, connect, disconnect, status, quote, clear, quit, exit: quit };

/** @param {any} ctx @param {string} raw */
export async function dispatch(ctx, raw) {
  const parts = raw.trim().split(/\s+/);
  const name = parts[0] || '';
  if (!name) return;
  const fn = COMMANDS[name];
  if (!fn) return ctx.print("  unknown command: " + name + "   (try 'help')");
  try { await fn(ctx, parts.slice(1)); }
  catch (e) { ctx.print('  error: ' + e.message); }
}
