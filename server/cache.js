'use strict';
// ---------------------------------------------------------------------------
// Historical-bar cache (Settings -> Data). An opt-in, append-only local library of
// normalized bars per (broker, symbol, timeframe). Chart panes read through it and
// write closed bars into it; the curated opt-in list lives in cache-library.json.
// Storage: data/<broker>/<symbol>/<tf>.json = { cols:[...], bars:[[...], ...] } sorted
// ascending by bar time (seconds). Columns are self-describing (a header per file): the
// base OHLCV six are always present as columns 0..5, and a timeframe grows extra columns
// (openInterest, tickVolume, settlement, ...) ONLY when its feed provides them -- so deep
// intraday caches stay compact while daily bars can carry richer fields. Capture-all: the
// server persists whatever extra keys appear on incoming bars (no hardcoded field list).
// Lives in its own gitignored root data/ dir (NOT settings/, which is creds). broker/
// symbol/tf are URI-encoded for the FS.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { ROOT, readSettingsFile, writeSettingsFile, sendJson, readBody } = require('./util.js');

const BARS_DIR = path.join(ROOT, 'data');
const encSeg = (s) => encodeURIComponent(String(s == null ? '' : s));
const barsSymbolDir = (broker, symbol) => path.join(BARS_DIR, encSeg(broker), encSeg(symbol));
const barsFilePath = (broker, symbol, tf) => path.join(barsSymbolDir(broker, symbol), encSeg(tf) + '.json');

const BAR_BASE = ['time', 'open', 'high', 'low', 'close', 'volume'];   // columns 0..5, always present, time first

// read a tf file as { cols, rows }. A file without a `cols` header is read as the base six
// (a compact row is exactly the base six), so no separate format handling is needed.
function readBars(broker, symbol, tf) {
  try {
    const d = JSON.parse(fs.readFileSync(barsFilePath(broker, symbol, tf), 'utf-8'));
    const rows = Array.isArray(d.bars) ? d.bars : [];
    const cols = (Array.isArray(d.cols) && d.cols.length) ? d.cols : BAR_BASE;
    return { cols, rows };
  } catch (_) { return { cols: BAR_BASE.slice(), rows: [] }; }
}
function writeBars(broker, symbol, tf, store) {
  const dir = barsSymbolDir(broker, symbol);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(barsFilePath(broker, symbol, tf), JSON.stringify({ cols: store.cols, bars: store.rows }));
}
// merge incoming bar OBJECTS ({time,open,high,low,close,volume, ...extras}) into the { cols, rows }
// store: dedup by time (incoming wins), sorted ascending. Columns = base six + the union of every
// extra key seen (existing header ∪ incoming keys), sorted for a stable order. Existing rows are
// re-projected onto the widened column set (missing cells become null).
function mergeBars(existing, incoming) {
  const extra = new Set(existing.cols.filter((c) => !BAR_BASE.includes(c)));
  incoming.forEach((b) => { if (b) for (const k in b) if (!BAR_BASE.includes(k) && b[k] != null) extra.add(k); });
  const cols = [...BAR_BASE, ...[...extra].sort()];
  const oldIdx = {}; existing.cols.forEach((c, i) => { oldIdx[c] = i; });
  const m = new Map();
  existing.rows.forEach((r) => { const row = cols.map((c) => (oldIdx[c] == null ? null : (r[oldIdx[c]] == null ? null : r[oldIdx[c]]))); m.set(row[0], row); });
  incoming.forEach((b) => {
    if (!b || b.time == null) return;
    m.set(b.time, cols.map((c) => (c === 'volume' ? (b.volume == null ? 0 : b.volume) : (b[c] == null ? null : b[c]))));
  });
  return { cols, rows: [...m.values()].sort((a, b) => a[0] - b[0]) };
}
// { cols, rows } -> bar objects. Base six always present; an extra only when non-null on that bar.
const toBarObjs = ({ cols, rows }) => rows.map((r) => {
  const o = {};
  cols.forEach((c, i) => { const v = r[i]; if (BAR_BASE.includes(c) || v != null) o[c] = v; });
  return o;
});
const coverageOf = (rows) => (rows.length ? { from: rows[0][0], to: rows[rows.length - 1][0], count: rows.length } : null);

// cached timeframes for a (broker, symbol) with coverage + on-disk size
function tfCoverage(broker, symbol) {
  let files = [];
  try { files = fs.readdirSync(barsSymbolDir(broker, symbol)).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  return files.map((f) => {
    const tf = decodeURIComponent(f.slice(0, -5));
    let bytes = 0; try { bytes = fs.statSync(path.join(barsSymbolDir(broker, symbol), f)).size; } catch (_) {}
    const cov = coverageOf(readBars(broker, symbol, tf).rows) || { from: null, to: null, count: 0 };
    return { tf, ...cov, bytes };
  }).sort((a, b) => a.tf.localeCompare(b.tf));
}

const readLib = () => { const d = readSettingsFile('brokers/cache-library.json'); return Array.isArray(d.rows) ? d.rows : []; };
const writeLib = (rows) => writeSettingsFile('brokers/cache-library.json', { rows });

function handleCache(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname, q = u.searchParams;

  if (p === '/api/cache/library' && req.method === 'GET') {
    return sendJson(res, 200, { rows: readLib().map((r) => ({ ...r, tfs: tfCoverage(r.broker, r.symbol) })) });
  }
  if (p === '/api/cache/library' && req.method === 'POST') {
    return readBody(req, (d) => {
      if (!d || !d.broker || !d.symbol) return sendJson(res, 400, { error: 'missing broker/symbol' });
      const rows = readLib();
      const i = rows.findIndex((r) => r.broker === d.broker && r.symbol === d.symbol);
      const row = { broker: d.broker, symbol: d.symbol, startMs: Number(d.startMs) || 0, addedMs: i >= 0 ? rows[i].addedMs : Date.now() };
      if (i >= 0) rows[i] = row; else rows.push(row);
      writeLib(rows);
      sendJson(res, 200, { ok: true, row });
    });
  }
  if (p === '/api/cache/library/remove' && req.method === 'POST') {
    return readBody(req, (d) => { writeLib(readLib().filter((r) => !(r.broker === d.broker && r.symbol === d.symbol))); sendJson(res, 200, { ok: true }); });
  }
  if (p === '/api/cache/delete' && req.method === 'POST') {
    return readBody(req, (d) => {
      writeLib(readLib().filter((r) => !(r.broker === d.broker && r.symbol === d.symbol)));
      try { fs.rmSync(barsSymbolDir(d.broker, d.symbol), { recursive: true, force: true }); } catch (_) {}
      sendJson(res, 200, { ok: true });
    });
  }
  if (p === '/api/cache/trim' && req.method === 'POST') {
    return readBody(req, (d) => {
      const startSec = Math.floor((Number(d.startMs) || 0) / 1000);
      tfCoverage(d.broker, d.symbol).forEach(({ tf }) => { const s = readBars(d.broker, d.symbol, tf); writeBars(d.broker, d.symbol, tf, { cols: s.cols, rows: s.rows.filter((r) => r[0] >= startSec) }); });
      const rows = readLib(); const i = rows.findIndex((r) => r.broker === d.broker && r.symbol === d.symbol);
      if (i >= 0) { rows[i].startMs = Number(d.startMs) || 0; writeLib(rows); }
      sendJson(res, 200, { ok: true });
    });
  }
  if (p === '/api/cache/bars' && req.method === 'GET') {
    const broker = q.get('broker'), symbol = q.get('symbol'), tf = q.get('tf');
    if (!broker || !symbol || !tf) return sendJson(res, 400, { error: 'missing broker/symbol/tf' });
    const all = readBars(broker, symbol, tf);
    if (q.get('meta')) return sendJson(res, 200, { coverage: coverageOf(all.rows) });   // bounds only, no bars
    let rows = all.rows;
    const from = q.get('from'), to = q.get('to');
    if (from != null) { const f = Number(from); rows = rows.filter((r) => r[0] >= f); }
    if (to != null) { const t = Number(to); rows = rows.filter((r) => r[0] <= t); }
    return sendJson(res, 200, { bars: toBarObjs({ cols: all.cols, rows }), coverage: coverageOf(all.rows) });
  }
  if (p === '/api/cache/bars' && req.method === 'POST') {
    return readBody(req, (d) => {
      if (!d || !d.broker || !d.symbol || !d.tf || !Array.isArray(d.bars)) return sendJson(res, 400, { error: 'missing fields' });
      const merged = mergeBars(readBars(d.broker, d.symbol, d.tf), d.bars);
      writeBars(d.broker, d.symbol, d.tf, merged);
      sendJson(res, 200, { ok: true, coverage: coverageOf(merged.rows) });
    });
  }
  sendJson(res, 404, { error: 'unknown cache endpoint' });
}

module.exports = { handleCache };
