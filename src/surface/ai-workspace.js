// @ts-check
// AI Workspace surface -- a whole-tab terminal (xterm.js) bound to a REAL shell (node-pty in the Electron main
// process, reached via the desktop.pty preload API). The shell starts at the app root, so running `claude`
// picks up the project .mcp.json and connects to this app's own MCP server -- the AI drives the platform.
//
// The PTY lives in main keyed by `sessionId` and survives tab switches / detach: this surface only attaches
// or detaches the renderer (dispose the xterm, keep the shell) and replays the buffered scrollback on
// reconnect. xterm loads from node_modules over the static server (no bundler).
import { IPC } from '../ipc-contract.js';

let cssLoaded = false;
function ensureCss() {
  if (cssLoaded) return; cssLoaded = true;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/node_modules/@xterm/xterm/css/xterm.css';
  document.head.appendChild(l);
}

// Built-in fallback styling if settings/ai-workspace/terminal.json is missing or unreadable.
const DEFAULT_TERM = { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, cursorBlink: true,
  theme: { background: '#0e0f14', foreground: '#d4d4d4', cursor: '#e0a030' } };

// Load the standalone terminal styling (user-editable JSON). Unknown keys are harmless -- xterm ignores them.
async function loadTermConfig() {
  try { const r = await fetch('/settings/ai-workspace/terminal.json', { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (_) {}
  return DEFAULT_TERM;
}

/**
 * @param {HTMLElement} root
 * @param {{ sessionId?: string }} [cfg]
 * @returns {{ destroy?: () => void, state?: () => any }}
 */
export function mountAiWorkspace(root, cfg = {}) {
  const desktop = /** @type {any} */ (window).desktop;
  if (!desktop || !desktop.pty) {
    const m = document.createElement('div'); m.style.cssText = 'padding:24px;color:#888;font:14px system-ui';
    m.textContent = 'The AI Workspace terminal requires the desktop app.';
    root.appendChild(m);
    return { state: () => ({}) };
  }
  ensureCss();
  // stable per-tab id so the shell reconnects (not respawns) across tab switches / detach
  const sessionId = cfg.sessionId || ('pty-' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36));

  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden';
  root.appendChild(wrap);

  // "Send to AI" from a chart window: inject the context text into this terminal's prompt (no submit).
  const injectChan = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(IPC.ASSISTANT_INJECT) : null;
  if (injectChan) injectChan.onmessage = (/** @type {MessageEvent} */ e) => { const m = e.data; if (m && m.text) { try { desktop.pty.write(sessionId, m.text); } catch (_) {} if (term) term.focus(); } };

  /** @type {any} */ let term = null;
  /** @type {any} */ let fit = null;
  /** @type {(() => void)|null} */ let offData = null;
  /** @type {(() => void)|null} */ let offExit = null;
  /** @type {ResizeObserver|null} */ let ro = null;
  let disposed = false;

  (async () => {
    // @ts-ignore -- runtime path served from node_modules over the static server; no build/types
    const { Terminal } = await import('/node_modules/@xterm/xterm/lib/xterm.mjs');
    // @ts-ignore
    const { FitAddon } = await import('/node_modules/@xterm/addon-fit/lib/addon-fit.mjs');
    const style = await loadTermConfig();
    if (disposed) return;
    const pad = (style.padding != null) ? style.padding : 10;
    wrap.style.padding = pad + 'px';
    wrap.style.background = (style.theme && style.theme.background) || '#0e0f14';
    term = new Terminal(Object.assign({ allowProposedApi: true }, style));
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(wrap);
    try { fit.fit(); } catch (_) {}
    term.onData((/** @type {string} */ d) => desktop.pty.write(sessionId, d));
    offData = desktop.pty.onData((/** @type {any} */ m) => { if (m && m.sessionId === sessionId && term) term.write(m.data); });
    offExit = desktop.pty.onExit((/** @type {any} */ m) => { if (m && m.sessionId === sessionId && term) term.write('\r\n\x1b[90m[shell exited: ' + m.code + ']\x1b[0m\r\n'); });
    desktop.pty.spawn(sessionId, term.cols, term.rows);   // new session, or reconnect + buffer replay
    ro = new ResizeObserver(() => { try { fit.fit(); desktop.pty.resize(sessionId, term.cols, term.rows); } catch (_) {} });
    ro.observe(wrap);

    // Copy (Ctrl+Shift+C) / paste (Ctrl+Shift+V, right-click) -- WezTerm-style. xterm gives selection but no
    // clipboard binding; use Electron's clipboard, falling back to the async web Clipboard API.
    const clipWrite = (/** @type {string} */ t) => { try { if (desktop.clipboard) { desktop.clipboard.write(t); return; } } catch (_) {} try { navigator.clipboard.writeText(t); } catch (_) {} };
    const doPaste = () => {
      try { if (desktop.clipboard) { const t = desktop.clipboard.read(); if (t) term.paste(t); return; } } catch (_) {}
      try { navigator.clipboard.readText().then((t) => { if (t) term.paste(t); }).catch(() => {}); } catch (_) {}
    };
    term.attachCustomKeyEventHandler((/** @type {KeyboardEvent} */ ev) => {
      if (ev.type !== 'keydown' || !ev.ctrlKey || !ev.shiftKey) return true;
      const k = (ev.key || '').toLowerCase();
      if (k === 'c') { const s = term.getSelection(); if (s) clipWrite(s); return false; }
      if (k === 'v') { doPaste(); return false; }
      return true;
    });
    wrap.addEventListener('contextmenu', (/** @type {MouseEvent} */ ev) => { ev.preventDefault(); doPaste(); });
    // Copy-on-select (WezTerm default): highlighting text copies it to the clipboard automatically.
    wrap.addEventListener('mouseup', () => { const s = term.getSelection(); if (s) clipWrite(s); });

    term.focus();
  })().catch((e) => { wrap.textContent = 'AI Workspace failed to load: ' + ((e && e.message) || e); });

  return {
    state: () => ({ sessionId }),   // persisted into the workspace so a remount reconnects
    // detach the renderer only; the PTY keeps running in main (killed on app quit)
    destroy: () => {
      disposed = true;
      try { offData && offData(); } catch (_) {}
      try { offExit && offExit(); } catch (_) {}
      try { ro && ro.disconnect(); } catch (_) {}
      try { injectChan && injectChan.close(); } catch (_) {}
      try { term && term.dispose(); } catch (_) {}
    },
  };
}
