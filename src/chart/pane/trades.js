// @ts-check
// Executed-trades overlay for a Pane: buy/sell fills drawn INSIDE the candle at the fill price (a
// bar-wide tick or a lollipop dot), grouped per candle+side+price, with a hover tooltip. Fetches
// history once per symbol + subscribes to live fills (brokers that report fills provide these; others no-op). Split
// out of pane.js as a prototype mixin -- these methods run with `this` bound to the Pane instance.
import { barMs } from '../../workspace/timeframes.js';
import { visibleOnTf } from '../../tools/engine/visibility.js';
import { readableText } from '../pane-defaults.js';

// A broker fill as this overlay consumes it: the contract Fill plus the adapter's optional contractId
// (when the adapter reports it; it's the roll-proof key `_isMyFill` prefers over symbol). Not on the base contract.
/** @typedef {import('/data_engine/index.js').Fill & { contractId?: string|number }} TradeFill */
// The Trading > "Trades on chart" settings block this mixin reads (Settings > Trading).
/**
 * @typedef {Object} TradeSettings
 * @property {boolean} visible
 * @property {string} buyColor @property {string} sellColor
 * @property {number} thickness
 * @property {string} style             'dot' | 'tick'
 * @property {any} [visibility]         per-timeframe visibility model (see visibleOnTf)
 * @property {boolean} [showOrders]     PER-CHART on-chart position/order display (Trading > Positions and orders)
 * @property {number} [projBars]        pre-trade string offset in bars
 * @property {number} [projHeightPct]   pre-trade stop/target seed as a percent of visible chart height
 */
// One rendered group: all same-price fills in one candle+side, summed. `time` is the containing-bar
// timestamp in ms (the candle's centre axis).
/**
 * @typedef {{ side: any, price: number, qty: number, time: number }} TradeGroup
 */
// The Pane surface this mixin drives via `this`. Engine handles (_series/series/chart plot handles)
// and the broker adapter (api()) are the `any` boundary; the fills list + settings are typed.
/**
 * @typedef {Object} TradesCtx
 * @property {any} _series              engine candle series (null on board/oscillator panes)
 * @property {any} series               engine plot handle (priceToY)
 * @property {{ trades: TradeSettings, canvas?: { background?: string } }} settings
 * @property {string} symbol
 * @property {string|number|null} contractId
 * @property {boolean} destroyed
 * @property {string=} _tradeSym        symbol the current history/subscription is for
 * @property {TradeFill[]} _trades
 * @property {((ev: any) => void)|null} _tradeCb    live-fill subscription callback
 * @property {HTMLDivElement=} _tradeTip
 * @property {HTMLElement} el
 * @property {number|null} priceDecimals
 * @property {() => any} api            this pane's broker adapter (or null)
 * @property {() => any} tf             active timeframe descriptor ({ unit, n }) or undefined
 * @property {(t?: TradeSettings) => void} _updateTrades
 * @property {() => void} _startTradeFeed
 * @property {() => void} _stopTradeFeed
 * @property {(t?: TradeSettings) => void} _renderTradeMarkers
 * @property {(f: any) => boolean} _isMyFill
 * @property {() => TradeGroup[]} _tradeGroups
 * @property {(point: { x: number, y: number }, g: TradeGroup) => void} _showTradeTip
 * @property {() => void} _hideTradeTip
 */

export const tradesMethods = {
  /** @this {TradesCtx} */
  applyTrades() {
    this._updateTrades(this.settings.trades);
    const ov = /** @type {any} */ (this).orderView;
    if (ov) ov.setEnabled(this.settings.trades.showOrders !== false);
  },
  /** @this {TradesCtx} @param {TradeSettings} t */
  previewTrades(t) {
    this._updateTrades(t);
    const ov = /** @type {any} */ (this).orderView;
    if (ov) ov.setEnabled(!t || t.showOrders !== false);
  },
  /** @this {TradesCtx} @param {TradeSettings} [t] */
  _updateTrades(t) {
    if (!this._series) return; // board / oscillator pane: no candle series to mark
    t = t || this.settings.trades;
    if (!t || !t.visible) {
      this._stopTradeFeed();
      try {
        this._series.setMarkers([]);
      } catch (_) {}
      return;
    }
    this._startTradeFeed(); // idempotent: history fetch + live subscription for this.symbol
    this._renderTradeMarkers(t);
  },
  // fetch past fills once per symbol + subscribe to live fills (brokers that report fills provide these;
  // others no-op gracefully). Fills carry the symbol, so we filter the account-wide feed to this pane's.
  /** @this {TradesCtx} */
  _startTradeFeed() {
    const api = this.api();
    if (!api || !this.symbol) return;
    if (this._tradeSym !== this.symbol) {
      this._tradeSym = this.symbol;
      this._trades = [];
      // some brokers cap historical-orders requests at 30 days back -- ask for 29 to stay safely inside
      // it, or the whole request errors out.
      if (api.getHistory)
        api.getHistory({ fromMs: Date.now() - 29 * 86400000 }, (/** @type {any} */ fills) => {
          if (this.destroyed || this._tradeSym !== this.symbol || !Array.isArray(fills)) return;
          // MERGE the history with any LIVE fills already pushed during the fetch -- never overwrite. An
          // empty or lagging history would otherwise wipe a just-executed fill that already rendered (the
          // mark appears, then vanishes when getHistory returns). Dedup by fill id, else a composite key.
          const hist = fills.filter((/** @type {any} */ f) => this._isMyFill(f));
          /** @param {any} f @returns {string} */
          const keyOf = (f) =>
            f && f.id != null
              ? 'id:' + f.id
              : [f && f.contractId, f && f.time, f && f.side, f && f.price, f && f.qty].join('|');
          /** @type {Set<string>} */
          const seen = new Set();
          /** @type {TradeFill[]} */
          const merged = [];
          for (const f of hist.concat(this._trades || [])) {
            const k = keyOf(f);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(f);
          }
          this._trades = merged;
          this._renderTradeMarkers(this.settings.trades);
        });
    }
    if (!this._tradeCb && api.subscribeTrade) {
      this._tradeCb = (/** @type {any} */ ev) => {
        if (this.destroyed || !ev || ev.kind !== 'fill' || !ev.fill || !this._isMyFill(ev.fill)) return;
        this._trades.push(ev.fill);
        if (this.settings.trades && this.settings.trades.visible) this._renderTradeMarkers(this.settings.trades);
      };
      api.subscribeTrade(this._tradeCb);
    }
  },
  /** @this {TradesCtx} */
  _stopTradeFeed() {
    const api = this.api();
    if (this._tradeCb && api && api.unsubscribeTrade) {
      try {
        api.unsubscribeTrade(this._tradeCb);
      } catch (_) {}
    }
    this._tradeCb = null;
  },
  // a fill is this pane's if its contract matches (exact, roll-proof) or, failing that, its symbol.
  // History for unresolved contracts reports symbol as "contract N", so contractId is the reliable key.
  /** @this {TradesCtx} @param {any} f @returns {boolean} */
  _isMyFill(f) {
    if (!f) return false;
    if (f.contractId != null && this.contractId != null) return f.contractId === this.contractId;
    return f.symbol === this.symbol;
  },
  // Group fills by the CANDLE that contains them + side + price: each group is one ball placed at the
  // bar's centre time (so every execution in a candle lines up on its vertical centre axis) at the fill
  // price. Same-price fills in one candle sum their qty into a single ball (qty shown on hover).
  /** @this {TradesCtx} @returns {TradeGroup[]} */
  _tradeGroups() {
    const tf = this.tf();
    const bar = tf ? barMs(tf) : 60000;
    /** @type {Map<string, TradeGroup>} */
    const map = new Map();
    for (const f of this._trades || []) {
      if (!f || f.price == null || !f.time) continue;
      const bt = Math.floor(f.time / bar) * bar; // containing-bar timestamp (ms) -> candle centre
      const key = bt + '|' + f.side + '|' + f.price;
      const g = map.get(key);
      if (g) g.qty += f.qty || 0;
      else map.set(key, { side: f.side, price: f.price, qty: f.qty || 0, time: bt });
    }
    return [...map.values()];
  },
  // Draw executions INSIDE the candle at the exact fill price: a horizontal tick spanning the bar
  // width (clean for scalers), or a lollipop dot. Info shows on hover (see _hoverTrade), not as
  // always-on labels -- that was the clutter. Arrows above the candle are gone.
  /** @this {TradesCtx} @param {TradeSettings} [t] */
  _renderTradeMarkers(t) {
    if (!this._series) return;
    t = t || this.settings.trades;
    // per-timeframe visibility (Settings > Trading > Visibility) -- hide the marks on TFs outside range
    if (!visibleOnTf({ visibility: t.visibility }, this.tf())) {
      try {
        this._series.setMarkers([]);
      } catch (_) {}
      return;
    }
    const dot = t.style === 'dot';
    const th = Math.max(1, t.thickness || 2);
    const markers = this._tradeGroups()
      .map((g) => {
        const buy = g.side !== 'sell';
        return {
          time: Math.round(g.time / 1000), // fills are in ms; the engine's markers use seconds
          price: g.price,
          shape: dot ? 'circle' : 'tick',
          color: buy ? t.buyColor : t.sellColor,
          size: dot ? th * 3 + 4 : undefined, // dot diameter
          lineWidth: th, // tick thickness
        };
      })
      .filter((m) => m.time && m.price != null);
    try {
      this._series.setMarkers(markers);
    } catch (_) {}
  },

  // hover an execution tick -> a small tooltip (side, qty, price, time). Matches the hovered bar
  // (param.time) + the cursor y against each group's price, so it works even with many fills.
  /** @this {TradesCtx} @param {any} param   engine cursor-move param ({ time, point }) */
  _hoverTrade(param) {
    const t = this.settings.trades;
    if (!t || !t.visible || !this._series || !param || param.time == null || !param.point) {
      this._hideTradeTip();
      return;
    }
    if (!visibleOnTf({ visibility: t.visibility }, this.tf())) {
      this._hideTradeTip();
      return;
    }
    const tf = this.tf();
    const bar = tf ? barMs(tf) : 60000;
    const cursorBar = Math.floor((param.time * 1000) / bar) * bar,
      cy = param.point.y;
    /** @type {TradeGroup|null} */
    let best = null;
    let bestDy = 8; // px tolerance in y
    for (const g of this._tradeGroups()) {
      if (g.time !== cursorBar) continue; // only marks in the hovered candle
      /** @type {number|null} */
      let y = null;
      try {
        y = this.series.priceToY(g.price);
      } catch (_) {}
      if (y == null) continue;
      const dy = Math.abs(cy - y);
      if (dy < bestDy) {
        bestDy = dy;
        best = g;
      }
    }
    if (best) this._showTradeTip(param.point, best);
    else this._hideTradeTip();
  },
  /** @this {TradesCtx} @param {{ x: number, y: number }} point @param {TradeGroup} g */
  _showTradeTip(point, g) {
    if (!this._tradeTip) {
      this._tradeTip = document.createElement('div');
      this._tradeTip.className = 'trade-tip';
      this.el.appendChild(this._tradeTip);
    }
    const dec = this.priceDecimals != null ? this.priceDecimals : 2;
    const buy = g.side !== 'sell';
    const side = buy ? this.settings.trades.buyColor : this.settings.trades.sellColor;
    const when = new Date(g.time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    // match the chart's own background (theme), with a contrast-picked text colour
    const bg = (this.settings.canvas && this.settings.canvas.background) || '#1e222d';
    const fg = readableText(bg);
    this._tradeTip.style.background = bg;
    this._tradeTip.style.color = fg;
    this._tradeTip.style.borderColor = side;
    this._tradeTip.innerHTML =
      '<b style="color:' +
      side +
      '">' +
      (buy ? 'BUY' : 'SELL') +
      '</b> ' +
      g.qty +
      ' @ ' +
      Number(g.price).toFixed(dec) +
      '<br><span class="tt-time" style="color:' +
      fg +
      ';opacity:.65">' +
      when +
      '</span>';
    const w = 150;
    this._tradeTip.style.left = Math.max(2, Math.min(this.el.clientWidth - w, point.x + 12)) + 'px';
    this._tradeTip.style.top = Math.max(2, point.y - 40) + 'px';
    this._tradeTip.style.display = 'block';
  },
  /** @this {TradesCtx} */
  _hideTradeTip() {
    if (this._tradeTip) this._tradeTip.style.display = 'none';
  },
};
