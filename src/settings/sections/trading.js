// @ts-check
// Settings -> Trading section (Tier 3 of the chart-dialog de-monolith). Execution marks: a Style
// sub-tab (dot/tick, thickness, buy/sell colors) and a Visibility sub-tab (per-timeframe show/hide).
// Owns its Style|Visibility sub-tab state locally. Edits the draft; previews live. Imports its deps.
import { TRADES_DEFAULT } from '../../chart/pane.js';
import { buildVisibilityRows } from '../../tools/engine/visibility-ui.js';
import { loadOrderPrimitives, activePrimitiveId, setActivePrimitive, primitiveConfig, savePrimitiveConfig } from '../../chart/order-primitives-config.js';
import { listPrimitives, getPrimitive } from '../../chart/order-view/primitive-registry.js';
import { t as tr } from '../../i18n/i18n.js';   // vocabulary lookup (aliased -- `t` is the trades draft here)

let tradingSubTab = 'Style';   // sub-tab within the Trading section (Style | Visibility | Primitives)
let primLoaded = false;        // order-primitives config fetched (once per window)

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, section, preview, renderContent, checkControl, selectControl, numberControl, colorPicker } = ctx;
  const t = draft.trades || (draft.trades = structuredClone(TRADES_DEFAULT));
  // sub-tabs: Style | Visibility (per-timeframe show/hide, like a drawing's Visibility tab)
  const bar = document.createElement('div'); bar.className = 'sd-subtabs';
  ['Style', 'Visibility', 'Primitives'].forEach((tb) => {
    const b = document.createElement('div'); b.className = 'sd-subtab' + (tb === tradingSubTab ? ' active' : ''); b.textContent = tr(tb);
    b.onclick = () => { tradingSubTab = tb; renderContent(); };
    bar.appendChild(b);
  });
  content.appendChild(bar);

  if (tradingSubTab === 'Visibility') {
    if (!t.visibility) t.visibility = {};
    buildVisibilityRows(t.visibility, preview, 'Show executed trades only on the selected timeframes.').forEach((e) => content.appendChild(e));
    return;
  }
  if (tradingSubTab === 'Primitives') { renderPrimitives(ctx); return; }

  section('APPEARANCE');
  // PER-CHART on-chart position/order display (entry + stop/limit dots + pre-trade plan). Off = this chart shows none
  // of it -- no disconnect/confusion, it is an explicit per-chart choice.
  content.appendChild(checkControl(t, 'showOrders', 'Positions and orders'));
  content.appendChild(checkControl(t, 'visible', 'Execution marks'));
  // 2x2 grid: left column = Style / Thickness, right column = Buy / Sell colours
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;align-items:center;';
  const cell = (/** @type {string} */ label, /** @type {HTMLElement} */ ctrl) => { const c = document.createElement('div'); c.style.cssText = 'display:flex;align-items:center;gap:10px;'; const l = document.createElement('span'); l.style.cssText = 'font-size:13px;flex:1;'; l.textContent = tr(label); c.append(l, ctrl); return c; };
  const styleSel = selectControl(t, 'style', [['dot', 'Dot'], ['tick', 'Tick']]); styleSel.style.width = '60px';
  const thick = numberControl(t, 'thickness', 1, 6); thick.style.width = '42px';
  grid.append(
    cell('Style', styleSel),
    cell('Buy', colorPicker(t, 'buyColor')),
    cell('Thickness', thick),
    cell('Sell', colorPicker(t, 'sellColor')),
  );
  content.appendChild(grid);

  // ORDER PROJECTION: the pre-trade string placement. Bars away = horizontal offset (in bars). Offset = the seeded
  // stop/target distance as a percent of the VISIBLE chart HEIGHT -- screen-relative, so one value is sane on any
  // instrument (no price-unit mess across futures / crypto / forex).
  section('PROJECTION');
  if (content.lastElementChild) /** @type {HTMLElement} */ (content.lastElementChild).style.marginTop = '18px';   // breathing room after the APPEARANCE grid (Thickness)
  const pgrid = document.createElement('div');
  pgrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;align-items:center;';
  const barsIn = numberControl(t, 'projBars', 0, 200); barsIn.style.width = '52px';
  const offIn = numberControl(t, 'projHeightPct', 1, 100); offIn.style.width = '52px';
  pgrid.append(
    cell('Bars away', barsIn),
    cell('Offset (% height)', offIn),
  );
  content.appendChild(pgrid);
}

// Settings > Trading > PRIMITIVES: the GLOBAL on-chart order renderer. A primitive is a display vocabulary for
// the order picture (string-and-beads, pill, ...) registered with the primitive registry; the dropdown picks
// which one EVERY chart renders orders through, and the selected primitive's OWN settings (its renderSettings
// hook, editing its namespace in settings/trading/order-primitives.json) show under it. Changes apply live:
// each pane's order overlay rebuilds its view on any primitives-config change.
/** @param {import('../sd-controls.js').SettingsCtx} ctx */
function renderPrimitives(ctx) {
  const { content, section, renderContent } = ctx;
  if (!primLoaded) {
    const p = document.createElement('div'); p.style.cssText = 'color:var(--tx-dim);font-size:13px;'; p.textContent = tr('Loading…');
    content.appendChild(p);
    loadOrderPrimitives().then(() => { primLoaded = true; renderContent(); });
    return;
  }
  /** @param {string} label @param {HTMLElement} ctrl */
  const row = (label, ctrl) => { const r = document.createElement('div'); r.className = 'sd-row'; const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = tr(label); r.append(l, ctrl); return r; };

  section('PRIMITIVE');
  const sel = document.createElement('select');
  listPrimitives().forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = tr(p.name); sel.appendChild(o); });
  sel.value = activePrimitiveId();
  sel.onchange = () => { setActivePrimitive(sel.value); renderContent(); };
  content.appendChild(row('On-chart orders', sel));

  const prim = getPrimitive(activePrimitiveId());
  section('SETTINGS');
  if (content.lastElementChild) /** @type {HTMLElement} */ (content.lastElementChild).style.marginTop = '16px';
  if (prim && prim.renderSettings) {
    const host = document.createElement('div');
    prim.renderSettings(host, primitiveConfig(prim.id), savePrimitiveConfig);
    content.appendChild(host);
  } else {
    const p = document.createElement('div'); p.style.cssText = 'color:var(--tx-dim);font-size:13px;'; p.textContent = tr('This primitive has no settings.');
    content.appendChild(p);
  }
}
