// @ts-check
// order-ticket SHELL -- the panel chrome: the symbol/broker header, the section() helper, and the universal
// CONFIGURATION box (just Thold now -- Offset/Bars/Project are app-owned). ONE pane, no tabs (the DOM/market-depth
// tab was removed). Holds no trading state; config edits persist via ot.save and signal the panel through events:
//   emit('rethreshold')  -- Thold changed -> the watcher vicinity recomputes
// Returns the containers/handles the rest of the panel builds into: autoPane, section, updateHeader.

import { colorSwatch } from '/src/ui/colorpicker.js'; // the APP's shared color picker (same swatch used across the app)

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */

/** @param {Kernel} ot */
export function createShell(ot) {
  const { el, cfg, INP, save, emit, root, BTN, colors, t } = ot;

  // ---- header: symbol + broker from the active chart (above the tabs, always visible) ----
  const hdr = el('div', 'display:flex;align-items:baseline;gap:8px;margin:2px 0 10px;');
  const hdrSym = el('span', 'font-size:17px;font-weight:600;color:var(--tx);', '—');
  const hdrBrk = el('span', 'font-size:11px;color:var(--tx-dim);', '');
  hdr.append(hdrSym, hdrBrk);
  const updateHeader = () => {
    hdrSym.textContent = cfg.symbol || '—';
    hdrBrk.textContent = (cfg.broker || 'active').toString().toUpperCase();
  };

  // ---- ONE pane (no tabs -- the DOM/market-depth tab was removed) ----
  const autoPane = el('div', '');
  root.append(hdr, autoPane);

  // sections default to the pane; pass a host to place them elsewhere
  /** @param {string} title @param {HTMLElement} [host] @returns {HTMLElement} */
  const section = (title, host) => {
    const h = el('div', 'color:var(--tx-dim);font-size:11px;letter-spacing:.06em;margin:12px 0 6px;', title);
    (host || autoPane).appendChild(h);
    const box = el('div', '');
    (host || autoPane).appendChild(box);
    return box;
  };

  // ---- universal CONFIGURATION (shared): only Thold (the watcher vicinity) remains. Offset, Bars away and the
  // Project-order toggle were removed -- those are per-chart PRIMITIVE settings owned by the app, not the addon. ----
  const threshInput = document.createElement('input');
  threshInput.type = 'number';
  threshInput.value = /** @type {any} */ (cfg.thresholdTicks != null ? cfg.thresholdTicks : 1);
  threshInput.style.cssText = INP + 'width:52px;'; // match the Units input
  threshInput.onchange = () => {
    cfg.thresholdTicks = parseFloat(threshInput.value) || 1;
    emit('rethreshold');
    save();
  };
  const universalBox = el('div', 'margin-top:14px;padding-top:12px;border-top:1px solid var(--bd-soft);');
  universalBox.append(
    el('div', 'color:var(--tx-dim);font-size:11px;letter-spacing:.06em;margin-bottom:8px;', t('CONFIGURATION')),
  );
  const uTholdRow = el('div', 'display:flex;gap:8px;align-items:center;');
  uTholdRow.append(el('span', 'width:78px;color:var(--tx-dim);font-size:12px;', t('Thold')), threshInput);
  universalBox.append(uTholdRow);
  root.appendChild(universalBox);

  // VISIBILITY + HIDE ON ENTRY render here, BELOW the CONFIGURATION box (auto.js targets this host).
  const visPane = el('div', '');
  root.appendChild(visPane);

  // ---- gear (bottom): a small settings dialog to pick the Buy / Sell / auto-exec button colors. Persisted in
  // cfg.colors via save(); emit('recolor') repaints the live buttons (index.js + auto.js listen). ----
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const gearRow = el('div', 'display:flex;justify-content:flex-end;margin-top:16px;');
  // SAME style as the Order dialog's .ot-gear: a 28x28 bordered box, dim glyph that brightens on hover.
  const gear = /** @type {HTMLButtonElement} */ (
    el(
      'button',
      'width:28px;height:28px;background:var(--bg);border:1px solid var(--bd);color:var(--tx-dim);border-radius:4px;cursor:pointer;font-size:14px;line-height:1;padding:0;',
      '⚙',
    )
  );
  gear.title = t('Button colors');
  gear.onmouseenter = () => {
    gear.style.color = 'var(--tx)';
    gear.style.borderColor = 'var(--tx-dim)';
  };
  gear.onmouseleave = () => {
    gear.style.color = 'var(--tx-dim)';
    gear.style.borderColor = 'var(--bd)';
  };
  gearRow.append(gear);
  root.appendChild(gearRow);

  const overlay = el(
    'div',
    'position:absolute;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:60;',
  );
  const card = el(
    'div',
    'background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:16px;min-width:190px;box-shadow:0 6px 24px rgba(0,0,0,.3);',
  );
  card.append(el('div', 'font-weight:600;font-size:13px;color:var(--tx);margin-bottom:12px;', t('Button Colors')));
  /** @param {string} label @param {'buy'|'sell'|'auto'} key */
  const colorRow = (label, key) => {
    const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px;');
    const sw = colorSwatch(colors()[key], (/** @type {string} */ v) => {
      /** @type {any} */ (cfg).colors = { ...colors(), [key]: v };
      save();
      emit('recolor');
    });
    row.append(el('span', 'color:var(--tx);font-size:13px;', label), sw);
    return row;
  };
  card.append(colorRow(t('Buy'), 'buy'), colorRow(t('Sell'), 'sell'), colorRow(t('Auto Exec'), 'auto'));
  const closeBtn = /** @type {HTMLButtonElement} */ (el('button', BTN('#6b7280'), t('Close')));
  closeBtn.style.width = '100%';
  closeBtn.style.marginTop = '4px';
  closeBtn.onclick = () => {
    overlay.style.display = 'none';
  };
  card.append(closeBtn);
  overlay.append(card);
  overlay.onclick = (/** @type {MouseEvent} */ e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  };
  root.appendChild(overlay);
  gear.onclick = () => {
    overlay.style.display = 'flex';
  };

  return { autoPane, section, updateHeader, visPane };
}
