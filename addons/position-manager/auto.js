// @ts-check
// order-ticket AUTO -- the watcher-driven automated bracket. The setup DATA (ref / dir / levels / armed / activeIdx)
// lives in the shared PLAN-STORE (single source: the app draws it, the table reads it, applyRules derives the watcher
// rules from it); this module owns only the PHASE machine + the watcher rule ids. Nothing fires until PRICE touches a
// level, then the WATCHER places a MARKET order (entry buys/sells; stop/target close the live position). Multi-level
// TP/SL ladders advance rung by rung. Arm/Disarm layer the exits onto ANY live position. There are NO broker
// stop/limit orders here -- broker exits are the app's job (Order dialog / chart drag); this is the app-side,
// watcher-driven layer. DRAWING-FREE: the app overlay renders everything. Reacts through events:
//   on('fill')        -> build the live bracket from the fill   on('instrument'|'rethreshold') -> recompute the vicinity
//   on('quote')       -> feed the watcher the live price        on('units') -> entry qty + a single rung's exit qty follow
// It exposes active()/syncButtons()/onFlat()/onManualEntry()/resetPlan() for index.js's orchestration.

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */
/** @typedef {import('/data_engine/index.js').OrderSide} OrderSide */
/** @typedef {import('/data_engine/index.js').PositionSide} PositionSide */
/** @typedef {{ tgt: number|null, tgtQty: number, stop: number|null }} Level  one rung of the ladder, as the TABLE reads it (a per-call view of the store; never stored here) */
/** @typedef {{ stopRule: string|null, tgtRule: string|null }} Bracket  ACTIVE bracket: watcher rule ids ONLY -- dir/entry/activeIdx live in the store */
/** @typedef {{ entryRule: string|null, armed: boolean }} Pend  pending entry setup: the trigger rule id + armed flag */
/** @typedef {{ dir: PositionSide, exitSide: OrderSide, entrySide: OrderSide }} Pending  FILLING: the SENT order's side (event data -- the fill matches on it) */

import { createPlanBridge } from '/addons/position-manager/plan-bridge.js';

/** @param {Kernel} ot @param {{ section: (title: string, host?: HTMLElement) => HTMLElement, autoPane: HTMLElement, visPane: HTMLElement }} deps */
export function createAuto(ot, { section, autoPane, visPane }) {
  const { el, BTN, INP, cfg, fmt, qtick, offsetPrice, save, api, exec, clog, state, colors, t } = ot;
  const planBridge = createPlanBridge(ot);   // mirrors the pending setup into the app plan-store -> the app draws the dots
  const planApi = api.trade.plan;
  const planCtx = () => ({ b: cfg.broker || '', s: cfg.symbol });
  // ---- SINGLE SOURCE OF TRUTH: the PLAN-STORE owns the whole setup (ref / dir / levels / armed / activeIdx). The
  // addon keeps NO copy of it -- the table reads it per call (storeLevels), and the watcher rules are DERIVED from it
  // by applyRules(), re-run on every store change. Local state is only the PHASE (pend/pending/bracket) + rule ids.
  const refDir = () => { const p = planApi.get(planCtx().b, planCtx().s); return { ref: p.ref != null ? Number(p.ref) : null, dir: /** @type {PositionSide} */ (p.dir === 'short' ? 'short' : 'long') }; };
  // RECONCILE the watcher with the store: pend -> the armed entry trigger tracks ref/dir/Units; bracket -> the ACTIVE
  // rung's stop/target are the only live exit rules (price, direction and partial-qty synced; a null price = no rule;
  // the last rung's target closes the remainder, earlier rungs close their qty). Pure store->watcher: it never writes
  // the store, so it cannot loop.
  function applyRules() {
    if (pend && pend.armed && pend.entryRule) {
      const { ref, dir } = refDir();
      if (ref != null) watch.update(pend.entryRule, { price: ref, dir: dir === 'long' ? 'down' : 'up', action: { do: dir === 'long' ? 'buy' : 'sell', qty: unitsQty() } });
    }
    if (bracket) {
      const Ls = storeLevels(), idx = curIdx(), L = Ls[idx], last = idx >= Ls.length - 1;
      const { dir } = refDir();
      const sDir = dir === 'long' ? 'down' : 'up', tDir = dir === 'long' ? 'up' : 'down';
      if (L && L.stop != null) {
        if (bracket.stopRule) watch.update(bracket.stopRule, { price: L.stop, dir: sDir, action: { do: 'close' } });
        else bracket.stopRule = watch.add({ price: L.stop, dir: sDir, action: { do: 'close' } });
      } else if (bracket.stopRule) { watch.remove(bracket.stopRule); bracket.stopRule = null; }
      /** @type {{ do: 'close', qty?: number }} */
      const tAction = last ? { do: 'close' } : { do: 'close', qty: (L && Math.abs(Number(L.tgtQty))) || 1 };
      if (L && L.tgt != null) {
        if (bracket.tgtRule) watch.update(bracket.tgtRule, { price: L.tgt, dir: tDir, action: tAction });
        else bracket.tgtRule = watch.add({ price: L.tgt, dir: tDir, action: tAction });
      } else if (bracket.tgtRule) { watch.remove(bracket.tgtRule); bracket.tgtRule = null; }
    }
  }
  // table follow: rung count changed -> rebuild the rows, else refresh cell values in place (keeps a focused input alive)
  const syncTable = () => { if (!active()) return; if (storeLevels().length !== levelCells.length) renderLevels(); else refreshLevelCells(); };
  /** @param {*} _m */ const say = (_m) => {};   // the panel status line was removed; keep a no-op for the call sites
  /** @param {...any} a */ const dbg = (...a) => console.log('[OT]', ...a);
  // small numeric cell for the levels table: commits its parsed value (or null) on change
  /** @param {number|null} val @param {(v: number|null) => void} onCommit @returns {HTMLInputElement} */
  const numCell = (val, onCommit) => { const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.value = /** @type {any} */ ((val != null && isFinite(val)) ? val : ''); i.style.cssText = INP + 'width:100%;box-sizing:border-box;'; i.onchange = () => { const v = parseFloat(i.value); onCommit(isFinite(v) ? v : null); }; return i; };
  /** @param {string} txt @param {() => void} fn @param {string} [color] */
  const mk = (txt, fn, color) => { const b = document.createElement('button'); b.textContent = txt; if (color) b.style.cssText = 'background:' + color + ';color:#fff;border-color:' + color + ';'; b.onclick = fn; return b; };

  // the LIVE position from the platform BOOK (the single source; no addon-local position copy exists)
  const posOf = () => { const b = api.trade.book(cfg.broker || '', cfg.symbol); return (b.entry != null && b.qty > 0) ? { side: b.side, qty: b.qty, entry: Number(b.entry) } : null; };
  const watch = api.watcher({
    // watcher touch -> the worker seam (the automation's only execution). An ENTRY is a raw MARKET order; a position
    // EXIT (stop/target close) must go through the ACCOUNT-AWARE close, NOT a raw opposite order: on a hedging account
    // an opposite market opens a SECOND lot (the broker rejects a naive close on hedging) instead of closing, so exits route to the DSL `close`
    // (hedging closes lots by ticket; netting offsets). full = flatten the symbol; partial = close N of the ladder rung.
    execute: (/** @type {any} */ cmd) => {
      const ctx = { broker: cfg.broker, symbol: cfg.symbol };
      /** @param {any} r */ const done = (r) => { if (r && r.error) clog('order error: ' + r.error, true); };
      if (cmd.close) {
        const script = cmd.full ? 'close symbol' : ('close partial ' + cmd.qty);
        dbg('EXECUTE close', JSON.stringify(cmd), 'pos=', JSON.stringify(posOf()));
        clog('closing ' + (cmd.full ? cfg.symbol : cmd.qty + ' ' + cfg.symbol));
        exec({ type: 'script', script, ctx }).then(done);
      } else {
        dbg('EXECUTE', JSON.stringify(cmd), 'pos=', JSON.stringify(posOf()));
        clog('sent ' + cmd.side + ' ' + cmd.qty + ' ' + cfg.symbol + ' market');
        exec({ type: 'place', orderType: 'market', ctx, side: cmd.side, qty: cmd.qty }).then(done);
      }
    },
    getPosition: posOf,
  });
  // vicinity threshold (TICKS -> price) for the watcher; re-applied when the tick size or the Thold input changes.
  const applyThreshold = () => watch.setThreshold((Math.abs(Number(cfg.thresholdTicks)) || 1) * (state.domTick || 0.25));

  // PHASE state only -- the setup DATA (ref/dir/levels/armed/activeIdx) lives in the plan-store, never here.
  /** @type {Bracket|null} */ let bracket = null;   // ACTIVE bracket: watcher rule ids
  /** @type {Pending|null} */ let pending = null;   // FILLING: entry sent, awaiting fill
  /** @type {Pend|null} */ let pend = null;         // pending entry setup
  const active = () => !!(bracket || pending || pend);

  // --- remote debug: window.__ot() dumps the live state + rules + on-chart element counts ---
  /** @type {any} */ (window).__ot = () => ({ bracket: !!bracket, pend: pend ? { armed: pend.armed } : null, pending: !!pending, plan: planApi.get(planCtx().b, planCtx().s), symbol: cfg.symbol, lastPx: state.lastPx,
    pos: posOf(), rules: watch.rules().map((/** @type {any} */ r) => ({ id: r.id, price: r.price, from: r.from, do: r.action && r.action.do, armed: r.armed, fired: r.fired })) });

  // DRAWING STRIPPED: the VISIBILITY / HIDE-ON-ENTRY bead subsystem (curThread / applyVis / clearLines / hide-on-entry
  // + the WHICH/vis/toggles/hideSet state) is gone -- the addon draws no beads, so there is nothing to show/hide.
  // The app overlay owns all on-chart visibility.

  // ----- LEVELS: a sequential TP/SL ladder. Source of truth: the PLAN-STORE in EVERY phase -- storeLevels() maps the
  // store ladder to the table shape fresh on each call (a per-call VIEW, never a stored copy).
  const storeLevels = () => { const { b, s } = planCtx(); const pls = planApi.get(b, s).levels; return (Array.isArray(pls) ? pls : []).map((/** @type {any} */ pl) => ({ tgt: (pl && pl.target != null) ? Number(pl.target) : null, tgtQty: (pl && pl.qty != null) ? Math.abs(Number(pl.qty)) || 1 : 1, stop: (pl && pl.stop != null) ? Number(pl.stop) : null })); };
  const curLevels = () => (bracket || pend || pending) ? storeLevels() : null;
  const curIdx = () => { if (!bracket) return 0; const ai = Number(planApi.get(planCtx().b, planCtx().s).activeIdx); return Number.isFinite(ai) && ai >= 0 ? ai : 0; };
  const unitsQty = () => Math.abs(Number(cfg.qty) || 1);

  // TABLE price edits -> STORE writes only, in EVERY phase (single source: the subscription then refreshes the table,
  // the app moves the dots, applyRules re-syncs the watcher). A pend STOP goes through commitStop -- the SAME rung-0
  // direction-flip rule as a chart drag, so typing a stop across the entry flips long<->short (the reference addon's
  // reflectDir on table edits). With a position open (bracket) the side is fixed -> plain reprice. ARMED pend:
  // flipping is a PLANNING gesture -- retargeting the live entry trigger at the market fires it instantly on the
  // flipped side, so an armed stop edit only repositions.
  /** @param {number} i @param {number} px @param {boolean} commit */
  const setLevelStop = (i, px, commit) => {
    const L = curLevels(); if (!L || !L[i] || !commit) return;
    const p = qtick(px); const { b, s } = planCtx();
    if (p == null) planApi.setLevel(b, s, i, { stop: null });   // cleared cell -> clear the rung's stop
    else if (pend) planApi.commitStop(b, s, i, p, { flip: !pend.armed, snap: (/** @type {number} */ v) => /** @type {number} */ (qtick(v)) });
    else planApi.setLevel(b, s, i, { stop: p });
    say('stop ' + (L.length > 1 ? (i + 1) + ' ' : '') + p);
  };
  /** @param {number} i @param {number} px @param {boolean} commit */
  const setLevelTgt = (i, px, commit) => {
    const L = curLevels(); if (!L || !L[i] || !commit) return;
    const p = qtick(px);
    planApi.setLevel(planCtx().b, planCtx().s, i, { target: p });
    say('target ' + (L.length > 1 ? (i + 1) + ' ' : '') + p);
  };

  const updateSide = () => {};   // side is implied by the beads / the Buy-Sell press; kept as a no-op call site

  // DRAWING STRIPPED: makeThread / rebuildThread (the AUTO order string -- pending-entry trigger + numbered stop/target
  // ladder, drawn via api.chart.thread) are removed, along with the bead colours + posLabelFor. The addon no longer
  // draws the ladder; the level DATA lives in the pend/bracket state and drives the watcher. Level edits still come
  // from the levels TABLE (renderLevels below). The app overlay owns on-chart rendering.
  // advance/select the ACTIVE rung: record it (locally + in the store, so the overlay can style done rungs) and
  // re-derive the watcher rules from the store. Stop closes the full remaining; target closes the rung's qty (partial)
  // except the last rung, whose target closes the remainder (flat) -- all of that lives in applyRules.
  /** @param {number} idx */
  const armLevel = (idx) => {
    if (!bracket) return;
    planApi.setLevels(planCtx().b, planCtx().s, { activeIdx: idx });
    applyRules();
    renderLevels();
    const Ls = storeLevels(), L = Ls[idx] || {};
    dbg('armLevel', idx, 'of', Ls.length, 'stop=', L.stop, 'tgt=', L.tgt, 'rules=', watch.rules().length);
  };
  /** @param {string} [msg] */
  const teardownBracket = (msg) => {
    if (!bracket) return;
    if (bracket.stopRule) watch.remove(bracket.stopRule);
    if (bracket.tgtRule) watch.remove(bracket.tgtRule);
    bracket = null;
    planBridge.clear();   // exit hit -> position closing -> drop the live bracket drawing
    resetVis();   // the original resetLines: every dot category shows again
    syncButtons(); renderLevels();
    if (msg) say(msg);
  };
  // Scale-safe SEED distance around a reference price. Honours the configured offset when it lands sanely on THIS
  // instrument (e.g. 10 points on a ~5000 index); when that offset is absurd for the price scale (10 on a ~1.14 forex
  // pair would put the stop at a NEGATIVE price), it falls back to a price fraction -- the same instrument-agnostic
  // fallback the app's pre-trade seedBracket uses ("no ticks/points to mis-scale on crypto/fx"). So auto-seeding a bare
  // position never lands off-scale on forex/crypto. Drag/typing/ticks-unit still give exact control; this is only the default.
  const SEED_PCT = 0.0015;   // ~0.15% of price when the configured offset can't be trusted for this instrument
  /** @param {number} ref @returns {number} */
  const seedOffset = (ref) => { const o = offsetPrice(); const r = Math.abs(Number(ref)) || 0; return (o > 0 && r > 0 && o < r * 0.5) ? o : Math.max(r * SEED_PCT, 0); };

  // build the ACTIVE bracket from a real fill. The STORE already holds the planned ladder (the pending setup wrote it
  // there and chart drags kept editing it); arming onto a bare position (no plan) seeds ONE default rung from a
  // SCALE-SAFE offset. The entry pivot (ref) anchors to the FILL price; the overlay keeps drawing the ladder over the position.
  /** @param {{ dir: PositionSide, exitSide: OrderSide }} p @param {number} entry */
  const openBracket = (p, entry) => {
    const { b, s } = planCtx();
    planBridge.push(); planBridge.arm();   // flags on (bridge owns the plan) + LIVE colours; the store levels stay as planned
    if (!storeLevels().length) {
      const off = seedOffset(entry);
      planApi.setLevel(b, s, 0, { stop: off ? /** @type {number} */ (qtick(p.dir === 'long' ? entry - off : entry + off)) : null, target: off ? /** @type {number} */ (qtick(p.dir === 'long' ? entry + off : entry - off)) : null, qty: 1 });
    }
    planApi.setLevels(b, s, { ref: entry, dir: p.dir });
    bracket = { stopRule: null, tgtRule: null };   // rule ids ONLY -- dir/entry/activeIdx live in the store
    armLevel(0);   // records the active rung + derives the watcher exits from the store
    syncButtons();
    const Ls = storeLevels(), l0 = Ls[0] || {};
    say(p.dir + ' @ ' + entry + (l0.stop != null ? '   stop ' + l0.stop : '') + (l0.tgt != null ? '   target ' + l0.tgt : '') + (Ls.length > 1 ? '   (+' + (Ls.length - 1) + ' levels)' : ''));
  };

  // ----- pending-entry controls: [Show pending | Arm] -----
  const pendHdr = el('div', 'display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;');
  pendHdr.append(el('div', 'color:var(--tx-dim);font-size:11px;letter-spacing:.06em;', t('ORDER')));
  autoPane.append(pendHdr);
  const pendBox = el('div', '');
  autoPane.append(pendBox);
  const pendBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().auto), t('Show pending'))); pendBtn.onclick = () => onPendBtn();
  const armBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().auto), t('Arm'))); armBtn.onclick = () => onArmBtn();
  ot.on('recolor', () => { pendBtn.style.background = colors().auto; armBtn.style.background = colors().auto; });   // gear dialog changed the palette (grey opacity persists on top)
  const actionsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;');
  actionsGrid.append(pendBtn, armBtn);
  pendBox.append(actionsGrid);

  // ----- levels table -----
  const levelsBox = section(t('LEVELS'), autoPane);
  const LV_COLS = 'display:grid;grid-template-columns:14px 44px 92px 92px 16px;gap:6px;align-items:center;';
  const lvHead = el('div', LV_COLS + 'color:var(--tx-dim);font-size:11px;margin-bottom:5px;');
  lvHead.append(el('span', '', '#'), el('span', '', t('Qty')), el('span', '', t('Target')), el('span', '', t('Stop')), el('span', ''));
  const levelsEl = el('div', '');
  const addBtn = mk(t('+ Add Level'), () => addLevel()); addBtn.style.marginTop = '6px';
  levelsBox.append(lvHead, levelsEl, addBtn);

  /** @type {{ tgtIn: HTMLInputElement, stopIn: HTMLInputElement }[]} */
  let levelCells = [];
  const syncLevelsCfg = () => { const L = curLevels(); if (L) { cfg.levels = L.map((/** @type {Level} */ l) => ({ tgtQty: Math.abs(Number(l.tgtQty)) || 1 })); save(); } };
  /** @param {number} i @param {'stop'|'target'} which @param {number|null} v */
  const onLevelPriceEdit = (i, which, v) => {
    const L = curLevels(); if (!L || !L[i]) return;
    if (which === 'stop') setLevelStop(i, /** @type {number} */ (v), true); else setLevelTgt(i, /** @type {number} */ (v), true);
  };
  function refreshLevelCells() {
    const L = curLevels(); if (!L) return;
    L.forEach((/** @type {Level} */ lv, /** @type {number} */ i) => { const c = levelCells[i]; if (!c) return;
      if (c.tgtIn && document.activeElement !== c.tgtIn) c.tgtIn.value = /** @type {any} */ ((lv.tgt != null && isFinite(lv.tgt)) ? lv.tgt : '');
      if (c.stopIn && document.activeElement !== c.stopIn) c.stopIn.value = /** @type {any} */ ((lv.stop != null && isFinite(lv.stop)) ? lv.stop : '');
    });
  }
  function renderLevels() {
    levelsEl.innerHTML = ''; levelCells = [];
    const L = curLevels(), ai = curIdx();
    const canEdit = L && !pending;
    addBtn.style.display = canEdit ? 'inline-block' : 'none';
    if (!L) { levelsEl.appendChild(el('div', 'color:var(--tx-dim);font-size:12px;', t('no setup — Show pending to begin'))); return; }
    L.forEach((/** @type {Level} */ lv, /** @type {number} */ i) => {
      const on = bracket && i === ai;
      const done = bracket && i < ai;
      const row = el('div', LV_COLS + 'margin-bottom:4px;padding:2px;border-radius:4px;' + (on ? 'outline:1px solid #2962ff;' : '') + (done ? 'opacity:0.45;' : ''));
      const tgtIn = numCell(lv.tgt, (v) => onLevelPriceEdit(i, 'target', v));
      const qtyIn = numCell(lv.tgtQty, (v) => { const q = Math.abs(v || 0) || 1; planApi.setLevel(planCtx().b, planCtx().s, i, { qty: q }); qtyIn.value = /** @type {any} */ (q); syncLevelsCfg(); });
      const stopIn = numCell(lv.stop, (v) => onLevelPriceEdit(i, 'stop', v));
      const rm = el('button', 'background:none;border:none;color:var(--tx-dim);cursor:pointer;font-size:15px;line-height:1;padding:0;', '×'); rm.onclick = () => removeLevel(i);
      const removable = canEdit && L.length > 1 && (!bracket || i > ai);
      if (!removable) rm.style.visibility = 'hidden';
      row.append(el('span', 'color:var(--tx-dim);font-size:11px;', String(i + 1)), qtyIn, tgtIn, stopIn, rm);
      levelsEl.appendChild(row); levelCells[i] = { tgtIn, stopIn };
    });
  }
  // add/remove a rung: STORE writes only. The subscription rebuilds the table, the app redraws the dots, and applyRules
  // re-derives the active rung's exit rules (adding a rung turns the active target partial; removing the last makes it
  // close the remainder).
  function addLevel() {
    const L = curLevels(); if (!L || pending) return;
    const { b, s } = planCtx(); const p = planApi.get(b, s);
    const pls = Array.isArray(p.levels) ? p.levels : [];
    const i = pls.length;
    if (pend) {   // pre-trade: spaced by the app-seeded rung-0 distance (fallback: the offset), relative to the entry pivot
      const ref = p.ref != null ? Number(p.ref) : null;
      if (ref == null) return say('no entry level yet — wait for the projection');
      const l0 = pls[0] || {};
      const up = (p.dir || 'long') !== 'short';
      const tDist = l0.target != null ? Math.abs(Number(l0.target) - ref) : seedOffset(ref);
      const sDist = l0.stop != null ? Math.abs(ref - Number(l0.stop)) : seedOffset(ref);
      planApi.setLevel(b, s, i, { stop: qtick(up ? ref - sDist * (i + 1) : ref + sDist * (i + 1)), target: qtick(up ? ref + tDist * (i + 1) : ref - tDist * (i + 1)), qty: 1 });
      say('level ' + (i + 1) + ' added — drag its dots or type its prices');
      return;
    }
    const { ref, dir } = refDir();   // live bracket: the fill anchored ref/dir in the store
    if (ref == null) return;
    const off = seedOffset(ref);
    const e = ref, up = dir !== 'short';
    planApi.setLevel(b, s, i, { stop: qtick(up ? e - off * (i + 1) : e + off * (i + 1)), target: qtick(up ? e + off * (i + 1) : e - off * (i + 1)), qty: 1 });
    syncLevelsCfg();
    say('level ' + (i + 1) + ' added mid-trade — active target is now partial; set the new level\'s prices/qty');
  }
  /** @param {number} i */
  function removeLevel(i) {
    const L = curLevels(); if (!L || pending || L.length <= 1) return;
    if (bracket && i <= curIdx()) return say('cannot remove the active or a completed level');
    const { b, s } = planCtx(); const pls = (planApi.get(b, s).levels || []).slice();
    if (i < pls.length) { pls.splice(i, 1); planApi.setLadder(b, s, pls); }
    if (bracket) syncLevelsCfg();
  }

  // ----- phase machine drives the two buttons -----
  const phase = () => (bracket || pending) ? 'active' : pend ? (pend.armed ? 'armed' : 'shown') : posOf() ? 'position' : 'idle';
  /** @param {HTMLButtonElement} b @param {boolean} on */
  const grey = (b, on) => { b.disabled = on; b.style.opacity = on ? '0.5' : '1'; b.style.cursor = on ? 'default' : 'pointer'; };
  function syncButtons() {
    const ph = phase();
    if (ph === 'idle')   { pendBtn.textContent = t('Show pending');  grey(pendBtn, false); armBtn.textContent = t('Arm');    grey(armBtn, true); }
    if (ph === 'shown')  { pendBtn.textContent = t('Clear pending'); grey(pendBtn, false); armBtn.textContent = t('Arm');    grey(armBtn, false); }
    if (ph === 'armed')  { pendBtn.textContent = t('Clear pending'); grey(pendBtn, false); armBtn.textContent = t('Disarm'); grey(armBtn, false); }
    if (ph === 'active') { pendBtn.textContent = t('Armed');         grey(pendBtn, true);  armBtn.textContent = t('Disarm'); grey(armBtn, false); }
    if (ph === 'position') { const pp = posOf(); pendBtn.textContent = pp ? ((pp.side === 'short' ? t('Short') : t('Long')) + ' ' + fmt(pp.qty)) : t('Position'); grey(pendBtn, true); armBtn.textContent = t('Arm'); grey(armBtn, false); }
    updateSide();
  }
  const onPendBtn = () => { const ph = phase(); if (ph === 'idle') showPending(); else if (ph === 'shown' || ph === 'armed') clearPending(); };
  const onArmBtn = () => { const ph = phase(); if (ph === 'shown') armPending(); else if (ph === 'armed') disarmPending(); else if (ph === 'active') disarmActive(); else if (ph === 'position') armFromPosition(); };
  // DISARM the auto layer: cancel the watcher exits + strip the exit beads, KEEP the position (redrawn as the
  // dot-only string at the SAME anchor). Re-Arm re-adds the exits.
  function disarmActive() {
    if (bracket) {
      if (bracket.stopRule) watch.remove(bracket.stopRule);
      if (bracket.tgtRule) watch.remove(bracket.tgtRule);
      bracket = null;
    }
    if (pending) pending = null;
    planBridge.clear();   // disarmed -> drop the live bracket drawing (position stays; Arm re-adds)
    resetVis();   // the original resetLines
    syncButtons(); renderLevels();
    say(posOf() ? 'auto layer disarmed — position stays; Arm to re-add stop/target' : 'disarmed — automated exits cancelled');
  }
  // ARM the auto layer onto an EXISTING live position: build default offset-seeded exits and hand the string to the bracket.
  function armFromPosition() {
    const live = posOf(); if (!live) return say('no live position to arm');
    if (bracket || pending || pend) return;
    openBracket({ dir: /** @type {any} */ (live.side), exitSide: live.side === 'long' ? 'sell' : 'buy' }, live.entry);
  }
  function clearPending() { if (pend && pend.entryRule) watch.remove(pend.entryRule); pend = null; planBridge.clear(); syncButtons(); renderLevels(); }
  // SHOW = arm the pending setup state (levels + entry). Nothing watches; ARM makes it live. (No drawing -- the level
  // DATA lives in `pend`; the app overlay renders it.)
  function showPending() {
    if (pend) return clearPending();
    if (bracket || pending) return say('bracket active — Flatten first');
    if (state.lastPx == null) return say('no price yet — wait for a quote');
    // NO local copy: the STORE is the single source. The app seeds the entry pivot (ref) + rung 0's stop/target/dir
    // from its Bars-away/Offset settings; we only stamp rung 0's exit QTY (Units). The table reads the store; extra
    // rungs via +Add Level.
    pend = { entryRule: null, armed: false };
    planBridge.push();   // flip on the app projection -> the app draws + seeds ref/stop/target/dir into the store
    planApi.setLevel(planCtx().b, planCtx().s, 0, { qty: unitsQty() });
    planApi.setLevels(planCtx().b, planCtx().s, { qty: unitsQty() });   // shared ENTRY volume too -- the pill controller / dialog Volume read plan.qty
    updateSide();
    renderLevels();
    syncButtons();
    say('setup shown — set the levels in the table, then Arm to go live');
  }
  // ARM = confirm + go live: the entry becomes a watcher rule; on touch it fires a market order for the ladder qty.
  // Price/side come from the STORE (ref/dir); applyRules keeps the rule tracking them while armed.
  function armPending() {
    if (!pend || pend.armed) return;
    const { ref, dir } = refDir();
    if (ref == null) return say('no entry level yet — wait for the projection');
    pend.entryRule = watch.add({ price: ref, dir: dir === 'long' ? 'down' : 'up', action: { do: dir === 'long' ? 'buy' : 'sell', qty: unitsQty() } });
    pend.armed = true; planBridge.arm();   // LIVE: the app redraws the bracket in live colours (planning -> live mode)
    syncButtons();
    dbg('ARMED', dir, 'entry=', ref, 'qty=', unitsQty(), 'rule=', pend.entryRule, 'total rules=', watch.rules().length);
    say('ARMED ' + dir + ' ' + unitsQty() + ' — entry fires at market when price touches the entry bead; the levels activate after the fill');
  }
  function disarmPending() {
    if (!pend || !pend.armed) return;
    if (pend.entryRule) { watch.remove(pend.entryRule); pend.entryRule = null; }
    pend.armed = false; planBridge.disarm();   // back to planning mode (plan colours, no live trigger)
    syncButtons();
    say('disarmed — setup still shown; adjust, then Arm');
  }
  // The watcher fires the orders; react to each fire: entry -> awaiting-fill; stop/target -> close / advance.
  watch.onFire((/** @type {any} */ rule) => {
    dbg('FIRE', JSON.stringify({ id: rule.id, price: rule.price, from: rule.from, do: rule.action && rule.action.do }), 'entryRule=', pend && pend.entryRule, 'stopRule=', bracket && bracket.stopRule, 'tgtRule=', bracket && bracket.tgtRule, 'lastPx=', state.lastPx);
    if (pend && rule.id === pend.entryRule) {
      pend = null;
      const { dir } = refDir();   // side from the STORE -- the ladder stays there untouched; the fill builds the bracket from it
      pending = { dir, exitSide: dir === 'long' ? 'sell' : 'buy', entrySide: dir === 'long' ? 'buy' : 'sell' };   // the SENT order's side (event data, not plan state) -- the fill matches on it
      onEntry();   // HIDE ON ENTRY: the watcher pulled the trigger -- hide the checked categories now (addon-owned moment)
      syncButtons(); renderLevels();
      say('pending ' + dir + ' triggered @ ' + state.lastPx + ' — entering ' + unitsQty() + ' at market');
      return;
    }
    if (!bracket) return;
    if (rule.id === bracket.stopRule) { teardownBracket('stop hit — closing at market'); return; }
    if (rule.id === bracket.tgtRule) {
      const idx = curIdx();
      if (idx >= storeLevels().length - 1) { teardownBracket('target ' + (idx + 1) + ' hit — position closed'); return; }
      bracket.tgtRule = null;
      armLevel(idx + 1);
      const nx = storeLevels()[idx + 1] || {};
      say('target ' + (idx + 1) + ' hit — advanced to level ' + (idx + 2) + ' (stop ' + nx.stop + ', target ' + nx.tgt + ')');
    }
  });

  // ----- line VISIBILITY (pure show/hide; never affects the orders) ----- The toggles write the shared plan.vis and
  // the APP OVERLAY filters its dots by it (the addon draws nothing itself). Synced back from the store, so a change
  // from another window moves the checkboxes too.
  /** @typedef {'entry'|'stop'|'target'} WhichKey */
  /** @type {[WhichKey, string][]} */
  const WHICH = [['entry', 'Entry'], ['stop', 'Stop'], ['target', 'Target']];
  /** @type {Partial<Record<WhichKey, HTMLInputElement>>} */
  const toggles = {};
  const visOf = () => /** @type {any} */ (planApi.get(planCtx().b, planCtx().s).vis || {});
  const linesBox = section(t('VISIBILITY'), visPane);
  const visRow = el('div', 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;');
  WHICH.forEach(([w, label]) => {
    const lab = el('label', 'display:flex;gap:4px;align-items:center;cursor:pointer;');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = visOf()[w] !== false;
    c.onchange = () => planApi.setVis(planCtx().b, planCtx().s, /** @type {any} */ ({ [w]: c.checked }));
    toggles[w] = c; lab.append(c, el('span', '', t(label))); visRow.appendChild(lab);
  });
  linesBox.appendChild(visRow);
  const syncVisUI = () => { const v = visOf(); WHICH.forEach(([w]) => { const c = toggles[w]; if (c) c.checked = v[w] !== false; }); };
  const resetVis = () => planApi.resetEntryVisibility(planCtx().b, planCtx().s);   // flat/teardown shows everything again (shared behavior)

  // ----- HIDE ON ENTRY ----- each CHECKED category hides at the ENTRY moment; unchecked reset to visible. The policy is
  // now the SHARED GLOBAL one (order-visibility): the ORDER DIALOG edits the same setting, it persists, and it syncs
  // across windows. onEntry here is the addon's OPTIMISTIC fire (the watcher pulled the trigger, BEFORE the fill); the
  // app overlay also applies the policy at the fill -- both idempotent, both read this one policy.
  /** @type {Partial<Record<WhichKey, HTMLInputElement>>} */
  const hideToggles = {};
  const hideBox = section(t('HIDE ON ENTRY'), visPane);
  const hideRow = el('div', 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;');
  WHICH.forEach(([w, label]) => {
    const lab = el('label', 'display:flex;gap:4px;align-items:center;cursor:pointer;');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!planApi.hideOnEntry()[w];
    c.onchange = () => planApi.setHideOnEntry(/** @type {any} */ ({ [w]: c.checked }));
    hideToggles[w] = c; lab.append(c, el('span', '', t(label))); hideRow.appendChild(lab);
  });
  hideBox.appendChild(hideRow);
  const syncHideUI = () => { const h = planApi.hideOnEntry(); WHICH.forEach(([w]) => { const c = hideToggles[w]; if (c) c.checked = !!h[w]; }); };
  planApi.onHideOnEntryChange(syncHideUI);   // reflect a change made from the dialog / another window
  const onEntry = () => planApi.applyEntryVisibility(planCtx().b, planCtx().s);   // optimistic hide at the watcher trigger (shared policy)

  // position went flat: strip the auto bracket (cancel its watcher rules), refresh the levels table and show every
  // dot category again (the original resetLines).
  const onFlat = () => {
    if (bracket) { if (bracket.stopRule) watch.remove(bracket.stopRule); if (bracket.tgtRule) watch.remove(bracket.tgtRule); }
    bracket = null; planBridge.clear(); resetVis(); renderLevels();   // drop any leftover plan projection so a closed trade leaves no stale bracket
  };

  // react to the shared events
  ot.on('fill', (/** @type {any} */ f) => { if (pending && f.symbol === cfg.symbol && f.side === pending.entrySide && f.price) { const p = pending; pending = null; openBracket(p, Number(f.price)); } });
  ot.on('quote', (/** @type {number} */ px) => watch.onPrice(px));
  ot.on('instrument', () => applyThreshold());
  ot.on('rethreshold', () => applyThreshold());
  // OWNER-MODE gestures from the shared plan (the pill controller drives us through the store, not direct calls):
  // projection OFF while a setup is shown -> the X anywhere = our Clear pending (drop the local state too, or the
  // panel reads "pending" over an empty plan); armed flipped ON externally -> the V = our Arm (and if arming
  // cannot proceed yet, flip the flag back so the store never lies); armed OFF externally -> disarm; plan.qty
  // changed externally (the pill's qty picker) -> Units follow. All state-diff guarded, so our own writes no-op.
  const syncOwnerGestures = () => {
    const { b, s } = planCtx();
    if (pend && !planApi.isProjecting(b, s)) {
      if (pend.entryRule) watch.remove(pend.entryRule);
      pend = null; syncButtons(); renderLevels(); say('setup cleared');
      return;
    }
    if (pend && !pend.armed && planApi.isArmed(b, s)) { armPending(); if (pend && !pend.armed) planApi.setArmed(b, s, false); }
    else if (pend && pend.armed && !planApi.isArmed(b, s)) disarmPending();
    const pq = Number(planApi.get(b, s).qty);
    if (pend && pq > 0 && pq !== Math.abs(Number(cfg.qty) || 1)) { cfg.qty = pq; ot.save(); ot.emit('units-sync'); ot.emit('units'); }
  };
  planApi.subscribe(() => { syncOwnerGestures(); applyRules(); syncTable(); syncVisUI(); });   // ANY store change (seed, chart drag, table edit, other window) -> owner gestures + re-derive the watcher rules + refresh the table + visibility toggles; auto-unsubscribed on close
  ot.on('units', () => { if (pend) { const { b, s } = planCtx(); const pls = planApi.get(b, s).levels || []; if (pls.length === 1) planApi.setLevel(b, s, 0, { qty: unitsQty() }); planApi.setLevels(b, s, { qty: unitsQty() }); } applyRules(); renderLevels(); });   // new Units -> entry rule qty + a single rung's exit qty + the shared plan.qty (pill controller) follow

  renderLevels();   // initial: 'no setup' hint
  syncButtons();    // initial: idle -> [Show pending] [Arm disabled]

  // MANUAL entry = the same trigger as the watcher fire, only the user presses the button. Gated on FLAT (an add to an
  // open position is not an entry). With a setup SHOWN it performs the exact transition the fire branch does -- into
  // the pending phase, side from the pressed button -- so the fill flows through the SAME openBracket: armed plan
  // (LIVE beads) + real watcher exits. An armed pending trigger is removed first so it cannot fire a second entry.
  /** @param {OrderSide} side */
  const onManualEntry = (side) => {
    if (posOf()) return;
    onEntry();   // HIDE ON ENTRY at the trigger moment
    if (!pend) return;   // no setup shown -> a plain market entry, nothing to attach
    if (pend.entryRule) watch.remove(pend.entryRule);
    pend = null;
    const dir = side === 'sell' ? 'short' : 'long';
    pending = { dir, exitSide: dir === 'long' ? 'sell' : 'buy', entrySide: dir === 'long' ? 'buy' : 'sell' };
    syncButtons(); renderLevels();
  };

  return { active, syncButtons, onFlat, onManualEntry, resetPlan: () => planBridge.reset() };
}
