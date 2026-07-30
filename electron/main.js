// Electron wrapper + multi-window manager for detachable/dockable chart tabs.
//
// Every window is a full app (a renderer pointed at the forked server). Main is the single
// source of truth for which window holds which tab: windows.get(id).tabIds is an ordered
// list, and a tab id lives in exactly ONE window's list — never two. Dragging a tab and
// dropping it elsewhere MOVES it (removed from the source, added to the target / a new
// window). Nothing is cloned.
//
// The app logic lives in the renderer/server — main only owns window<->tab assignment.
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
// crash / diagnostics instrumentation lives in ./diag.js — required FIRST so its handlers + boot
// line register before anything else runs; setOrigin() is called below once ORIGIN is known.
const { setOrigin, log, milestone } = require('./diag');
// AI-workspace PTY sessions (node-pty shells + their IPC) live in ./pty.js; killAllPtys runs on quit.
const { killAllPtys } = require('./pty');

// Name the MAIN process 'plaincharts' in the OS process list (dev run shows the stock 'electron' binary name
// otherwise). Child/renderer processes are spawned by Chromium from the electron binary, so in a DEV run they
// still read 'electron'; a PACKAGED build renames the executable (build.linux.executableName), which every
// helper then inherits -- that's the real "shows up as plaincharts everywhere" fix.
try {
  process.title = 'plaincharts';
} catch (_) {}

// Portability: keep ALL Chromium/browser state (localStorage, cookies, HTTP cache, GPUCache) INSIDE the
// app folder -- a `userdata/` sibling of settings/ and data/ -- instead of the OS default
// (~/.config/Plain Charts). Runs before app is ready, in dev (`electron .`) and packaged alike, so nothing
// the app persists ever escapes its own tree. This is what makes the whole app portable.
try {
  app.setPath('userData', path.join(__dirname, '..', 'userdata'));
} catch (_) {}

const PORT = process.env.PORT || 8011;
const ORIGIN = `http://127.0.0.1:${PORT}/`;
setOrigin(ORIGIN); // diag logs window URLs short from here on
const PRELOAD = path.join(__dirname, 'preload.js');
const APP_ICON = path.join(__dirname, '..', 'icon.png'); // taskbar/dock icon for the visible windows (dev + packaged Linux)

let server = null;
let winSeq = 0;
const windows = new Map(); // winId -> { bw, tabIds: [] }  (VISIBLE UI windows only)
let dataHost = null; // hidden window that owns the shared broker socket(s)
let quitting = false; // app is exiting — snapshot once, don't let per-window closes empty it
let ticketState = null; // persisted Order-window PLACEMENT {bounds,alwaysOnTop} — remembers where/how it was left. NOT open/closed: the window never auto-reopens; you spawn it from the chart (so it gets the symbol) and it appears where you left it.
let drag = null; // { fromId, tabId } during a tab drag
let preview = null; // frameless thumbnail window that follows the cursor
const PREV_DX = 14,
  PREV_DY = 12;

// ---- desktop persistence ----
// desktop.json records the ARRANGEMENT (which windows, where on which monitor, holding which
// tabs, which active) — tab CONTENT stays in tabs.json. Main owns this file.
const DESKTOP_FILE = path.join(__dirname, '..', 'settings', 'workspace', 'desktop.json');
const TABS_FILE = path.join(__dirname, '..', 'settings', 'workspace', 'tabs.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings', 'settings.json');
const readJson = (f, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return dflt;
  }
};

// ---- remote debugging port ----
// A Chrome DevTools Protocol endpoint on 9222 so tooling (and Claude) can attach a debugger,
// read the console, and drive the renderer without the app being focused. ON BY DEFAULT IN DEV
// (unpackaged); OFF by default in a packaged build. The Development ▸ Debug toggle overrides
// this (settings.debugPort: true/false); it applies on the next launch (the switch must be set
// before app-ready). Must run before app.whenReady().
const DEV = !app.isPackaged;
const DEBUG_PORT = 9222;
const debugPortSetting = readJson(SETTINGS_FILE, {}).debugPort;
const DEBUG_ON = debugPortSetting != null ? !!debugPortSetting : DEV;
if (DEBUG_ON) app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
// Keep EVERY window fully live regardless of focus/occlusion -- a multi-monitor trading setup watches
// several at once and none should lag or deprioritize when it isn't the focused window. Complements the
// per-window backgroundThrottling:false (which stops a renderer throttling its OWN rAF/timers) at the
// process-priority + occlusion level. Must be set before app-ready.
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // don't lower background renderers' process priority
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); // an occluded/overlapped window isn't treated as background
app.commandLine.appendSwitch('disable-background-timer-throttling'); // no timer throttling in background pages (belt-and-suspenders)
const readDesktop = () => {
  const d = readJson(DESKTOP_FILE, {});
  return {
    autoRestore: d.autoRestore !== false,
    windows: Array.isArray(d.windows) ? d.windows : [],
    orderTicket: d.orderTicket || null,
  };
};
const allTabIds = () => {
  const t = readJson(TABS_FILE, {});
  return (Array.isArray(t.tabs) ? t.tabs : []).map((x) => x && x.id).filter(Boolean);
};

let saveTimer = null;
function snapshot() {
  const wins = [];
  for (const r of windows.values()) {
    if (!r.bw || r.bw.isDestroyed()) continue;
    wins.push({ bounds: r.bw.getBounds(), tabIds: [...r.tabIds], activeId: r.activeId || r.tabIds[0] || null });
  }
  return wins;
}
function writeDesktop(autoRestore, wins) {
  try {
    fs.mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
    fs.writeFileSync(DESKTOP_FILE, JSON.stringify({ autoRestore, windows: wins, orderTicket: ticketState }, null, 2));
  } catch (_) {}
}
function saveDesktop() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDesktopNow, 400);
}
// write the full arrangement immediately (no debounce) — used on quit so the layout of
// EVERY currently-open window is captured before any of them start closing.
function saveDesktopNow() {
  clearTimeout(saveTimer);
  const cur = readDesktop();
  if (!cur.autoRestore) return; // off: don't clobber the saved arrangement (keep it for re-enable)
  const wins = snapshot();
  if (!wins.length) return; // never overwrite a good arrangement with an empty set -- the last window
  writeDesktop(true, wins); // closing/quitting would otherwise erase the session down to blank
}
function setAutoRestore(on) {
  writeDesktop(!!on, readDesktop().windows);
}

// keep a restored window on a real display (a monitor may have been unplugged / moved)
function clampBounds(b) {
  if (!b || b.width == null) return null;
  try {
    const wa = screen.getDisplayMatching(b).workArea;
    let { x, y, width, height } = b;
    width = Math.min(width, wa.width);
    height = Math.min(height, wa.height);
    if (x + width <= wa.x + 40 || x >= wa.x + wa.width - 40) x = wa.x + Math.max(0, ((wa.width - width) / 2) | 0);
    if (y + height <= wa.y + 40 || y >= wa.y + wa.height - 40) y = wa.y + Math.max(0, ((wa.height - height) / 2) | 0);
    return { x: Math.round(x), y: Math.round(y), width, height };
  } catch (_) {
    return b;
  }
}

function startServer() {
  server = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
  server.on('exit', (code) => {
    if (code) console.error('[plain-charts] server exited with code', code);
  });
}

function waitForServer(cb, tries = 0) {
  const req = http.get(ORIGIN, () => {
    req.destroy();
    cb();
  });
  req.on('error', () => {
    if (tries > 100) return cb(new Error('server did not start'));
    setTimeout(() => waitForServer(cb, tries + 1), 100);
  });
}

// claimAll: first window — the renderer reports the full tab set it loaded.
// tabIds: an explicit list for a torn-off / restored window. bounds: restore position+size.
// primary: this window owns the "create a default tab if emptied" safety. activeId: restore.
function createAppWindow({ tabIds = null, claimAll = false, x, y, bounds, activeId = null, primary = false } = {}) {
  const id = 'w' + ++winSeq;
  const opts = {
    width: 1480,
    height: 920,
    x,
    y,
    backgroundColor: '#111317',
    icon: APP_ICON,
    frame: false, // no OS title bar — the tab strip is the title bar (drag + controls)
    autoHideMenuBar: true,
    // backgroundThrottling:false -- an UNFOCUSED chart window must keep painting at full frame rate (a
    // multi-monitor trading setup watches several at once); Chromium otherwise throttles background windows'
    // timers/rAF. Matches the data host + addon host, which already disable throttling.
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  };
  const cb = clampBounds(bounds);
  if (cb) {
    opts.x = cb.x;
    opts.y = cb.y;
    opts.width = cb.width;
    opts.height = cb.height;
  }
  const bw = new BrowserWindow(opts);
  windows.set(id, { bw, tabIds: tabIds ? [...tabIds] : [], activeId });

  const parts = [claimAll ? 'claim=all' : 'tabs=' + encodeURIComponent((tabIds || []).join(','))];
  if (primary) parts.push('primary=1');
  if (activeId) parts.push('active=' + encodeURIComponent(activeId));
  bw.loadURL(`${ORIGIN}?win=${id}&${parts.join('&')}`);
  bw.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  bw.on('move', saveDesktop);
  bw.on('resize', saveDesktop);
  bw.on('maximize', () => {
    try {
      bw.webContents.send('win-max', true);
    } catch (_) {}
  });
  bw.on('unmaximize', () => {
    try {
      bw.webContents.send('win-max', false);
    } catch (_) {}
  });
  // Closing a window closes the tabs inside it. If OTHER windows remain, X prunes this window's tabs
  // from the index so they don't reappear next launch (workspaces persist -> reopen from the manager).
  // The LAST visible window's X behaves like Quit: the maintained desktop.json already holds it, and the
  // empty-set guard in saveDesktopNow keeps the shutdown from erasing it -- so the next launch reopens
  // this window + its tabs instead of starting blank. While quitting (Exit / Cmd-Q), before-quit already
  // saved the FULL layout -- stay quiet.
  bw.on('closed', () => {
    const closing = windows.get(id);
    windows.delete(id);
    if (quitting) return;
    if (windows.size === 0) {
      app.quit();
      return;
    } // last visible window == Quit, session preserved
    if (closing) pruneClosedTabs(closing.tabIds); // another window remains: this window's tabs close
    saveDesktop();
  });
  return id;
}

const recFor = (sender) => {
  for (const r of windows.values()) if (r.bw.webContents === sender) return r;
  return null;
};
const idFor = (sender) => {
  for (const [k, r] of windows) if (r.bw.webContents === sender) return k;
  return null;
};
function sendTabs(winId) {
  const r = windows.get(winId);
  if (r) {
    try {
      r.bw.webContents.send('win-tabs', r.tabIds);
    } catch (_) {}
  }
}

// which window's frame contains a screen point (topmost-ish: last match wins via focus order)
function windowAt(x, y) {
  let hit = null;
  for (const [k, r] of windows) {
    if (r.bw.isMinimized() || !r.bw.isVisible()) continue;
    const b = r.bw.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hit = k;
  }
  return hit;
}

function removeTab(winId, tabId) {
  const r = windows.get(winId);
  if (r) r.tabIds = r.tabIds.filter((t) => t !== tabId);
}

// Closing a window closes the tabs inside it: drop them from the tab index via the server -- the SAME
// path a tab's own X uses (index entry only; the workspace file stays, so it reopens from the manager).
// Skip any tab a surviving window still holds (a tab dragged out to another window).
function removeTabRemote(tabId) {
  try {
    const body = JSON.stringify({ id: tabId });
    const req = http.request(`${ORIGIN}api/tabs/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('error', () => {});
    req.end(body);
  } catch (_) {}
}
function pruneClosedTabs(tabIds) {
  if (!Array.isArray(tabIds) || !tabIds.length) return;
  const held = new Set();
  for (const r of windows.values()) for (const t of r.tabIds || []) held.add(t); // still open elsewhere
  for (const t of tabIds) if (t && !held.has(t)) removeTabRemote(t);
}

ipcMain.on('tabs-claim', (e, { tabIds }) => {
  const r = recFor(e.sender);
  if (r) {
    r.tabIds = Array.isArray(tabIds) ? [...tabIds] : [];
    saveDesktop();
  }
});
ipcMain.on('tabs-add', (e, { tabId }) => {
  const r = recFor(e.sender);
  if (r && tabId && !r.tabIds.includes(tabId)) {
    r.tabIds.push(tabId);
    saveDesktop();
  }
});
ipcMain.on('tabs-remove', (e, { tabId }) => {
  const id = idFor(e.sender);
  if (!id) return;
  removeTab(id, tabId);
  const r = windows.get(id);
  if (r && r.tabIds.length === 0 && windows.size > 1)
    r.bw.close(); // emptied detached window closes
  else saveDesktop();
});
ipcMain.on('tab-active', (e, { tabId } = {}) => {
  const r = recFor(e.sender);
  if (r) {
    r.activeId = tabId;
    saveDesktop();
  }
});
ipcMain.on('set-autorestore', (_e, { on } = {}) => setAutoRestore(on));

// custom title-bar window controls (windows are frameless)
ipcMain.on('win-minimize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.minimize();
});
ipcMain.on('win-maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('win-close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.close();
});
ipcMain.on('win-always-on-top-toggle', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const on = w ? !w.isAlwaysOnTop() : false;
  if (w) w.setAlwaysOnTop(on);
  if (w && w === ticketWin && ticketState) {
    ticketState.alwaysOnTop = on;
    saveDesktop();
  }
  e.returnValue = on;
});
ipcMain.on('win-always-on-top-get', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  e.returnValue = !!(w && w.isAlwaysOnTop());
});
// Quit the WHOLE app (TV-style "Exit"), preserving the current desktop layout across all
// monitors. before-quit captures the full snapshot once; the closed handlers stay quiet.
ipcMain.on('app-quit', () => app.quit());
// New empty window the user can organize (drag tabs in, add charts). It opens with no tabs;
// the renderer seeds a single blank tab. Cascade it off the focused window so it isn't hidden.
ipcMain.on('new-window', () => {
  const base = BrowserWindow.getFocusedWindow();
  const b = base ? base.getBounds() : null;
  createAppWindow({ tabIds: [], x: b ? b.x + 40 : undefined, y: b ? b.y + 40 : undefined });
});

// The order-ticket window: its OWN small OS window (not an in-window dialog) so it floats free over a docked/
// thin Trade Desk. A PROXY window (has the preload) that will drive orders through the data-host broker. One
// instance -- reopen focuses the existing one.
let ticketWin = null;
let ticketPayload = {}; // last open intent { tab?, position? }; re-delivered on every (re)load so it is never lost
// Open (or focus) the Order window. It has a FIXED size (TICKET_W x TICKET_H, non-resizable) and REMEMBERS only its
// position + always-on-top across sessions (ticketState, persisted in desktop.json): every open reuses the saved x/y,
// so the dialog reappears where the user left it; dragging / pinning it persists the new placement. It does NOT
// auto-reopen on launch -- you spawn it from the chart (toolbar / on-chart dot), so it always lands with the right symbol.
function openTicket(payload) {
  ticketPayload = payload || {}; // which tab to show + optional position context (e.g. double-click a row -> Modify)
  if (ticketWin && !ticketWin.isDestroyed()) {
    try {
      ticketWin.show();
      ticketWin.focus();
      ticketWin.webContents.send('order-ticket-open', ticketPayload);
    } catch (_) {}
    return;
  }
  const rb =
    ticketState && ticketState.bounds
      ? clampBounds({ ...ticketState.bounds, width: TICKET_W, height: TICKET_H })
      : null; // remembered position only; size is fixed
  const aot = !!(ticketState && ticketState.alwaysOnTop);
  const base = BrowserWindow.getFocusedWindow();
  const b = base ? base.getBounds() : null;
  ticketWin = new BrowserWindow({
    width: TICKET_W,
    height: TICKET_H,
    minWidth: TICKET_W,
    minHeight: TICKET_H,
    maxWidth: TICKET_W,
    maxHeight: TICKET_H,
    resizable: false,
    title: 'Order', // FIXED size -- the layout is anchored, so the window never resizes
    icon: APP_ICON,
    x: rb ? rb.x : b ? b.x + 60 : undefined,
    y: rb ? rb.y : b ? b.y + 60 : undefined,
    alwaysOnTop: aot,
    frame: false,
    autoHideMenuBar: true, // no OS title bar / menu -- custom title bar like the main app
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  ticketWin.loadURL(`${ORIGIN}order-ticket.html?role=ticket&win=wTicket`);
  // persist position/size/on-top whenever the user moves or resizes the window
  const remember = () => {
    try {
      if (ticketWin && !ticketWin.isDestroyed()) {
        ticketState = { bounds: ticketWin.getBounds(), alwaysOnTop: ticketWin.isAlwaysOnTop() };
        saveDesktop();
      }
    } catch (_) {}
  };
  ticketWin.on('move', remember);
  ticketWin.on('resize', remember);
  // Re-deliver the open intent on EVERY finished (re)load, not once. did-finish-load fires only after the module
  // (and its heavier imports) fully executed, so the renderer's onOrderTicketOpen listener is guaranteed wired --
  // a Modify sent while the window was mid-reload lands on the next finish instead of being dropped.
  ticketWin.webContents.on('did-finish-load', () => {
    try {
      ticketWin.webContents.send('order-ticket-open', ticketPayload);
    } catch (_) {}
  });
  ticketWin.on('closed', () => {
    ticketWin = null;
    saveDesktop();
  }); // persist the final placement; never re-open automatically
  try {
    ticketState = { bounds: ticketWin.getBounds(), alwaysOnTop: aot };
  } catch (_) {
    ticketState = { bounds: rb, alwaysOnTop: aot };
  }
  saveDesktop();
}
ipcMain.on('open-order-ticket', (_e, opts) => openTicket(opts));
// The ticket window calls this AFTER attaching its listener -> we reply with the stored intent. Renderer-pull
// (not main-push) is what makes fresh-window opening reliable: no way to send before the listener exists.
ipcMain.on('order-ticket-ready', (e) => {
  try {
    e.sender.send('order-ticket-open', ticketPayload);
  } catch (_) {}
});
// The Order window is FIXED size and non-resizable (see openTicket). The renderer still measures its quick-button row
// and sends 'order-ticket-width', but we no longer resize to it -- the window stays at TICKET_W; long quick-button
// labels ellipsis within the 3-column grid instead of growing the window.
const TICKET_W = 400,
  TICKET_H = 580; // fixed Order-window content-agnostic frame size
ipcMain.on('order-ticket-width', () => {
  /* no-op: the Order window is fixed-size */
});

function destroyPreview() {
  if (preview) {
    try {
      preview.destroy();
    } catch (_) {}
    preview = null;
  }
}
function movePreview(x, y) {
  if (preview && x != null && y != null) {
    try {
      preview.setPosition(Math.round(x + PREV_DX), Math.round(y + PREV_DY));
    } catch (_) {}
  }
}

ipcMain.on('devtools', (e, { on } = {}) => {
  const apply = (bw) => {
    if (!bw) return;
    try {
      on ? bw.webContents.openDevTools({ mode: 'detach' }) : bw.webContents.closeDevTools();
    } catch (_) {}
  };
  apply(BrowserWindow.fromWebContents(e.sender)); // this window
  apply(dataHost); // + the hidden data host (where the broker runs)
});
// current remote-debugging-port state, for the Development tab (sync so the checkbox renders right)
ipcMain.on('debug-info', (e) => {
  e.returnValue = { port: DEBUG_PORT, active: DEBUG_ON, dev: DEV };
});

ipcMain.on('tab-drag-start', async (e, { tabId, x, y } = {}) => {
  drag = { fromId: idFor(e.sender), tabId };
  destroyPreview();
  const src = recFor(e.sender);
  if (!src) return;
  try {
    const img = await src.bw.webContents.capturePage();
    const thumb = img.resize({ width: 320 });
    const s = thumb.getSize();
    preview = new BrowserWindow({
      width: s.width,
      height: s.height,
      x: Math.round((x || 0) + PREV_DX),
      y: Math.round((y || 0) + PREV_DY),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false },
    });
    preview.setIgnoreMouseEvents(true);
    // setOpacity is unsupported on Linux, so fade the thumbnail via CSS (window is transparent)
    const html =
      '<body style="margin:0;overflow:hidden;background:transparent"><img src="' +
      thumb.toDataURL() +
      '" style="width:100%;display:block;border-radius:8px;opacity:.8"></body>';
    await preview.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    if (preview) preview.showInactive(); // visible but never steals focus
  } catch (_) {
    destroyPreview();
  }
});

ipcMain.on('tab-drag-move', (_e, { x, y } = {}) => movePreview(x, y));

ipcMain.on('tab-drag-end', (e, { x, y } = {}) => {
  destroyPreview();
  const d = drag;
  drag = null;
  if (!d || !d.tabId || x == null || y == null) return;
  const from = windows.get(d.fromId);
  const targetId = windowAt(x, y);

  if (targetId && targetId !== d.fromId) {
    // dock into another window
    removeTab(d.fromId, d.tabId);
    const t = windows.get(targetId);
    if (!t.tabIds.includes(d.tabId)) t.tabIds.push(d.tabId);
    sendTabs(d.fromId);
    sendTabs(targetId);
    if (from && from.tabIds.length === 0)
      from.bw.close(); // emptied source window closes
    else
      try {
        t.bw.focus();
      } catch (_) {}
  } else if (!targetId) {
    // dropped on empty space → tear off into a new window (unless it's the only tab)
    if (from && from.tabIds.length > 1) {
      removeTab(d.fromId, d.tabId);
      sendTabs(d.fromId);
      createAppWindow({ tabIds: [d.tabId], x: Math.round(x - 90), y: Math.round(y - 14) });
    }
  }
  // dropped back on the same window → no-op (kept where it was)
  saveDesktop();
});

// the hidden, always-on data host: owns the shared broker socket(s), independent of any UI
// window. Created once at startup; lives until the app quits.
function createDataHost() {
  dataHost = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  dataHost.loadURL(`${ORIGIN}data-host.html?role=data&win=wData`);
  dataHost.on('closed', () => {
    dataHost = null;
  });
}

// the hidden addon host: a Node-ENABLED renderer that joins the data bridge as a proxy
// consumer, so addons get full broker DATA (existing bridge) AND full Node (require) with no
// new plumbing. It loads/runs addons from the addons/ folder directly off disk. Additive —
// if an addon crashes here, the data host (and the app's data) are untouched.
let addonHostWin = null;
function createAddonHost() {
  addonHostWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const root = encodeURIComponent(path.join(__dirname, '..'));
  addonHostWin.loadURL(`${ORIGIN}addon-host.html?role=addon&win=wAddon&root=${root}`);
  addonHostWin.on('closed', () => {
    addonHostWin = null;
  });
}

// the hidden ORDER HOST: the Order Worker. A proxy consumer (role=orders) that owns all order business
// logic, reads the book, and forwards low-level order verbs to the data host. Kept separate from the data
// host so a fault is always one or the other. Additive; never shown.
let orderHostWin = null;
function createOrderHost() {
  orderHostWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  orderHostWin.loadURL(`${ORIGIN}order-host.html?role=orders&win=wOrders`);
  orderHostWin.on('closed', () => {
    orderHostWin = null;
  });
}

// the hidden ALERT HOST: the Alert engine (app-layer). A proxy consumer (role=alerts) that owns all alert
// business logic — evaluation, firing, actions — and reads market data through the engine's public facade.
// Gets the desktop PRELOAD so DESKTOP=true -> ROLE proxy, so the sealed data_engine needs no edit. Kept
// separate from the data/order hosts so an alert fault is isolated. Additive; never shown.
let alertHostWin = null;
function createAlertHost() {
  alertHostWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  alertHostWin.loadURL(`${ORIGIN}alert-host.html?role=alerts&win=wAlerts`);
  alertHostWin.on('closed', () => {
    alertHostWin = null;
  });
}

// Recreate the saved desktop (windows, positions, tab distribution) when auto-restore is on;
// otherwise one window that claims every tab. Tabs in tabs.json not placed in any saved window
// are dropped into the first window so nothing is lost.
function bootWindows() {
  const d = readDesktop();
  ticketState = d.orderTicket || null; // restore the remembered Order-window PLACEMENT (position/size/on-top) for when it's next spawned
  const saved = d.autoRestore ? d.windows.filter((w) => w && Array.isArray(w.tabIds) && w.tabIds.length) : [];
  if (!saved.length) {
    createAppWindow({ claimAll: true });
  } else {
    const placed = new Set(saved.flatMap((w) => w.tabIds));
    const leftover = allTabIds().filter((tid) => !placed.has(tid));
    saved.forEach((w, i) => {
      createAppWindow({
        tabIds: i === 0 ? [...w.tabIds, ...leftover] : w.tabIds,
        bounds: w.bounds,
        activeId: w.activeId,
        primary: i === 0,
      });
    });
  }
  // NOTE: the Order window is NOT auto-reopened -- it's spawned from a chart so it lands with a symbol (see openTicket)
}

// Single-instance lock: a second launch forks a RIVAL server + hosts that fight the first over the broker
// ports -- the MT5 bridge 7892 EADDRINUSE dance we hit repeatedly (a stale data-host squatting the port),
// plus duplicate data/order/addon hosts. Only one app process is valid. A second launch hands focus to the
// running one and exits, so the port is never double-bound.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
}

app.whenReady().then(() => {
  milestone('app-ready');
  startServer();
  milestone('server-forked');
  waitForServer((err) => {
    if (err) {
      log('error', 'lifecycle', 'server-did-not-start', err.message);
      console.error('[plain-charts]', err.message);
    } else milestone('server-up');
    createDataHost();
    createAddonHost();
    createOrderHost();
    createAlertHost();
    milestone('hosts-created');
    bootWindows();
    milestone('windows-booted');
  });
  app.on('activate', () => {
    if (!windows.size) createAppWindow({ claimAll: true });
  });
});

app.on('window-all-closed', () => app.quit());
// Any quit path (Exit app button, Cmd-Q, menu) snapshots the full layout ONCE, up front,
// then flips `quitting` so the cascade of window closes can't whittle it down to empty.
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  saveDesktopNow();
});
app.on('quit', () => {
  if (server) {
    try {
      server.kill();
    } catch (_) {}
  }
  killAllPtys();
});
