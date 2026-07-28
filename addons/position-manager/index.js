// @ts-check
// Order Ticket (sample) — a LIVE trading panel on the addon layer. Two order-entry pathways:
//   - BASIC: Buy/Sell place one plain MARKET order for Units.
//   - AUTOMATED: a watcher-driven bracket (auto.js) over the shared plan-store -- the app draws the levels, the
//     watcher fires a MARKET order on touch (entry buys/sells, stop/target close the live position).
// Plus a live quote line. Symbol + broker follow the active chart. Everything updates in real time via
// ctx.data (quotes + OnTrade streams); no polling. DEMO ACCOUNTS ONLY: Buy/Sell place real orders.
// The setup DATA (ref/dir/levels/armed) lives in the plan-store; the phase shapes live in auto.js.

/**
 * The addon's persisted config (api.config). Everything the panel saves via api.save(cfg).
 * @typedef {Object} Cfg
 * @property {string} broker
 * @property {string} symbol
 * @property {number} [qty]
 * @property {number} [offset]        default level spacing for the automation ladder (in offsetUnit); the config UI is app-owned now
 * @property {'ticks'|'points'} [offsetUnit] how offset is measured: ticks (x tickSize) or points (x 1)
 * @property {number} [thresholdTicks] watcher vicinity, in ticks
 * @property {{ tgtQty?: number }[]} [levels]
 * @property {string[]} [hideOnEntry]  dot categories (entry/stop/target) hidden on the flat->open transition
 */

module.exports = {
  inputs: [
    { key: 'broker', type: 'text', default: 'cqg' },
    { key: 'symbol', type: 'text', default: 'EP' },
    { key: 'qty', type: 'number', default: 1 },
    { key: 'offset', type: 'number', default: 10 },          // one offset for BOTH stop and target beads
    { key: 'thresholdTicks', type: 'number', default: 1 },   // watcher vicinity: fire when price within this many ticks of a level
  ],

  /** @param {HTMLElement} root @param {import('../../src/panels/addons.js').AddonApi} api */
  async ui(root, api) {
    /** @type {Cfg} */
    const cfg = { ...api.config };
    if (cfg.offset == null || !isFinite(Number(cfg.offset))) cfg.offset = 10;
    if (cfg.offsetUnit !== 'points' && cfg.offsetUnit !== 'ticks') cfg.offsetUnit = 'ticks';   // universal offset unit (ticks | points); more units added later
    // KERNEL: the shared context (helpers, popup, emitter, dialog registry, state bag). Loaded via dynamic import
    // because the addon is eval'd with require() shimmed. Destructure the stateless / api-bound helpers as locals so
    // the rest of this module reads unchanged; ot.state / ot.emit are the shared seams between the modules.
    const [{ createKernel }, { createMarketData }, { createTradeFeed }, { createEntry }, { createShell }, { createAuto }] = await Promise.all([
      import('/addons/position-manager/kernel.js'),
      import('/addons/position-manager/market-data.js'),
      import('/addons/position-manager/trade-feed.js'),
      import('/addons/position-manager/entry.js'),
      import('/addons/position-manager/shell.js'),
      import('/addons/position-manager/auto.js'),
    ]);
    const ot = createKernel(root, api, cfg);
    const { el, BTN, INP, save, colors, t } = ot;   // (ad/clog are used inside the extracted modules, not here)
    // SHELL: the panel chrome (header, section(), universal CONFIGURATION box). ONE pane, no tabs.
    const shell = createShell(ot);
    const { autoPane, section, updateHeader, visPane } = shell;

    // ---------- live quote ----------  one plain line between the header and Units:  B: <bid> | <spread> | A: <ask>
    // Also carries status text (resolving / not connected).
    const quoteLine = el('div', 'margin:15px 0;font-size:18px;color:var(--tx-dim);text-align:center;font-variant-numeric:tabular-nums;', '');
    const md = createMarketData(ot, { quoteLine });   // resolves the symbol + subscribes to quotes; emits 'instrument' / 'quote'


    // (positions live in the app's Positions panel now -- no in-ticket list/Flatten)

    // ---------- order entry ----------
    // Panel status line removed; transient messages reach the app Console via clog() inside the modules. The entry
    // and market-data subsystems live in their own files (entry.js / market-data.js).

    // ============================================================================================
    // BASIC ORDER PANEL — elementary single orders (Market / Limit / Stop), separate from the bracket
    // /pending system above. Buy/Sell places ONE plain order: N units of the active symbol, at market,
    // or at a price for Limit/Stop. Placed at the top of the Broker tab. Self-contained.
    const simpleOut = el('div', 'font-size:11px;color:var(--tx-dim);min-height:14px;', '');   // entry status line -- sits inline on the Units row
    /** @param {string} m */
    const simpleSay = (m) => { simpleOut.textContent = m; };

    const unitsIn = document.createElement('input'); unitsIn.type = 'number'; unitsIn.min = '1'; unitsIn.value = /** @type {any} */ (cfg.qty || 1); unitsIn.style.cssText = INP + 'width:52px;';   // ~3 digits + spinner; never a 7-digit box
    // the SINGLE Units input (shared by the market entry Buy/Sell AND the pending ladder). Persists cfg.qty, and
    // re-arms an armed pending entry + re-mirrors a single level's close qty, exactly as the old auto Units did.
    unitsIn.onchange = () => { cfg.qty = Math.abs(parseFloat(unitsIn.value) || 1) || 1; unitsIn.value = /** @type {any} */ (cfg.qty); save(); ot.emit('units'); };   // auto.js re-arms the entry qty + mirrors level 0
    // MARKET-ONLY: the Limit/Stop Price + TIF/GTD inputs are removed -- the addon sends market orders only.
    const unitsRow = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:8px;');
    unitsRow.append(el('span', 'width:42px;color:var(--tx-dim);', t('Units')), unitsIn, simpleOut);   // status ("BUY market sent") sits to the right of the input

    // MARKET-ONLY: the Market | Limit | Stop type selector is removed. Buy/Sell place immediate market orders.
    const bsRow = el('div', 'display:flex;gap:8px;');
    const buyBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().buy), t('Buy')));
    const sellBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().sell), t('Sell')));
    bsRow.append(buyBtn, sellBtn);
    ot.on('recolor', () => { buyBtn.style.background = colors().buy; sellBtn.style.background = colors().sell; });   // gear dialog changed the palette
    ot.on('units-sync', () => { unitsIn.value = /** @type {any} */ (cfg.qty || 1); });   // plan.qty edited elsewhere (the pill's qty picker) -> refresh the input

    const orderBox = el('div', 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--bd-soft);');
    orderBox.append(quoteLine, unitsRow, bsRow);   // quote (under the header) + Units (+status) + Buy/Sell
    autoPane.prepend(orderBox);   // entry panel at the TOP of the Auto tab

    // ----- MARKET entry + open-position primitive -----  Buy/Sell place a MARKET order for Units. The live
    // position renders as a blue dot on its own thread; the price-scale label comes free from the bead tag.
    // Clicking the dot opens basic controls (partial / close / add). Stop & Target are UI-only for now --
    // stop/limit orders are wired at the end. Everything here is pure market.
    // ENTRY actions live in entry.js. position-exits.js is DELETED: its dialogs/proposals were unreachable after the
    // drawing strip (their openers hung off beads that no longer exist), and every capability is app-owned now --
    // SL/TP via the Order dialog + chart drag (setStop/setTarget), OCO + stop auto-sizing in the worker
    // (src/orders/reconcile.js), Close All via the cancelWorking verb + quick-buttons.
    const entry = createEntry(ot, { simpleSay });
    // Buy / Sell = immediate MARKET order for Units (adds to the net on a netting account). No order-type dispatch --
    // the addon sends market orders only. The press IS the entry trigger (same as a watcher fire): flat-gated, it
    // applies HIDE ON ENTRY and, with a setup shown, moves it into the pending phase so the fill builds the SAME live
    // bracket the Arm path does (auto.onManualEntry).
    buyBtn.onclick = () => { auto.onManualEntry('buy'); entry.placeMarket('buy', unitsIn.value); };
    sellBtn.onclick = () => { auto.onManualEntry('sell'); entry.placeMarket('sell', unitsIn.value); };

    // ---- Watcher: the automated executor (api.watcher). It watches price and fires a MARKET order the
    // instant a line's level is reached. Every line is a market-on-touch rule — there are NO broker
    // stop/limit orders. 'close' rules are position-aware: opposite market order sized from the live
    // position (flat -> nothing), read from the platform BOOK (api.trade.book -- no addon-local position copy).
    // AUTO: the watcher-driven automated bracket (pending entry, TP/SL ladder, phase buttons, watch.onFire). It
    // builds its UI into autoPane, owns the PHASE state (the setup data lives in the plan-store), self-wires
    // fill/quote/instrument/rethreshold/units, and exposes active()/syncButtons()/onFlat() for the orchestration below.
    const auto = createAuto(ot, { section, autoPane, visPane });

    // (the pending/levels/visibility/hide UI, the phase machine and watch.onFire live in auto.js)

    // DRAWING STRIPPED: index.js draws NOTHING on the chart. The app overlay owns all on-chart order/position visuals.

    // ---------- streaming wiring ----------  Market data (md) emits 'instrument'/'quote'; auto.js reacts to those
    // (watcher vicinity + feed). Here index rides the market PROJECTION on each quote, using auto.active() as the guard.
    // (the on-chart PROJECTION that rode the live quote is gone -- the app overlay draws the projection now)
    // The trade feed (trade-feed.js) is a pure EVENT bridge (no stores); the REACTIONS live here.
    const tf = createTradeFeed(ot);
    // POSITION reactions are driven by the PLATFORM BOOK -- the same source posOf/phase read -- never by the
    // adapter's event stream: its timing can beat the store mirror in this window, so an event-driven reaction reads
    // a stale book (the "button stuck on Long 3 after flat" race). The store notify IS the truth arriving; react on
    // the open->flat EDGE and resync the buttons on every book change.
    const isOpen = () => { const b = api.trade.book(cfg.broker || '', cfg.symbol); return b.entry != null && b.qty > 0; };
    let wasOpen = isOpen();
    const syncPos = () => {
      const open = isOpen();
      if (!open && wasOpen) auto.onFlat();   // open -> flat edge: strip the auto bracket (the WORKER cancels the resting legs)
      wasOpen = open;
      auto.syncButtons();
    };
    const offBook = [api.positions.subscribe(syncPos), api.positionLots.subscribe(syncPos)];
    ot.on('reseed', () => { wasOpen = isOpen(); auto.syncButtons(); });   // feed re-wired (connect / symbol switch) -> re-baseline the edge + resync
    const wireTrade = () => tf.wire();

    // follow the ACTIVE chart: pull symbol + broker from it, and re-target when the user switches charts
    // or changes a chart's symbol. That is where execution happens, so quotes / DOM / orders all track it.
    const syncFromChart = () => {
      const sym = api.chart.symbol();
      const brk = api.chart.broker() || cfg.broker;   // pane's broker (null = default) -> keep the default
      const changed = (sym && sym !== cfg.symbol) || (brk !== cfg.broker);
      if (sym) cfg.symbol = sym;
      cfg.broker = brk;
      updateHeader();
      if (changed) { md.wireQuote(); wireTrade(); save(); }
    };

    const s0 = api.chart.symbol(); if (s0) cfg.symbol = s0;
    cfg.broker = api.chart.broker() || cfg.broker;
    updateHeader();
    auto.resetPlan();   // fresh slate on (re)start: clear any stale projection so nothing shows until Show pending
    api.chart.onActiveChange(syncFromChart);
    api.chart.onSymbolChange(syncFromChart);
    md.wireQuote(); wireTrade();
    api.onClose(() => {
      md.teardown();   // drop the quote/depth subscriptions + resolve timer
      tf.teardown();   // drop the trade-stream subscription
      offBook.forEach((f) => { try { f(); } catch (_) {} });   // drop the platform-book subscriptions
    });
  },

  /** @param {any} ctx */
  start(ctx) { ctx.log('position-manager ready —', ctx.config); },
  stop() {},
};
