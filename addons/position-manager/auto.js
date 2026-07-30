// @ts-check
// order-ticket AUTO PANEL -- the DOM for the watcher-driven bracket: the [Show pending | Arm] buttons, the
// LEVELS table, and the VISIBILITY / HIDE-ON-ENTRY toggles. All decisions live in the ENGINE (auto-engine.js:
// phase machine, watcher rules, ladder math, store writes); this panel gathers and dispatches, then re-renders
// through the ui hooks it binds (engine.bindUi). It keeps NO state beyond its own DOM cells.

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */
/** @typedef {{ tgt: number|null, tgtQty: number, stop: number|null }} Level  one rung, as the table reads it */

import { createAutoEngine } from '/addons/position-manager/auto-engine.js';

/** @param {Kernel} ot @param {{ section: (title: string, host?: HTMLElement) => HTMLElement, autoPane: HTMLElement, visPane: HTMLElement }} deps */
export function createAuto(ot, { section, autoPane, visPane }) {
  const { el, BTN, INP, fmt, api, colors, t } = ot;
  const engine = createAutoEngine(ot);
  const planApi = api.trade.plan;
  const planCtx = engine.planCtx;

  // small numeric cell for the levels table: commits its parsed value (or null) on change
  /** @param {number|null} val @param {(v: number|null) => void} onCommit @returns {HTMLInputElement} */
  const numCell = (val, onCommit) => {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = 'any';
    i.value = /** @type {any} */ (val != null && isFinite(val) ? val : '');
    i.style.cssText = INP + 'width:100%;box-sizing:border-box;';
    i.onchange = () => {
      const v = parseFloat(i.value);
      onCommit(isFinite(v) ? v : null);
    };
    return i;
  };
  /** @param {string} txt @param {() => void} fn @param {string} [color] */
  const mk = (txt, fn, color) => {
    const b = document.createElement('button');
    b.textContent = txt;
    if (color) b.style.cssText = 'background:' + color + ';color:#fff;border-color:' + color + ';';
    b.onclick = fn;
    return b;
  };

  // ----- pending-entry controls: [Show pending | Arm] -----
  const pendHdr = el('div', 'display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;');
  pendHdr.append(el('div', 'color:var(--tx-dim);font-size:11px;letter-spacing:.06em;', t('ORDER')));
  autoPane.append(pendHdr);
  const pendBox = el('div', '');
  autoPane.append(pendBox);
  const pendBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().auto), t('Show pending')));
  pendBtn.onclick = () => onPendBtn();
  const armBtn = /** @type {HTMLButtonElement} */ (el('button', BTN(colors().auto), t('Arm')));
  armBtn.onclick = () => onArmBtn();
  ot.on('recolor', () => {
    pendBtn.style.background = colors().auto;
    armBtn.style.background = colors().auto;
  }); // gear dialog changed the palette (grey opacity persists on top)
  const actionsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;');
  actionsGrid.append(pendBtn, armBtn);
  pendBox.append(actionsGrid);

  // ----- levels table -----
  const levelsBox = section(t('LEVELS'), autoPane);
  const LV_COLS = 'display:grid;grid-template-columns:14px 44px 92px 92px 16px;gap:6px;align-items:center;';
  const lvHead = el('div', LV_COLS + 'color:var(--tx-dim);font-size:11px;margin-bottom:5px;');
  lvHead.append(
    el('span', '', '#'),
    el('span', '', t('Qty')),
    el('span', '', t('Target')),
    el('span', '', t('Stop')),
    el('span', ''),
  );
  const levelsEl = el('div', '');
  const addBtn = mk(t('+ Add Level'), () => engine.addLevel());
  addBtn.style.marginTop = '6px';
  levelsBox.append(lvHead, levelsEl, addBtn);

  /** @type {{ tgtIn: HTMLInputElement, stopIn: HTMLInputElement }[]} */
  let levelCells = [];
  // table follow: rung count changed -> rebuild the rows, else refresh cell values in place (keeps a focused input alive)
  const syncTable = () => {
    if (!engine.active()) return;
    if (engine.storeLevels().length !== levelCells.length) renderLevels();
    else refreshLevelCells();
  };
  /** @param {number} i @param {'stop'|'target'} which @param {number|null} v */
  const onLevelPriceEdit = (i, which, v) => {
    const L = engine.curLevels();
    if (!L || !L[i]) return;
    if (which === 'stop') engine.setLevelStop(i, /** @type {number} */ (v), true);
    else engine.setLevelTgt(i, /** @type {number} */ (v), true);
  };
  function refreshLevelCells() {
    const L = engine.curLevels();
    if (!L) return;
    L.forEach((/** @type {Level} */ lv, /** @type {number} */ i) => {
      const c = levelCells[i];
      if (!c) return;
      if (c.tgtIn && document.activeElement !== c.tgtIn)
        c.tgtIn.value = /** @type {any} */ (lv.tgt != null && isFinite(lv.tgt) ? lv.tgt : '');
      if (c.stopIn && document.activeElement !== c.stopIn)
        c.stopIn.value = /** @type {any} */ (lv.stop != null && isFinite(lv.stop) ? lv.stop : '');
    });
  }
  function renderLevels() {
    levelsEl.innerHTML = '';
    levelCells = [];
    const L = engine.curLevels(),
      ai = engine.curIdx(),
      st = engine.phaseState();
    const canEdit = L && !st.pending;
    addBtn.style.display = canEdit ? 'inline-block' : 'none';
    if (!L) {
      levelsEl.appendChild(el('div', 'color:var(--tx-dim);font-size:12px;', t('no setup — Show pending to begin')));
      return;
    }
    L.forEach((/** @type {Level} */ lv, /** @type {number} */ i) => {
      const on = st.bracket && i === ai;
      const done = st.bracket && i < ai;
      const row = el(
        'div',
        LV_COLS +
          'margin-bottom:4px;padding:2px;border-radius:4px;' +
          (on ? 'outline:1px solid #2962ff;' : '') +
          (done ? 'opacity:0.45;' : ''),
      );
      const tgtIn = numCell(lv.tgt, (v) => onLevelPriceEdit(i, 'target', v));
      const qtyIn = numCell(lv.tgtQty, (v) => {
        const q = Math.abs(v || 0) || 1;
        planApi.setLevel(planCtx().b, planCtx().s, i, { qty: q });
        qtyIn.value = /** @type {any} */ (q);
        engine.syncLevelsCfg();
      });
      const stopIn = numCell(lv.stop, (v) => onLevelPriceEdit(i, 'stop', v));
      const rm = el(
        'button',
        'background:none;border:none;color:var(--tx-dim);cursor:pointer;font-size:15px;line-height:1;padding:0;',
        '×',
      );
      rm.onclick = () => engine.removeLevel(i);
      const removable = canEdit && L.length > 1 && (!st.bracket || i > ai);
      if (!removable) rm.style.visibility = 'hidden';
      row.append(el('span', 'color:var(--tx-dim);font-size:11px;', String(i + 1)), qtyIn, tgtIn, stopIn, rm);
      levelsEl.appendChild(row);
      levelCells[i] = { tgtIn, stopIn };
    });
  }

  // ----- phase machine drives the two buttons -----
  const updateSide = () => {}; // side is implied by the beads / the Buy-Sell press; kept as a no-op call site
  /** @param {HTMLButtonElement} b @param {boolean} on */
  const grey = (b, on) => {
    b.disabled = on;
    b.style.opacity = on ? '0.5' : '1';
    b.style.cursor = on ? 'default' : 'pointer';
  };
  function syncButtons() {
    const ph = engine.phase();
    if (ph === 'idle') {
      pendBtn.textContent = t('Show pending');
      grey(pendBtn, false);
      armBtn.textContent = t('Arm');
      grey(armBtn, true);
    }
    if (ph === 'shown') {
      pendBtn.textContent = t('Clear pending');
      grey(pendBtn, false);
      armBtn.textContent = t('Arm');
      grey(armBtn, false);
    }
    if (ph === 'armed') {
      pendBtn.textContent = t('Clear pending');
      grey(pendBtn, false);
      armBtn.textContent = t('Disarm');
      grey(armBtn, false);
    }
    if (ph === 'active') {
      pendBtn.textContent = t('Armed');
      grey(pendBtn, true);
      armBtn.textContent = t('Disarm');
      grey(armBtn, false);
    }
    if (ph === 'position') {
      const pp = engine.posOf();
      pendBtn.textContent = pp ? (pp.side === 'short' ? t('Short') : t('Long')) + ' ' + fmt(pp.qty) : t('Position');
      grey(pendBtn, true);
      armBtn.textContent = t('Arm');
      grey(armBtn, false);
    }
    updateSide();
  }
  const onPendBtn = () => {
    const ph = engine.phase();
    if (ph === 'idle') engine.showPending();
    else if (ph === 'shown' || ph === 'armed') engine.clearPending();
  };
  const onArmBtn = () => {
    const ph = engine.phase();
    if (ph === 'shown') engine.armPending();
    else if (ph === 'armed') engine.disarmPending();
    else if (ph === 'active') engine.disarmActive();
    else if (ph === 'position') engine.armFromPosition();
  };

  // ----- line VISIBILITY (pure show/hide; never affects the orders) ----- The toggles write the shared plan.vis and
  // the APP OVERLAY filters its dots by it (the addon draws nothing itself). Synced back from the store, so a change
  // from another window moves the checkboxes too.
  /** @typedef {'entry'|'stop'|'target'} WhichKey */
  /** @type {[WhichKey, string][]} */
  const WHICH = [
    ['entry', 'Entry'],
    ['stop', 'Stop'],
    ['target', 'Target'],
  ];
  /** @type {Partial<Record<WhichKey, HTMLInputElement>>} */
  const toggles = {};
  const visOf = () => /** @type {any} */ (planApi.get(planCtx().b, planCtx().s).vis || {});
  const linesBox = section(t('VISIBILITY'), visPane);
  const visRow = el('div', 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;');
  WHICH.forEach(([w, label]) => {
    const lab = el('label', 'display:flex;gap:4px;align-items:center;cursor:pointer;');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = visOf()[w] !== false;
    c.onchange = () => planApi.setVis(planCtx().b, planCtx().s, /** @type {any} */ ({ [w]: c.checked }));
    toggles[w] = c;
    lab.append(c, el('span', '', t(label)));
    visRow.appendChild(lab);
  });
  linesBox.appendChild(visRow);
  const syncVisUI = () => {
    const v = visOf();
    WHICH.forEach(([w]) => {
      const c = toggles[w];
      if (c) c.checked = v[w] !== false;
    });
  };

  // ----- HIDE ON ENTRY ----- each CHECKED category hides at the ENTRY moment; unchecked reset to visible. The policy is
  // now the SHARED GLOBAL one (order-visibility): the ORDER DIALOG edits the same setting, it persists, and it syncs
  // across windows. The engine fires the hide at its optimistic entry moment (the watcher trigger, BEFORE the fill);
  // the app overlay also applies the policy at the fill -- both idempotent, both read this one policy.
  /** @type {Partial<Record<WhichKey, HTMLInputElement>>} */
  const hideToggles = {};
  const hideBox = section(t('HIDE ON ENTRY'), visPane);
  const hideRow = el('div', 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;');
  WHICH.forEach(([w, label]) => {
    const lab = el('label', 'display:flex;gap:4px;align-items:center;cursor:pointer;');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!planApi.hideOnEntry()[w];
    c.onchange = () => planApi.setHideOnEntry(/** @type {any} */ ({ [w]: c.checked }));
    hideToggles[w] = c;
    lab.append(c, el('span', '', t(label)));
    hideRow.appendChild(lab);
  });
  hideBox.appendChild(hideRow);
  const syncHideUI = () => {
    const h = planApi.hideOnEntry();
    WHICH.forEach(([w]) => {
      const c = hideToggles[w];
      if (c) c.checked = !!h[w];
    });
  };
  planApi.onHideOnEntryChange(syncHideUI); // reflect a change made from the dialog / another window

  // the engine dispatches, this panel renders: bind the refresh hooks, then paint the initial state
  engine.bindUi({ syncButtons, renderLevels, syncTable, syncVisUI });
  renderLevels(); // initial: 'no setup' hint
  syncButtons(); // initial: idle -> [Show pending] [Arm disabled]

  return {
    active: engine.active,
    syncButtons,
    onFlat: engine.onFlat,
    onManualEntry: engine.onManualEntry,
    resetPlan: engine.resetPlan,
  };
}
