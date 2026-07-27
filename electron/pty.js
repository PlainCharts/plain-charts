// --- AI Workspace PTY sessions ---------------------------------------------------------------------
// A real shell per AI-workspace tab (node-pty; main process). Keyed by a sessionId the surface stores in its
// workspace state, so the shell -- and any Claude Code session -- survives tab switches and detach: the
// renderer detaches on switch-away and reconnects on return, replaying a rolling output buffer. The PTY is
// killed only on 'pty-kill' (the panel's "restart shell") or app quit (main calls killAllPtys).
const { ipcMain } = require('electron');
const path = require('path');

let ptyLib = null;
try { ptyLib = require('node-pty'); } catch (e) { console.error('[pty] node-pty unavailable:', (e && e.message) || e); }
const PTY_ROOT = path.join(__dirname, '..');   // shells start at the app root, so `claude` finds the project .mcp.json
const PTY_BUF_CAP = 200000;                    // ~200KB rolling scrollback for reconnect replay
const ptys = new Map();                        // sessionId -> { pty, buf, owner (webContents) }

ipcMain.on('pty-spawn', (e, { sessionId, cols, rows } = {}) => {
  if (!ptyLib || !sessionId) { try { e.sender.send('pty-exit', { sessionId, code: -1, error: ptyLib ? 'no sessionId' : 'node-pty unavailable' }); } catch (_) {} return; }
  let s = ptys.get(sessionId);
  if (s) { s.owner = e.sender; try { e.sender.send('pty-data', { sessionId, data: s.buf }); } catch (_) {} return; }   // reconnect: replay
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  const pty = ptyLib.spawn(shell, [], { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd: PTY_ROOT, env: process.env });
  s = { pty, buf: '', owner: e.sender };
  ptys.set(sessionId, s);
  pty.onData((data) => { s.buf = (s.buf + data).slice(-PTY_BUF_CAP); try { if (s.owner && !s.owner.isDestroyed()) s.owner.send('pty-data', { sessionId, data }); } catch (_) {} });
  pty.onExit(({ exitCode }) => { ptys.delete(sessionId); try { if (s.owner && !s.owner.isDestroyed()) s.owner.send('pty-exit', { sessionId, code: exitCode }); } catch (_) {} });
});
ipcMain.on('pty-write', (_e, { sessionId, data } = {}) => { const s = ptys.get(sessionId); if (s) { try { s.pty.write(data); } catch (_) {} } });
ipcMain.on('pty-resize', (_e, { sessionId, cols, rows } = {}) => { const s = ptys.get(sessionId); if (s && cols > 0 && rows > 0) { try { s.pty.resize(cols, rows); } catch (_) {} } });
ipcMain.on('pty-kill', (_e, { sessionId } = {}) => { const s = ptys.get(sessionId); if (s) { try { s.pty.kill(); } catch (_) {} ptys.delete(sessionId); } });

// app quit: kill every live shell (main calls this from its 'quit' handler)
function killAllPtys() { ptys.forEach((s) => { try { s.pty.kill(); } catch (_) {} }); }

module.exports = { killAllPtys };
