// @ts-check
// Plus button: a hover affordance pinned to the price-scale edge that follows the
// cursor's price level. Clicking it acts at that price. For now the only action is
// "draw a horizontal line"; the click handler (_act) is the single extension point for
// the future menu (alerts / orders / draw line).
//
// It rides the chart's own crosshair-move event rather than DOM pointer events, so the
// drawing overlay never steals its input, and it shares the engine's price<->pixel mapping.
import { getTool } from '../tools/registry.js';
import { newDrawingSync } from '../tools/toolbar-store.js';
import { getActiveTool } from '../tools/controller.js';
import { PLUS_ACTIONS } from './plus-actions.js';
import { executeCommand } from '../commands/registry.js';
import { command, platform } from '../../data_engine/index.js';   // place -> the order worker (no order logic here)
import { getPlan, setProjecting, setLevels } from '../chart/order-view/plan-store.js';

// How close (px) the cursor must get to the price-scale edge before the "+" reveals itself.
// The "+" rides the scale edge; without this it would pop up for every hover anywhere on the
// chart. Tune to taste.
const EDGE_BAND = 64;

export class PlusButton {
  /** @param {any} pane owning chart pane (external subsystem: chart/series/drawings/settings) */
  constructor(pane) {
    /** @type {any} */
    this.pane = pane;
    this.enabled = false;
    /** @type {number | null} */
    this.price = null;
    this.overBtn = false;
    /** open action menu element, set/cleared in _openMenu/_closeMenu @type {HTMLElement | null} */
    this.menu;
    /** document click-away handler while the menu is open @type {((e: MouseEvent) => void) | null} */
    this._closeCb;
    /** price captured at click/menu-open time @type {number | null} */
    this._actPrice;

    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'plus-btn';
    this.btn.textContent = '+';
    this.btn.style.display = 'none';
    pane.el.appendChild(this.btn);

    this._cb = (/** @type {any} */ param) => this._onCrosshair(param);
    // left click = the user's default action; right click = the full action menu.
    this.btn.onclick = (e) => { e.stopPropagation(); this._runDefault(); };
    this.btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this._openMenu(); };
    this.btn.onpointerenter = () => { this.overBtn = true; if (this.price != null) this.btn.style.display = 'flex'; };
    this.btn.onpointerleave = () => { this.overBtn = false; this._hide(); };
  }

  /** @param {any} on */
  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.pane.chart.onCursorMove(this._cb);
    else { try { this.pane.chart.offCursorMove(this._cb); } catch (_) {} this._hide(); }
  }

  /** @param {any} param crosshair-move event payload from the chart engine */
  _onCrosshair(param) {
    // hidden while a drawing tool is armed (that hover is for drawing, not for this)
    const drawing = getActiveTool() && getActiveTool() !== 'cursor';
    if (!param || !param.point || drawing) { if (!this.overBtn) this._hide(); return; }
    // Respond ONLY to a genuine pointer hover of this pane, and place the + at the RAW pointer
    // position. Programmatic crosses -- the live-data redraw re-emitting the cursor, cross-pane
    // crosshair sync, a standing forced cross -- fire with no real sourceEvent and carry the
    // snapped/synced y. Acting on them made the + fight the pointer: the + lives outside the chart
    // root, so hovering it fires the root's mouseleave -> the engine falls back to the forced cross
    // (e.g. a drawn line) -> the + jumps to the line, leaves the cursor, mouse re-enters the canvas,
    // the + snaps back -> jitter forever. So bail on any cross that isn't a real DOM move; the + stays
    // put under the cursor (also immune to the magnet snap, which only rides the crosshair's y).
    const se = param.sourceEvent;
    if (!se || typeof se.clientY !== 'number') return;
    const rect = this.pane.el.getBoundingClientRect();
    const x = se.clientX - rect.left, y = se.clientY - rect.top;
    const left = !!this.pane.settings.scaleLeft;
    let psW = 0;
    try { psW = this.pane.chart.priceAxis(left ? 'left' : 'right').width(); } catch (_) {}
    // the "+" sits on the price-scale edge; only reveal it when the cursor approaches that
    // edge, not for every hover across the chart body.
    const edgeX = left ? psW : this.pane.el.clientWidth - psW;
    const nearEdge = left ? (x <= edgeX + EDGE_BAND) : (x >= edgeX - EDGE_BAND);
    if (!nearEdge) { if (!this.overBtn) this._hide(); return; }
    const price = this.pane.series.yToPrice(y);
    if (price == null) { if (!this.overBtn) this._hide(); return; }
    this.price = price;
    this.btn.title = 'Draw horizontal line at ' + this._fmt(price);
    this.btn.style.top = y + 'px';
    this.btn.style.left = edgeX + 'px';
    this.btn.style.display = 'flex';
  }

  _hide() { this.btn.style.display = 'none'; }

  /** @param {number} p @returns {string} */
  _fmt(p) {
    const d = this.pane.priceDecimals || 2;
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Left click: run the user's chosen default action at the hovered price.
  _runDefault() {
    if (this.price == null) return;
    this._actPrice = this.price;
    const id = this.pane.settings.plusDefaultAction || (PLUS_ACTIONS[0] && PLUS_ACTIONS[0].id);
    this._dispatch(id);
  }

  // Map an action id to its behavior. Extension point: add a case per new action.
  /** @param {string} [id] */
  _dispatch(id) {
    if (id === 'hline') this._drawLine();
    else if (id === 'alert') this._addAlert();
  }

  // Action: add a price alert at the captured price (via the shared alert.add command).
  _addAlert() {
    if (this._actPrice == null || !this.pane.drawings) return;
    executeCommand('alert.add', { pane: this.pane, price: this._actPrice });
    this._hide();
  }

  // Order entries for the captured price. Which pair shows depends on the
  // side of the market: clicking ABOVE the last price offers Buy stop + Sell limit (both rest
  // above), clicking BELOW offers Buy limit + Sell stop. They place IMMEDIATELY via the order
  // worker; the user then adjusts the resting order on the chart. Plus an "Add order" entry
  // that opens the order ticket with the price prefilled. Needs a connected broker + symbol
  // and a last bar to compare against, else the menu stays alerts/drawings only.
  /** @param {string} priceStr @returns {{ icon: string, label: string, key: string, run: () => void }[]} */
  _orderActions(priceStr) {
    const p = this.pane;
    const last = p.lastBar ? Number(p.lastBar.close) : NaN;
    if (!p.broker || !p.symbol || this._actPrice == null || !Number.isFinite(last)) return [];
    const qty = Number(getPlan(p.broker, p.symbol).qty) || 1;
    const above = this._actPrice >= last;
    /** @param {'buy'|'sell'} side @param {'limit'|'stop'} orderType */
    const mk = (side, orderType) => ({
      icon: side === 'buy' ? '↑' : '↓',
      label: (side === 'buy' ? 'Buy ' : 'Sell ') + qty + ' ' + p.symbol + ' @ ' + priceStr + ' ' + orderType,
      key: '',
      run: () => this._placeOrder(side, orderType, qty),
    });
    const rows = above ? [mk('sell', 'limit'), mk('buy', 'stop')] : [mk('buy', 'limit'), mk('sell', 'stop')];
    rows.push({ icon: '⊞', label: 'Add order on ' + p.symbol + ' at ' + priceStr + '…', key: '', run: () => this._projectOrder() });
    return rows;
  }

  // Action: place a resting order at the captured price, snapped to the instrument tick.
  // Fire-and-forget from here -- the worker journals the send, the book confirms, and the
  // on-chart order overlay picks it up for adjusting. Failures land in the Console.
  /** @param {'buy'|'sell'} side @param {'limit'|'stop'} orderType @param {number} qty */
  _placeOrder(side, orderType, qty) {
    const p = this.pane;
    const t = Number(p.tickSize) || 0;
    const raw = Number(this._actPrice);
    const price = t > 0 ? Number((Math.round(raw / t) * t).toPrecision(12)) : raw;
    command({ type: 'place', ctx: { broker: p.broker, symbol: p.symbol }, side, qty, orderType, price, tif: 'gtc' })
      .then((/** @type {any} */ r) => { if (!r || !r.ok) platform.console.post({ level: 'error', cat: 'journal', src: 'app', msg: '+ ' + side + ' ' + orderType + ' rejected: ' + ((r && r.error) || 'unknown') }); })
      .catch((/** @type {any} */ e) => platform.console.post({ level: 'error', cat: 'journal', src: 'app', msg: '+ ' + side + ' ' + orderType + ' failed: ' + ((e && e.message) || e) }));
    this._hide();
  }

  // Action: start an on-chart order PROJECTION at the captured price -- the configurable pill
  // (plan-store), NOT a live order. The user then sets it up right on the chart: the pill's
  // cells pick side (B/S), type, qty; dragging moves the price; V places it, X drops it.
  // Seeded as a limit at the clicked level; nothing is sent until the user confirms.
  _projectOrder() {
    const p = this.pane;
    if (!p.symbol || this._actPrice == null) return;
    const t = Number(p.tickSize) || 0;
    const raw = Number(this._actPrice);
    const price = t > 0 ? Number((Math.round(raw / t) * t).toPrecision(12)) : raw;
    setProjecting(p.broker, p.symbol, true);
    setLevels(p.broker, p.symbol, { ref: price, orderType: 'limit' });
    this._hide();
  }

  // Right click: open the full action menu anchored to the +. The price is captured at
  // open time so the chosen action acts on the level clicked, not wherever the cursor drifts.
  _openMenu() {
    if (this.price == null) return;
    this._closeMenu();
    const priceStr = this._fmt(this.price);
    this._actPrice = this.price;
    // Order: order actions (Buy/Sell/Add order) -- divider -- Draw horizontal line -- Add alert (last).
    /** @param {string} id */
    const actionRow = (id) => { const a = PLUS_ACTIONS.find((x) => x.id === id); return a ? { icon: a.icon || '', label: a.name + ' at ' + priceStr, key: a.hotkey || '', run: () => this._dispatch(a.id) } : null; };
    const orderRows = this._orderActions(priceStr);
    const rows = [
      ...orderRows,
      ...(orderRows.length ? [{ divider: true }] : []),   // separate the order stuff from the draw/alert group
      actionRow('hline'),
      actionRow('alert'),
    ].filter(Boolean);
    const menu = document.createElement('div');
    menu.className = 'plus-menu';
    rows.forEach((a) => {
      if (/** @type {any} */ (a).divider) { const d = document.createElement('div'); d.className = 'plus-menu-div'; menu.appendChild(d); return; }
      const row = document.createElement('div');
      row.className = 'plus-menu-item';
      row.innerHTML = '<span class="pm-ico"></span><span class="pm-label"></span><span class="pm-key"></span>';
      /** @type {HTMLElement} */ (row.querySelector('.pm-ico')).textContent = /** @type {any} */ (a).icon;
      /** @type {HTMLElement} */ (row.querySelector('.pm-label')).textContent = /** @type {any} */ (a).label;
      /** @type {HTMLElement} */ (row.querySelector('.pm-key')).textContent = /** @type {any} */ (a).key;
      row.onclick = (e) => { e.stopPropagation(); this._closeMenu(); /** @type {any} */ (a).run(); };
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    this.menu = menu;
    const r = this.btn.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.left - mw - 6;                 // open to the left of the + (it sits at the right edge)
    if (left < 6) left = r.right + 6;           // flip right if no room
    let top = Math.max(6, Math.min(r.top - mh / 2, window.innerHeight - mh - 6));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    this._closeCb = (e) => { if (this.menu && !this.menu.contains(/** @type {Node} */ (e.target)) && e.target !== this.btn) this._closeMenu(); };
    setTimeout(() => document.addEventListener('click', /** @type {EventListener} */ (this._closeCb)), 0);
  }

  _closeMenu() {
    if (this.menu) { this.menu.remove(); this.menu = null; }
    if (this._closeCb) { document.removeEventListener('click', this._closeCb); this._closeCb = null; }
  }

  // Action: draw a horizontal line at the captured price (via the shared drawing.add command).
  // The caller resolves the time/style/sync context; the command fills any unspecified defaults.
  _drawLine() {
    if (this._actPrice == null || !this.pane.drawings) return;
    const tool = getTool('hline');
    const time = this.pane.lastBar ? this.pane.lastBar.time
      : (this.pane.barTimes && this.pane.barTimes.length ? this.pane.barTimes[this.pane.barTimes.length - 1] : null);
    if (time == null) return;
    executeCommand('drawing.add', {
      pane: this.pane,
      tool: 'hline',
      points: [{ time, price: this._actPrice }],
      style: { ...(tool ? tool.defaultStyle : {}) },
      sync: newDrawingSync(),
    });
    this._hide();
  }

  destroy() { this.setEnabled(false); this._closeMenu(); this.btn.remove(); }
}
