// @ts-check
// Alert markers — the alert engine's OWN on-chart layer (NOT a drawing). A kapelka series primitive that
// renders every PRICE-LEVEL alert for this pane's symbol: the ones with no chart object (objectId null) —
// quick "Add alert at <price>" and the Value alerts added from the manager's "+". Each is drawn as a dashed
// line across the plot + a bell badge pinned at the price-scale edge + a native price tag in the scale, is
// DRAGGABLE up/down to change its level (committed on release), and on hover shows a centred
// "SYMBOL Crossing PRICE" pill with a trash button for QUICK DELETE.
//
// It reads the engine store (alertMirror) live and repaints on any change; drawing-ANCHORED alerts are marked
// instead by the bell badge on their drawing (tools/engine/primitive.js), never here. Style comes from the
// per-chart Alert appearance settings (Settings > Alerts): alertColor / alertWidth / alertDash / alertLabel.
import { alertMirror } from './store.js';
import { alertCommand } from './funnel.js';
import { levelOf, opOf, withLevel } from './alert-record.js';   // pure record accessors + the set-level/re-arm mutation (schema's one home)
import { confirmDialog } from '../ui/confirm.js';   // confirm before a quick-delete (same guard the manager panel uses)
import { t } from '../i18n/i18n.js';

const BADGE_R = 9;    // bell badge radius (px)
const DRAG_TOL = 6;   // px from a line to be "over" it (grab to drag / show the hover pill)

/** dash pattern for the marker line. @param {string} dash @returns {number[]} */
function dashOf(dash) { if (dash === 'solid') return []; if (dash === 'dotted') return [1, 2]; return [4, 4]; }

/** a live theme CSS variable value (so the hover pill follows the user's theme). @param {string} name @param {string} fallback */
function themeColor(name, fallback) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch (_) { return fallback; }
}

/** a small green bell badge centered at (x, y) — same glyph as the drawing alert badge. @param {any} c @param {number} x @param {number} y */
function drawBadge(c, x, y) {
  const r = BADGE_R, s = 3.4;
  c.save();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = '#2fa572'; c.fill();
  c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
  c.fillStyle = '#fff'; c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(x - s, y + s * 0.7);
  c.lineTo(x + s, y + s * 0.7);
  c.lineTo(x + s * 0.72, y + s * 0.1);
  c.lineTo(x + s * 0.72, y - s * 0.4);
  c.arc(x, y - s * 0.4, s * 0.72, 0, Math.PI, true);
  c.lineTo(x - s * 0.72, y + s * 0.1);
  c.closePath(); c.fill();
  c.beginPath(); c.arc(x, y - s * 1.2, s * 0.28, 0, Math.PI * 2); c.fill();   // top nub
  c.beginPath(); c.arc(x, y + s * 1.0, s * 0.34, 0, Math.PI); c.fill();       // clapper
  c.restore();
}

/** a small trash-can glyph centered at (cx, cy). @param {any} c @param {number} cx @param {number} cy @param {string} color */
function drawTrash(c, cx, cy, color) {
  c.save();
  c.strokeStyle = color; c.lineWidth = 1; c.lineJoin = 'round'; c.lineCap = 'round';
  const w = 9, h = 10, x0 = cx - w / 2, y0 = cy - h / 2;
  c.beginPath(); c.moveTo(x0 - 1, y0 + 2); c.lineTo(x0 + w + 1, y0 + 2); c.stroke();                                   // lid
  c.beginPath(); c.moveTo(x0 + w * 0.32, y0 + 2); c.lineTo(x0 + w * 0.32, y0); c.lineTo(x0 + w * 0.68, y0); c.lineTo(x0 + w * 0.68, y0 + 2); c.stroke();   // handle
  c.beginPath(); c.moveTo(x0 + 0.5, y0 + 2); c.lineTo(x0 + 1.5, y0 + h); c.lineTo(x0 + w - 1.5, y0 + h); c.lineTo(x0 + w - 0.5, y0 + 2); c.stroke();       // body
  c.beginPath();                                                                                                        // ribs
  c.moveTo(cx - 2, y0 + 4); c.lineTo(cx - 2, y0 + h - 1);
  c.moveTo(cx, y0 + 4); c.lineTo(cx, y0 + h - 1);
  c.moveTo(cx + 2, y0 + 4); c.lineTo(cx + 2, y0 + h - 1);
  c.stroke();
  c.restore();
}

/**
 * Build the alert-marker primitive for one pane. Attach with `series.addLayer(...)`.
 * @param {any} pane
 */
export function createAlertPrimitive(pane) {
  /** @type {any} */ let chart = null;
  /** @type {any} */ let series = null;
  /** @type {(() => void)|null} */ let requestUpdate = null;
  /** @type {(() => void)|null} */ let unsub = null;
  /** @type {{ id: string, level: number, op: string }[]} */ let list = [];
  let style = { color: '#f5a623', width: 1, dash: 'dashed', label: true };

  // drag + hover state
  let dragId = '';                                   // alert being dragged
  /** @type {{ id: string, level: number }|null} */ let dragPreview = null;   // live level during a drag (not yet committed)
  let hoverId = '';                                  // alert line grabbable under the cursor (drag zone)
  let activeId = '';                                 // alert whose hover pill is shown (wider zone)
  let overTrash = false;                             // cursor is over the pill's trash button
  /** @type {{ id: string, x0: number, y0: number, x1: number, y1: number }|null} */ let trashRect = null;   // last-drawn trash hit box
  /** @type {{ id: string, x0: number, y0: number, x1: number, y1: number }|null} */ let pillRect = null;     // last-drawn pill bounds (keep it open while hovered)
  let scrollLocked = false;
  /** @type {{ move: any, down: any, up: any, click: any, leave: any }|null} */ let handlers = null;

  const decimals = () => (pane && pane.priceDecimals != null ? pane.priceDecimals : 2);
  const round = (/** @type {number} */ v) => Number(Number(v).toFixed(decimals()));
  const rootEl = () => { try { return chart.rootEl(); } catch (_) { return null; } };
  const psWidth = () => { try { return series.priceAxis().width(); } catch (_) { return 0; } };
  const yOf = (/** @type {number} */ lvl) => (series ? series.priceToY(lvl) : null);

  // recompute the style + the marker list for the current frame (run each updateAllViews)
  const refresh = () => {
    const S = (pane && pane.settings) || {};
    style = { color: S.alertColor || '#f5a623', width: S.alertWidth || 1, dash: S.alertDash || 'dashed', label: S.alertLabel !== false };
    const sym = pane && pane.symbol;
    list = [];
    for (const a of alertMirror().all()) {
      if (!a || a.objectId || (a.symbol && a.symbol !== sym)) continue;   // only OBJECT-LESS (price-level) alerts
      const lvl = levelOf(a);
      if (lvl != null) list.push({ id: a.id, level: lvl, op: opOf(a) });
    }
    const dp = dragPreview;
    if (dp) list = list.map((a) => (a.id === dp.id ? { ...a, level: dp.level } : a));   // live drag
  };

  // id of the alert line within `tol` px of screen-y (reads the store directly for hit-testing)
  /** @param {number} y @param {number} tol @returns {string} */
  const nearestLineId = (y, tol) => {
    const sym = pane && pane.symbol;
    let best = '', bd = tol;
    for (const a of alertMirror().all()) {
      if (!a || a.objectId || (a.symbol && a.symbol !== sym)) continue;
      const lvl = levelOf(a); if (lvl == null) continue;
      const ly = yOf(lvl); if (ly == null) continue;
      const dist = Math.abs(y - ly); if (dist <= bd) { bd = dist; best = a.id; }
    }
    return best;
  };

  /** @param {boolean} on */
  const setScroll = (on) => { if (on === scrollLocked || !chart) return; scrollLocked = on; try { chart.configure({ handleScroll: !on, handleScale: !on }); } catch (_) {} };
  // cursor: ns-resize over a grabbable line, pointer over the trash button (both beat the engine's inline cursor via !important)
  const paintCursor = () => { const el = rootEl(); if (!el) return; try { el.classList.toggle('alert-cursor-ns', !!hoverId && !overTrash); el.classList.toggle('alert-cursor-pointer', overTrash); } catch (_) {} };

  // commit a dragged alert's new level to the engine -- withLevel (alert-record) owns the "set level + re-arm" mutation.
  /** @param {string} id @param {number} lvl */
  const commitLevel = (id, lvl) => {
    const a = alertMirror().all().find((/** @type {any} */ x) => x && x.id === id);
    if (!a) return;
    alertCommand('update', { id, patch: withLevel(a, lvl) }).catch(() => {});
  };

  // the hover pill: "SYMBOL Op PRICE" + a trash button, centred on the plot at the line's y. Records the trash
  // hit box (media coords == chart-root coords for the main pane) so the mouse handlers can target it.
  /** @param {any} c @param {number} W @param {number} H @param {{ id: string, level: number, op: string }} a */
  const drawPill = (c, W, H, a) => {
    const sym = (pane && pane.symbol) || '';
    let priceStr; try { priceStr = series.formatPrice().format(a.level); } catch (_) { priceStr = String(a.level); }
    const text = `${sym} ${t(a.op)} ${priceStr}`;
    c.save();
    c.font = '12px sans-serif';
    const tw = c.measureText(text).width;
    const padX = 9, gap = 8, trashW = 12, pillH = 20;
    const pillW = padX + tw + gap + trashW + padX;
    const y = yOf(a.level); if (y == null) { c.restore(); return; }
    const cy = Math.max(pillH / 2 + 1, Math.min(H - pillH / 2 - 1, y));
    const px0 = Math.round(W / 2 - pillW / 2), py0 = Math.round(cy - pillH / 2);
    const bg = themeColor('--panel', '#ffffff'), fg = themeColor('--tx', '#131722'), bd = themeColor('--bd', '#c8cbd0'), hov = themeColor('--hover', '#eef0f3');
    // body
    c.beginPath(); c.roundRect(px0, py0, pillW, pillH, 4);
    c.fillStyle = bg; c.fill(); c.strokeStyle = bd; c.lineWidth = 1; c.stroke();
    // text
    c.fillStyle = fg; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText(text, px0 + padX, cy + 0.5);
    // trash button (hover highlight when over it)
    const tcx = px0 + padX + tw + gap + trashW / 2;
    const tx0 = px0 + padX + tw + gap - 3, tx1 = tx0 + trashW + 6;
    if (overTrash && activeId === a.id) { c.beginPath(); c.roundRect(tx0, py0 + 2, tx1 - tx0, pillH - 4, 3); c.fillStyle = hov; c.fill(); }
    drawTrash(c, tcx, cy, fg);
    c.restore();
    trashRect = { id: a.id, x0: tx0, y0: py0, x1: tx1, y1: py0 + pillH };
    pillRect = { id: a.id, x0: px0, y0: py0, x1: px0 + pillW, y1: py0 + pillH };
  };

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      /** @param {any} target */
      draw: (target) => target.useMediaCoordinateSpace((/** @type {any} */ scope) => {
        const c = scope.context;
        const W = scope.mediaSize.width, H = scope.mediaSize.height;
        list.forEach((a) => {
          const y = series && series.priceToY(a.level);
          if (y == null) return;
          c.save();
          c.strokeStyle = style.color; c.lineWidth = style.width; c.setLineDash(dashOf(style.dash));
          c.beginPath(); c.moveTo(0, y); c.lineTo(W - (BADGE_R * 2 + 4), y); c.stroke();   // stop short of the badge
          c.restore();
          const by = Math.max(BADGE_R + 2, Math.min(H - BADGE_R - 2, y));                   // clamp badge on-plot
          drawBadge(c, W - (BADGE_R + 4), by);
        });
        // hover pill on top (hidden while dragging)
        trashRect = null; pillRect = null;
        if (!dragId && activeId) { const a = list.find((x) => x.id === activeId); if (a) drawPill(c, W, H, a); }
      }),
    }),
  };

  // a native price-axis tag per alert (like a price line's label), colored to match the marker line
  /** @param {{ level: number }} a */
  const axisView = (a) => ({
    coordinate: () => (series ? (series.priceToY(a.level) ?? -100) : -100),
    text: () => { try { return series.formatPrice().format(a.level); } catch (_) { return String(a.level); } },
    textColor: () => '#ffffff', backColor: () => style.color, visible: () => true, tickVisible: () => true,
  });

  // ---- pointer: drag a line to move, click the trash to delete ----
  /** @param {MouseEvent} e @returns {number|null} screen-x relative to the chart root */
  const posX = (e) => { const el = rootEl(); if (!el) return null; return e.clientX - el.getBoundingClientRect().left; };
  /** @param {MouseEvent} e @returns {number|null} screen-y relative to the chart root */
  const posY = (e) => { const el = rootEl(); if (!el) return null; return e.clientY - el.getBoundingClientRect().top; };
  /** @param {MouseEvent} e @returns {boolean} is the cursor over the price scale */
  const overScale = (e) => { const el = rootEl(); if (!el) return false; return (el.clientWidth - psWidth() - (e.clientX - el.getBoundingClientRect().left)) < 0; };
  /** cursor within a recorded rect. @param {{x0:number,y0:number,x1:number,y1:number}|null} r @param {number|null} x @param {number|null} y */
  const inRect = (r, x, y) => !!(r && x != null && y != null && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  const onMove = (/** @type {MouseEvent} */ e) => {
    if (!series) return;
    const y = posY(e); if (y == null) return;
    if (dragId) {                                    // dragging -> preview the new level at the cursor
      const price = series.yToPrice(y);
      if (price != null) { dragPreview = { id: dragId, level: round(price) }; if (requestUpdate) requestUpdate(); }
      return;
    }
    const x = posX(e), scale = overScale(e);
    const prevHover = hoverId, prevActive = activeId, prevTrash = overTrash;
    hoverId = scale ? '' : nearestLineId(y, DRAG_TOL);   // "over" the line = within a few px of it
    // show the pill only when OVER a line; keep it open while the cursor is over the pill itself (to reach the trash)
    if (hoverId) activeId = hoverId;
    else if (!(activeId && pillRect && pillRect.id === activeId && inRect(pillRect, x, y))) activeId = '';
    overTrash = inRect(trashRect, x, y) && !!activeId && !!trashRect && trashRect.id === activeId;
    setScroll(!!hoverId);                             // lock chart pan over a line so a press starts a drag
    paintCursor();
    // repaint so the pill shows/hides -- only on a hover-state TRANSITION. The pill/trash paint is a
    // pure function of (hoverId, activeId, overTrash); requesting a full repaint on every pointer
    // move re-rendered the entire pane per move and defeats the chart's cursor-only fast path.
    if (requestUpdate && (hoverId !== prevHover || activeId !== prevActive || overTrash !== prevTrash)) requestUpdate();
  };
  const onDown = () => { if (overTrash) return; if (hoverId) dragId = hoverId; };   // over the trash -> let click delete
  const onUp = () => {
    if (!dragId) return;
    if (dragPreview) commitLevel(dragId, dragPreview.level);
    dragId = ''; dragPreview = null; if (requestUpdate) requestUpdate();
  };
  const onClick = async () => {                       // quick delete: click the trash in the hover pill -> confirm first
    if (!overTrash || !trashRect) return;
    const id = trashRect.id;
    // label = the same "SYMBOL Op PRICE" text the hover pill shows, so the dialog names exactly what's being deleted
    const a = list.find((x) => x.id === id);
    const sym = (pane && pane.symbol) || '';
    let priceStr = ''; try { if (a) priceStr = series.formatPrice().format(a.level); } catch (_) { priceStr = a ? String(a.level) : ''; }
    const label = a ? `${sym} ${t(a.op)} ${priceStr}` : sym;
    const ok = await confirmDialog({ title: t('Delete this alert?'), message: t('Doing this will permanently delete your') + ` "${label}" ` + t('alert') + '.', yes: t('Delete'), no: t('No') });
    if (!ok) return;
    alertCommand('remove', { id }).catch(() => {});
    activeId = ''; overTrash = false; trashRect = null; if (requestUpdate) requestUpdate();
  };
  const onLeave = () => { if (!dragId) { hoverId = ''; activeId = ''; overTrash = false; setScroll(false); paintCursor(); if (requestUpdate) requestUpdate(); } };

  return {
    updateAllViews() { refresh(); },
    paneViews() { return [paneView]; },
    priceAxisViews() { return style.label ? list.map(axisView) : []; },
    // the engine asks for the cursor at (x,y): over the trash -> pointer, over a line -> ns-resize
    /** @param {number} _x @param {number} y */
    hitTest(_x, y) {
      if (overTrash) return { cursorStyle: 'pointer', externalId: 'alert-primitive', zOrder: 'top' };
      return (series && nearestLineId(y, DRAG_TOL)) ? { cursorStyle: 'ns-resize', externalId: 'alert-primitive', zOrder: 'top' } : null;
    },
    /** @param {{ chart: any, series: any, requestUpdate: () => void }} p */
    attached(p) {
      chart = p.chart; series = p.series; requestUpdate = p.requestUpdate;
      unsub = alertMirror().subscribe(() => { if (requestUpdate) requestUpdate(); });   // repaint on create/move/remove
      const el = rootEl();
      if (el) {
        handlers = { move: onMove, down: onDown, up: onUp, click: onClick, leave: onLeave };
        el.addEventListener('mousemove', handlers.move);
        el.addEventListener('mousedown', handlers.down);
        window.addEventListener('mouseup', handlers.up);
        el.addEventListener('click', handlers.click);
        el.addEventListener('mouseleave', handlers.leave);
      }
    },
    detached() {
      if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
      const el = rootEl();
      if (el && handlers) {
        el.removeEventListener('mousemove', handlers.move);
        el.removeEventListener('mousedown', handlers.down);
        el.removeEventListener('click', handlers.click);
        el.removeEventListener('mouseleave', handlers.leave);
      }
      if (handlers) window.removeEventListener('mouseup', handlers.up);
      setScroll(false); const el2 = rootEl(); if (el2) try { el2.classList.remove('alert-cursor-ns', 'alert-cursor-pointer'); } catch (_) {}
      handlers = null; series = null; chart = null; requestUpdate = null;
    },
  };
}
