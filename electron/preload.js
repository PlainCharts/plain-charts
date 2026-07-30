// Bridge for detachable/dockable tabs. The main process is the single source of truth
// for which window holds which tab; the renderer just reports user actions and renders
// the tab-id list main pushes back. Absent in the browser build (feature-detected).
const { ipcRenderer, clipboard } = require('electron');

// Forward renderer-side crashes to MAIN so they land in logs/app.log even if the window then dies (preload
// runs before the app UI, so this catches early failures too). Best-effort; never throws.
try {
  window.addEventListener('error', (e) => {
    try {
      ipcRenderer.send('diag:renderer-error', {
        type: 'error',
        message: e.message,
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: e.error && e.error.stack,
      });
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    try {
      ipcRenderer.send('diag:renderer-error', {
        type: 'unhandledrejection',
        message: (r && (r.message || String(r))) || 'unhandledrejection',
        stack: r && r.stack,
      });
    } catch (_) {}
  });
} catch (_) {}

// contextIsolation is OFF everywhere (full Node in every window, no sandbox), so contextBridge is unavailable
// and unnecessary -- assign the bridge straight onto the shared window. Renderer reads window.desktop as before.
window.desktop = {
  isDesktop: true,
  // the primary window reports the full tab-id set it loaded (first boot)
  claim: (tabIds) => ipcRenderer.send('tabs-claim', { tabIds }),
  // a tab was created / destroyed in this window
  addTab: (tabId) => ipcRenderer.send('tabs-add', { tabId }),
  removeTab: (tabId) => ipcRenderer.send('tabs-remove', { tabId }),
  // tab drag (SCREEN coords): start shows a live chart-thumbnail preview window that
  // follows the cursor (main-owned, so it crosses window edges + monitors); move tracks
  // the cursor; end resolves the drop.
  dragStart: (tabId, pt) => ipcRenderer.send('tab-drag-start', { tabId, x: pt && pt.x, y: pt && pt.y }),
  dragMove: (pt) => ipcRenderer.send('tab-drag-move', pt),
  dragEnd: (pt) => ipcRenderer.send('tab-drag-end', pt),
  // main pushes this window its ordered tab-id list whenever it changes
  onTabs: (cb) => ipcRenderer.on('win-tabs', (_e, ids) => cb(ids)),
  // report which tab is active (for desktop restore) and flip auto-restore on startup
  setActive: (tabId) => ipcRenderer.send('tab-active', { tabId }),
  setAutoRestore: (on) => ipcRenderer.send('set-autorestore', { on }),
  // custom title-bar (frameless) window controls
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximizeToggle: () => ipcRenderer.send('win-maximize'),
  winClose: () => ipcRenderer.send('win-close'),
  winAlwaysOnTopToggle: () => ipcRenderer.sendSync('win-always-on-top-toggle'), // flips + returns the new state
  winIsAlwaysOnTop: () => ipcRenderer.sendSync('win-always-on-top-get'),
  appQuit: () => ipcRenderer.send('app-quit'), // quit the whole app, saving the desktop layout
  newWindow: () => ipcRenderer.send('new-window'), // open a fresh empty window to organize
  openOrderTicket: (opts) => ipcRenderer.send('open-order-ticket', opts || {}), // open the standalone order-ticket window (its own OS window); opts {tab, position}
  onOrderTicketOpen: (cb) => ipcRenderer.on('order-ticket-open', (_e, opts) => cb(opts)), // (ticket window) receive open/refocus payload {tab, position}
  orderTicketReady: () => ipcRenderer.send('order-ticket-ready'), // (ticket window) listener attached -> pull the pending open intent from main
  orderTicketWidth: (w) => ipcRenderer.send('order-ticket-width', w), // (ticket window) ask main to grow/shrink the window to fit the quick-button row
  onMaxChange: (cb) => ipcRenderer.on('win-max', (_e, v) => cb(v)),
  // open/close the DevTools console for this window + the hidden data host
  devtools: (on) => ipcRenderer.send('devtools', { on }),
  // current remote-debugging-port state { port, active, dev } (sync)
  debugInfo: () => ipcRenderer.sendSync('debug-info'),
  // clipboard (for the AI Workspace terminal copy/paste; xterm has selection but no clipboard wiring)
  clipboard: { read: () => clipboard.readText(), write: (/** @type {string} */ t) => clipboard.writeText(t) },
  // AI Workspace terminal: a real PTY per session (kept alive in main across tab switches / detach).
  // onData/onExit deliver { sessionId, data|code }; the surface filters by its own sessionId. Return an
  // unsubscribe.
  pty: {
    spawn: (sessionId, cols, rows) => ipcRenderer.send('pty-spawn', { sessionId, cols, rows }),
    write: (sessionId, data) => ipcRenderer.send('pty-write', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send('pty-resize', { sessionId, cols, rows }),
    kill: (sessionId) => ipcRenderer.send('pty-kill', { sessionId }),
    onData: (cb) => {
      const h = (_e, m) => cb(m);
      ipcRenderer.on('pty-data', h);
      return () => ipcRenderer.removeListener('pty-data', h);
    },
    onExit: (cb) => {
      const h = (_e, m) => cb(m);
      ipcRenderer.on('pty-exit', h);
      return () => ipcRenderer.removeListener('pty-exit', h);
    },
  },
};
