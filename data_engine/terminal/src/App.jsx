import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout, useInput, useApp } from 'ink';
import { bootEngine } from '../boot/engine.js';
import { loadAccounts } from '../boot/accounts.js';
import { startMcp } from './mcp.js';
import { latest as latestStat, subscribe as subscribeStats } from './stats.js';

export const VERSION = '0.0.1';
const MAX = 1000;   // ring buffer of console entries

const hhmmss = (t) => {
  const d = new Date(t || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};

// The terminal IS the engine's Console -- the same platform.console stream the app renders. Every command
// we send the broker is posted dir:'out' by the order worker (exec.js), every broker reply dir:'in' by the
// trade-feed. Commands sent over MCP flow through the same path, so they appear here automatically. This is
// a pure display: no input, no panels. Boot the engine + order worker + MCP, then stream the console.
export function App({ engineBoot = bootEngine, withMcp = true }) {
  const { exit } = useApp();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(engineBoot ? 'booting' : 'no engine');
  const [conns, setConns] = useState([]);
  const [mcp, setMcp] = useState(null);
  const engineRef = useRef(null);

  const [, setTick] = useState(0);
  useEffect(() => subscribeStats(() => setTick((t) => t + 1)), []);   // re-render the status line on a new exec timing

  // read-only console, but a couple of keys: c/Ctrl-L clears, Ctrl-C quits.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { exit(); return; }
    if (input === 'c' || (key.ctrl && input === 'l')) { const e = engineRef.current; if (e && e.platform.console.clear) e.platform.console.clear(); }
  });

  useEffect(() => {
    if (!engineBoot) return;
    let alive = true; let offC = null; let offB = null; let srv = null;
    engineBoot().then((e) => {
      if (!alive) return;
      engineRef.current = e;
      setStatus('solo');
      const hist = typeof e.platform.console.history === 'function' ? e.platform.console.history() : [];
      setRows(hist.slice(-MAX));
      offC = e.platform.console.subscribe(
        (entry) => setRows((prev) => { const n = prev.concat(entry); return n.length > MAX ? n.slice(-MAX) : n; }),
        () => setRows([]),
      );
      const refresh = () => setConns(e.broker.connections ? e.broker.connections() : []);
      offB = e.bus && e.bus.on ? e.bus.on('connections:changed', refresh) : null;
      refresh();
      if (withMcp) startMcp(e, { accounts: loadAccounts().accounts })
        .then((s) => { if (alive) { srv = s; setMcp(s); } else s.close(); })
        .catch(() => {});
    }).catch(() => { if (alive) setStatus('boot failed'); });
    return () => { alive = false; if (offC) offC(); if (offB) offB(); if (srv) srv.close(); };
  }, [engineBoot]);

  return (
    <Box flexDirection="column" height="100%">
      <StatusLine status={status} conns={conns} mcp={mcp} count={rows.length} />
      <Console rows={rows} />
    </Box>
  );
}

function StatusLine({ status, conns, mcp, count }) {
  const ok = status === 'solo';
  const live = (conns || []).filter((c) => c.connected).map((c) => c.id);
  const session = live.length ? live.join(' ') : '-';
  return (
    <Box>
      <Text backgroundColor={ok ? 'green' : (status === 'boot failed' ? 'red' : 'yellow')} color="black"> engine console </Text>
      <Text color="gray">  session: {session}   mcp: {mcp ? ':' + mcp.port : 'off'}   exec: {(() => { const e = latestStat(); return e ? e.ms + 'ms' : '--'; })()}   {count} msgs   [c clear]</Text>
    </Box>
  );
}

// chart-only diagnostics that mean nothing in a headless console (no chart to draw on)
const isChartNoise = (e) => /ORDER TRIPWIRE|cannot draw this order/.test(e.msg || '');

function Console({ rows }) {
  const { stdout } = useStdout();
  const h = Math.max(5, ((stdout && stdout.rows) || 40) - 2);   // fit one screen; newest at the bottom
  const shown = rows.filter((e) => !isChartNoise(e)).slice(-h);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {shown.map((e, i) => <Row key={i} e={e} />)}
    </Box>
  );
}

function Row({ e }) {
  const dir = e.dir === 'out' ? 'OUT' : e.dir === 'in' ? 'IN ' : '   ';
  const dirColor = e.dir === 'out' ? 'yellow' : e.dir === 'in' ? 'cyan' : 'gray';
  const msgColor = e.level === 'error' ? 'red' : e.level === 'warn' ? 'yellow' : undefined;
  return (
    <Box>
      <Text color="gray">{hhmmss(e.t)} </Text>
      <Text color={dirColor} bold>{dir} </Text>
      <Text color="gray">{String(e.src || '').padEnd(6).slice(0, 6)} </Text>
      <Text color={msgColor}>{e.msg}</Text>
    </Box>
  );
}
