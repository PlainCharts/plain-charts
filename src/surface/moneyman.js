// @ts-check
// Money Man surface -- per-account money-management setup + a live view of the zone/ladder state, with a
// console that explains how the state was reached.
//
// Pure display + config. The sizing decisions live in the engine (data_engine/orders/sizing/mm); this panel
// only GATHERS the account's config + closed-trade history and RENDERS the engine's state + trace. No business
// logic here. Config edits persist to settings/trading/money-management.json (keyed by saved account name);
// the account's starting balance is the MM origin.
import { platform, computePositions, replayTrace } from '../../data_engine/index.js';
import { applyDeskColors } from './desk-config.js'; // pushes the user's MM zone/level colours onto :root
import * as accounts from '../connect/accounts.js';
import { getMMConfig, setMMConfig, loadMMConfigs } from '../money-management/config.js';
import { netOf } from './trade-derive.js';

/** @param {string} tag @param {string} [cls] @param {string} [txt] */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};
/** @param {number} x */
const money = (x) => '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** @param {number} x */
const money2 = (x) => '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** percent: 2 decimals, keep a 3rd only when significant @param {number} x */
const pct = (x) => (Number(x.toFixed(2)) === Number(x.toFixed(3)) ? x.toFixed(2) : x.toFixed(3));

const SVGNS = 'http://www.w3.org/2000/svg';
/** @param {string} tag @param {Record<string,any>} attrs @param {string} [text] */
function svg(tag, attrs, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text != null) e.textContent = text;
  return e;
}

// One-time scoped styles. Chrome uses the live theme vars; the zone/level colors are fixed semantics.
function injectCss() {
  if (document.getElementById('mm-panel-css')) return;
  const s = el('style');
  s.id = 'mm-panel-css';
  s.textContent = `
  .mm-panel{--mm-win:#3fb950;
    display:flex;gap:14px;height:100%;overflow:hidden;padding:12px;box-sizing:border-box;color:var(--tx)}
  .mm-panel *{box-sizing:border-box}
  .mm-cfg{flex:0 0 268px;display:flex;flex-direction:column;overflow:auto}
  .mm-view{flex:0 0 550px;min-width:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
  .mm-panel label{display:block;color:var(--tx-dim);font-size:14px;text-transform:uppercase;letter-spacing:.4px;margin:10px 0 3px}
  .mm-panel input,.mm-panel select{width:100%;background:var(--field);color:var(--tx);border:1px solid var(--bd);border-radius:5px;padding:6px 8px;font:inherit;font-size:14px}
  .mm-row{display:flex;gap:8px}.mm-row>*{flex:1}
  .mm-seg{display:flex;border:1px solid var(--bd);border-radius:6px;overflow:hidden;margin-top:4px}
  .mm-seg button{flex:1;background:var(--btn);color:var(--tx2);border:0;border-right:1px solid var(--bd);padding:7px;cursor:pointer;font:inherit;font-size:14px}
  .mm-seg button:last-child{border-right:0}
  .mm-seg button.on{background:var(--accent);color:var(--accent-tx);font-weight:600}
  .mm-origin-val{padding:7px 0;font-weight:700;color:var(--tx);font-size:14px}
  .mm-ref{margin-top:8px;font-size:14px;line-height:1.7;color:var(--tx2);font-variant-numeric:tabular-nums}
  .mm-viz{flex:0 0 auto;background:var(--panel);border:1px solid var(--bd-soft);border-radius:8px;padding:6px;aspect-ratio:460/560;max-height:520px}
  .mm-viz svg{width:100%;height:100%;display:block}
  .mm-lad{background:var(--panel);border:1px solid var(--bd-soft);border-radius:8px;padding:12px 14px}
  .mm-lad-h{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .mm-pill{display:inline-block;padding:1px 9px;border-radius:999px;font-weight:700;font-size:16px}
  .lv-MAX{background:color-mix(in srgb,var(--mm-max) 25%,transparent);color:var(--mm-max)}
  .lv-MID{background:color-mix(in srgb,var(--mm-mid) 25%,transparent);color:var(--mm-mid)}
  .lv-MIN{background:color-mix(in srgb,var(--mm-min) 25%,transparent);color:var(--mm-min)}
  .mm-lad-pct{font-size:16px}.mm-lad-ceil{color:var(--tx-dim);font-size:14px}
  .mm-lad-risk{margin-left:auto;font-size:16px}.mm-lad-risk b{color:var(--tx)}
  .mm-bar{margin-top:10px}.mm-bar-h{display:flex;justify-content:space-between;font-size:14px;color:var(--tx-dim);margin-bottom:3px}
  .mm-bar-t{height:18px;background:var(--field);border:1px solid var(--bd-soft);border-radius:6px;overflow:hidden}
  .mm-bar-f{height:100%;background:linear-gradient(90deg,var(--mm-base),var(--accent))}
  .mm-bar-r{font-size:14px;color:var(--tx-dim);margin-top:2px}
  .mm-note{margin-top:8px;padding:8px 10px;border-radius:6px;font-size:14px}
  .mm-note.floor{color:var(--mm-floor);background:color-mix(in srgb,var(--mm-floor) 12%,transparent)}
  .mm-note.stop{color:var(--mm-stop);background:color-mix(in srgb,var(--mm-stop) 12%,transparent)}
  .mm-note.max{color:var(--mm-max)}
  .mm-hint{color:var(--tx-dim);font-size:12px;padding:20px;text-align:center}
  /* console */
  .mm-con{flex:1;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--bd-soft);border-radius:8px;min-width:0}
  .mm-con-h{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--bd-soft)}
  .mm-con-h span{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--tx-dim)}
  .mm-log{flex:1;overflow:auto;padding:8px 10px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  .mm-log div{white-space:pre-wrap;margin:0}
  .l-setup{color:var(--mm-base)}.l-win{color:var(--mm-win)}.l-loss{color:var(--mm-stop)}.l-be{color:var(--tx-dim)}
  .l-zone{color:var(--accent)}.l-slide{color:var(--mm-shot)}.l-muted{color:var(--tx-dim)}`;
  document.head.appendChild(s);
}

const NUM_LABEL = {
  baseMaxPct: 'Base max %',
  shotMaxPct: 'Shot max %',
  maxDd: 'Max DD',
  increment: 'Increments',
  beThreshold: 'BE threshold',
};

/** Saved accounts that can trade (have a starting balance = an MM origin). */
const tradingAccounts = () => accounts.listAccounts().filter((a) => a.startingBalance != null);

/** The account's closed round-trip nets, oldest first -- the MM replay input. Tick specs (stamped on each
 *  fill by the adapter) are required for currency P&L, same as the History surface.
 *  @param {{ protocol: string }} saved @returns {number[]} */
function tradesFor(saved) {
  const conn = platform.accounts
    .all()
    .find((a) => String(a.broker).toLowerCase() === String(saved.protocol).toLowerCase());
  if (!conn) return [];
  const fills = platform.fills.all();
  /** @type {Map<string, {tickSize?:any, tickValue?:any}>} */
  const tickBySym = new Map();
  for (const s of fills)
    if (s.symbol && !tickBySym.has(s.symbol) && (s.tickValue != null || s.tickSize != null))
      tickBySym.set(s.symbol, { tickSize: s.tickSize, tickValue: s.tickValue });
  const { closed } = computePositions(fills, { contractInfo: (sym) => tickBySym.get(sym) });
  return closed
    .filter((r) => r.broker === conn.broker && String(r.accountId) === String(conn.accountId))
    .sort((a, b) => (Number(a.exitTime) || 0) - (Number(b.exitTime) || 0))
    .map((r) => netOf(r))
    .filter((n) => n != null)
    .map((n) => Number(n));
}

/** @param {HTMLElement} root */
export function mountMoneyMan(root) {
  injectCss();
  applyDeskColors(); // ensure the --mm-* CSS vars exist (idempotent; also re-applied on a color change)
  loadMMConfigs();
  root.innerHTML = '';
  const panel = el('div', 'mm-panel');
  const cfgCol = el('div', 'mm-cfg');
  const viewCol = el('div', 'mm-view');
  const conCol = el('div', 'mm-con');
  const conHead = el('div', 'mm-con-h');
  conHead.append(el('span', undefined, 'Console'));
  const logBox = el('div', 'mm-log');
  conCol.append(conHead, logBox);
  panel.append(cfgCol, viewCol, conCol);
  root.appendChild(panel);

  const saved = tradingAccounts();
  let selected =
    accounts.lastUsed() && saved.find((a) => a.name === accounts.lastUsed())
      ? accounts.lastUsed()
      : saved[0] && saved[0].name;

  // Rebuild everything from the account + its history: config, grid, ladder, trace log. Runs on mount, a
  // config/account change, or the Refresh button -- NOT on a market tick. The order size MM decides is
  // computed once, at order time, in the worker; the tab is just a viewer.
  function render() {
    const list = tradingAccounts();
    const acct = list.find((a) => a.name === selected) || list[0];
    cfgCol.innerHTML = '';
    viewCol.innerHTML = '';
    if (!acct) {
      cfgCol.appendChild(el('div', 'mm-hint', 'No trading account. Add one with a starting balance in Connections.'));
      logBox.textContent = '';
      return;
    }
    selected = acct.name;
    const cfg = getMMConfig(acct.name);
    const origin = Number(acct.startingBalance) || 0;

    const engineCfg = {
      origin,
      increment: cfg.increment,
      maxDd: cfg.maxDd,
      baseMaxPct: cfg.baseMaxPct,
      shotMaxPct: cfg.shotMaxPct,
      beThreshold: cfg.beThreshold,
    };
    const trades = tradesFor(acct);
    const { trace, state: st } = replayTrace(engineCfg, trades);
    // the USD reference uses the LIVE balance -- the same basis the sizing uses (never the origin)
    buildConfigCol(cfgCol, list, acct, cfg, origin, st.balance);

    const vizBox = el('div', 'mm-viz');
    const grid = svg('svg', { viewBox: '0 0 460 560', preserveAspectRatio: 'xMidYMid meet' });
    vizBox.appendChild(grid);
    viewCol.appendChild(vizBox);
    drawGrid(grid, cfg, st);
    viewCol.appendChild(ladderCard(cfg, st));

    renderLog(logBox, engineCfg, cfg, st, trace);
  }

  /** @param {HTMLElement} col @param {any[]} list @param {any} acct @param {any} cfg @param {number} origin @param {number} balance */
  function buildConfigCol(col, list, acct, cfg, origin, balance) {
    col.appendChild(el('label', undefined, 'Account'));
    const sel = /** @type {HTMLSelectElement} */ (el('select'));
    list.forEach((a) => {
      const o = /** @type {HTMLOptionElement} */ (el('option', undefined, a.name));
      o.value = a.name;
      if (a.name === acct.name) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      selected = sel.value;
      render();
    };
    col.appendChild(sel);

    col.appendChild(el('label', undefined, 'Sizing system'));
    const seg = el('div', 'mm-seg');
    /** @type {[string,string][]} */ ([
      ['manual', 'Manual'],
      ['mm', 'Money man'],
    ]).forEach(([val, txt]) => {
      const b = el('button', cfg.system === val ? 'on' : undefined, txt);
      b.onclick = () => {
        setMMConfig(acct.name, { system: /** @type {'manual'|'mm'} */ (val) });
        render();
      };
      seg.appendChild(b);
    });
    col.appendChild(seg);

    /** @param {string} key */
    const numField = (key) => {
      const wrap = el('div');
      wrap.appendChild(el('label', undefined, NUM_LABEL[/** @type {keyof typeof NUM_LABEL} */ (key)]));
      const inp = /** @type {HTMLInputElement} */ (el('input'));
      inp.type = 'text';
      inp.value = String(cfg[/** @type {keyof typeof cfg} */ (key)]);
      inp.onchange = () => {
        const v = Number(inp.value);
        if (Number.isFinite(v)) setMMConfig(acct.name, { [key]: v });
        render();
      };
      wrap.appendChild(inp);
      return wrap;
    };
    // MAX DD | INCREMENTS
    const rowDD = el('div', 'mm-row');
    rowDD.append(numField('maxDd'), numField('increment'));
    // BE THRESHOLD | START BAL (read-only)
    const originField = el('div');
    originField.appendChild(el('label', undefined, 'Start bal'));
    originField.appendChild(Object.assign(el('div', 'mm-origin-val'), { textContent: money(origin) }));
    const rowBE = el('div', 'mm-row');
    rowBE.append(numField('beThreshold'), originField);
    // BASE MAX % | SHOT MAX % at the bottom, with the actual USD ceilings (MAX/MID/MIN) under each
    const rowPct = el('div', 'mm-row');
    rowPct.append(numField('baseMaxPct'), numField('shotMaxPct'));
    /** @param {number} p ceiling percent -> the MAX/MID/MIN dollar amounts at the LIVE balance (the sizing basis) */
    const usdRef = (p) => {
      const max = (p / 100) * balance;
      return Object.assign(el('div', 'mm-ref'), {
        innerHTML: `MAX: ${money(max)}<br>MID: ${money(max / 2)}<br>MIN: ${money(max / 4)}`,
      });
    };
    const rowRef = el('div', 'mm-row');
    rowRef.append(usdRef(cfg.baseMaxPct), usdRef(cfg.shotMaxPct));
    col.append(rowDD, rowBE, rowPct, rowRef);
  }

  /** Full replay trace -- every trade, with transitions called out. Heavy; rebuilt on Refresh / config change.
   *  @param {HTMLElement} box @param {any} engineCfg @param {any} cfg @param {ReturnType<typeof replayTrace>['state']} st @param {any[]} trace */
  function renderLog(box, engineCfg, cfg, st, trace) {
    box.innerHTML = '';
    /** @param {string} txt @param {string} [cls] */
    const line = (txt, cls) => box.appendChild(el('div', cls, txt));
    line(
      `setup: origin ${money(engineCfg.origin)}, hard floor ${money(st.hardFloor)} (DD ${money(cfg.maxDd)}), increment ${money(cfg.increment)}`,
      'l-setup',
    );
    line(
      `ladder: BASE MAX ${cfg.baseMaxPct}% / MID ${cfg.baseMaxPct / 2}% / MIN ${cfg.baseMaxPct / 4}%  ·  SHOT MAX ${cfg.shotMaxPct}% / MID ${cfg.shotMaxPct / 2}% / MIN ${cfg.shotMaxPct / 4}%  ·  BE +/-${money(cfg.beThreshold)}`,
      'l-setup',
    );
    if (!trace.length) {
      line('no closed trades yet — starting fresh at MAX.', 'l-muted');
      return;
    }
    for (const t of trace) {
      if (t.zone !== t.prevZone) line(`[ZONE] ${t.prevZone} -> ${t.zone}`, 'l-zone');
      if (t.slid) line(`window slid (balance crossed a grid line)`, 'l-slide');
      const kind = t.net > cfg.beThreshold ? 'WIN ' : t.net < -cfg.beThreshold ? 'LOSS' : 'BE  ';
      const kc = t.net > cfg.beThreshold ? 'l-win' : t.net < -cfg.beThreshold ? 'l-loss' : 'l-be';
      const tag =
        t.move === 'climb' ? ' -> climbed to ' + t.level : t.move === 'drop' ? ' -> dropped to ' + t.level : '';
      line(
        `#${t.i} ${kind} ${t.net >= 0 ? '+' : ''}${money2(t.net)} -> ${money(t.balance)}  [${t.zone} ${t.level}] risk ${money(t.risk)}${tag}`,
        kc,
      );
    }
    line(
      `— replay complete: ${trace.length} trades → ${st.zone} ${st.level}, next risk ${money2(st.risk)} —`,
      'l-muted',
    );
    box.scrollTop = box.scrollHeight;
  }

  /** @param {SVGElement} elg @param {any} cfg @param {ReturnType<typeof replayTrace>['state']} st */
  function drawGrid(elg, cfg, st) {
    while (elg.firstChild) elg.removeChild(elg.firstChild);
    const W = 460,
      H = 560,
      padT = 18,
      padB = 18,
      axisX = 96,
      rightX = W - 14;
    const inc = cfg.increment,
      origin = st.origin,
      hf = st.hardFloor,
      L = st.bands.baseBottom,
      bal = st.balance;
    const bot = hf - inc,
      top = L + 3 * inc;
    const y = (/** @type {number} */ p) => padT + (H - padT - padB) * (1 - (p - bot) / (top - bot));
    const band = (
      /** @type {number} */ p0,
      /** @type {number} */ p1,
      /** @type {string} */ c,
      /** @type {number} */ a,
    ) =>
      elg.appendChild(
        svg('rect', {
          x: axisX,
          y: y(p1),
          width: rightX - axisX,
          height: Math.max(0, y(p0) - y(p1)),
          fill: c,
          'fill-opacity': a,
        }),
      );
    band(bot, hf, 'var(--mm-stop)', 0.22);
    band(hf, origin, 'var(--mm-floor)', 0.2);
    band(L, L + inc, 'var(--mm-base)', 0.3);
    band(L + inc, L + 2 * inc, 'var(--mm-shot)', 0.3);
    const lbl = (
      /** @type {number} */ p0,
      /** @type {number} */ p1,
      /** @type {string} */ t,
      /** @type {string} */ c,
    ) =>
      elg.appendChild(
        svg(
          'text',
          {
            x: axisX + (rightX - axisX) / 2,
            y: (y(p0) + y(p1)) / 2 + 4,
            fill: c,
            'font-size': 14,
            'font-weight': 700,
            'text-anchor': 'middle',
          },
          t,
        ),
      );
    lbl(L, L + inc, `BASE  ${cfg.baseMaxPct}%`, 'var(--mm-base)');
    lbl(L + inc, L + 2 * inc, `SHOT  ${cfg.shotMaxPct}%`, 'var(--mm-shot)');
    if (y(hf) - y(origin) > 22) lbl(hf, origin, 'FLOOR — MIN', 'var(--mm-floor)');
    if (y(bot) - y(hf) > 20) lbl(bot, hf, 'STOP — max DD', 'var(--mm-stop)');
    const line = (
      /** @type {number} */ p,
      /** @type {string} */ c,
      /** @type {string} */ dash,
      /** @type {boolean} */ wide,
    ) => {
      elg.appendChild(
        svg('line', {
          x1: axisX,
          y1: y(p),
          x2: rightX,
          y2: y(p),
          stroke: c,
          'stroke-width': wide ? 1.5 : 1,
          'stroke-dasharray': dash || 'none',
        }),
      );
      elg.appendChild(
        svg(
          'text',
          { x: axisX - 8, y: y(p) + 4, fill: 'var(--tx-dim)', 'font-size': 14, 'text-anchor': 'end' },
          money(p),
        ),
      );
    };
    for (let p = origin; p <= top + 1; p += inc) line(p, 'var(--bd)', '', false);
    line(origin, 'var(--accent)', '', true);
    line(hf, 'var(--mm-stop)', '5 4', true);
    const by = y(Math.max(bot, Math.min(top, bal)));
    elg.appendChild(svg('line', { x1: axisX, y1: by, x2: rightX, y2: by, stroke: 'var(--tx)', 'stroke-width': 2 }));
    elg.appendChild(svg('circle', { cx: rightX, cy: by, r: 4, fill: 'var(--tx)' }));
    elg.appendChild(
      svg(
        'text',
        { x: rightX - 8, y: by - 6, fill: 'var(--tx)', 'font-size': 14, 'font-weight': 700, 'text-anchor': 'end' },
        `Bal ${money(bal)}`,
      ),
    );
  }

  /** @param {any} cfg @param {ReturnType<typeof replayTrace>['state']} st */
  function ladderCard(cfg, st) {
    const card = el('div', 'mm-lad');
    if (st.zone === 'STOP') {
      card.appendChild(
        el('div', 'mm-note stop', `Ladder halted — max drawdown hit. Sizing held at MIN (${money2(st.risk)}).`),
      );
      return card;
    }
    if (st.zone === 'FLOOR') {
      const minPct = st.ceiling / 4;
      card.appendChild(
        el(
          'div',
          'mm-note floor',
          `FLOOR — frozen at MIN ${pct(minPct)}% (${money2(st.risk)}). ${money(st.origin - st.balance)} back to origin.`,
        ),
      );
      return card;
    }
    const head = el('div', 'mm-lad-h');
    head.appendChild(el('span', 'mm-pill lv-' + st.level, st.level));
    head.appendChild(el('span', 'mm-lad-pct', pct(st.levelPct) + '%'));
    head.appendChild(
      el(
        'span',
        'mm-lad-ceil',
        `MAX ${st.ceiling.toFixed(2)} / MID ${(st.ceiling / 2).toFixed(2)} / MIN ${(st.ceiling / 4).toFixed(3)}`,
      ),
    );
    const risk = el('span', 'mm-lad-risk');
    risk.innerHTML = `next risk <b>${money2(st.risk)}</b>`;
    head.appendChild(risk);
    card.appendChild(head);
    if (st.level === 'MAX') {
      card.appendChild(el('div', 'mm-note max', 'At MAX — top of the ladder.'));
    } else {
      /** @param {string} label @param {number} prog @param {number} total */
      const bar = (label, prog, total) => {
        const w = total > 0 ? Math.max(0, Math.min(100, (prog / total) * 100)) : 100;
        const b = el('div', 'mm-bar');
        b.innerHTML =
          `<div class="mm-bar-h"><span>${label}</span><span>${money2(prog)} / ${money2(total)}</span></div>` +
          `<div class="mm-bar-t"><div class="mm-bar-f" style="width:${w}%"></div></div>` +
          `<div class="mm-bar-r">${money2(Math.max(0, total - prog))} remaining</div>`;
        return b;
      };
      if (st.level === 'MIN') {
        const gMid = st.gateToNext;
        const gTot = gMid + 0.5 * (st.ceiling / 100) * st.balance;
        card.append(
          bar(`To ${pct(st.ceiling / 2)}% (MIN -> MID)`, st.progress, gMid),
          bar(`To ${pct(st.ceiling)}% (total to MAX)`, st.progress, gTot),
        );
      } else {
        card.appendChild(bar(`To ${pct(st.ceiling)}% (MID -> MAX)`, st.progress, st.gateToNext));
      }
    }
    return card;
  }

  render();
  return { destroy: () => {} };
}
