// @ts-check
// Study Board Builder — compose a chart-less study board (N rows, each = symbol + one oscillator) and
// create it as a new workspace tab. Opened from the Workspace Manager. A board is ANCHORED to one
// chart inside a Main Workspace's layout: that chart's timeframe + visible window drive every study
// (studies have no independent timeframe). Pick the workspace, then click the chart in its layout.
import { getActivePane } from '../chart/layout.js';
import { listStudies } from '../studies/registry.js';
import { openSymbolSearch } from '../market/symbol-search.js';
import { createWorkspaceTab, getActiveWsId, updateBoard } from './tabs.js';
import { listWorkspaces, readWorkspace } from './workspace-store.js';
import { studyBoardWorkspace, mergeStudyBoard } from './study-board.js';

/** @typedef {import('./study-board.js').BoardRow} BoardRow */

/**
 * @param {string} tag
 * @param {string|null} [cls]
 * @param {string|null} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
const oscillators = () => listStudies().filter((/** @type {any} */ s) => s.overlay === false);   // sub-pane studies only

// drag the dialog by its header (switches to fixed positioning on first grab so it leaves the
// overlay's flex centering and follows the cursor) -- same behaviour as the Workspace Manager.
/**
 * @param {HTMLElement} dlg
 * @param {HTMLElement} handle
 */
function dragByHandle(dlg, handle) {
  handle.style.cursor = 'move';
  handle.onpointerdown = (/** @type {PointerEvent} */ e) => {
    const tgt = /** @type {HTMLElement} */ (e.target);
    if (e.button !== 0 || (tgt.closest && tgt.closest('.lib-x'))) return;
    const r = dlg.getBoundingClientRect();
    dlg.style.position = 'fixed'; dlg.style.margin = '0'; dlg.style.left = r.left + 'px'; dlg.style.top = r.top + 'px';
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (/** @type {PointerEvent} */ ev) => {
      dlg.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - ox)) + 'px';
      dlg.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - oy)) + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  };
}

/** @type {HTMLElement|null} */
let overlay = null;
export function closeStudyBoardBuilder() { if (overlay) { overlay.remove(); overlay = null; } }

// edit (optional) = { wsId, name, ws, rows:[{symbol,broker,studyId,params}], linkedTo } -> edit a board
/**
 * @param {{ wsId?: string, name?: string, ws?: any, rows?: BoardRow[], linkedTo?: string|null, link?: { range?: boolean, crosshair?: boolean } }} [edit]
 */
export function openStudyBoardBuilder(edit) {
  closeStudyBoardBuilder();
  const p = getActivePane();
  const base = () => ({ symbol: p ? p.symbol : '', broker: p ? p.broker : null });
  const oscs = oscillators();
  const firstOsc = oscs[0] ? oscs[0].id : 'rsi';
  /** @type {BoardRow[]} */
  const rows = (edit && edit.rows && edit.rows.length)
    ? edit.rows.map((/** @type {BoardRow} */ r) => ({ ...r, studyId: r.studyId || firstOsc }))   // keep params + _settings/_range for state-preserving edit
    : [{ ...base(), studyId: firstOsc }];

  // Anchor: which Main Workspace + which chart (pane index) inside its layout the board is locked to.
  let linkedTo = edit ? (edit.linkedTo || null) : (getActiveWsId() || null);
  let linkedPane = (edit && edit.ws && edit.ws.linkedPane != null) ? edit.ws.linkedPane : null;
  /** @type {any} */
  let anchorWs = null;   // the loaded Main Workspace record (for the layout preview + the anchored tf)

  overlay = el('div', 'modal open'); overlay.style.zIndex = '95';
  const dlg = el('div', 'dialog sb-builder');
  const head = el('div', 'set-head');
  const x = el('span', 'lib-x', '✕');
  head.append(el('span', 'set-title', edit ? 'Edit study board' : 'New study board'), x);
  dlg.appendChild(head);

  const body = el('div', 'sb-body');

  const nameRow = el('div', 'sb-name-row');
  const nameInput = /** @type {HTMLInputElement} */ (el('input', 'sb-name')); nameInput.type = 'text'; nameInput.placeholder = 'Study board name';
  if (edit && edit.name) nameInput.value = edit.name;
  nameRow.append(el('span', 'sb-lbl', 'Name'), nameInput);
  body.appendChild(nameRow);

  // Main Workspace: the workspace whose layout holds the chart this board anchors to.
  const linkRow = el('div', 'sb-name-row');
  const linkSel = /** @type {HTMLSelectElement} */ (el('select', 'sb-name'));
  const noneOpt = /** @type {HTMLOptionElement} */ (el('option', null, '— pick a workspace —')); noneOpt.value = ''; linkSel.appendChild(noneOpt);
  // Changing the Main Workspace keeps a VALID anchor pane (default = first chart), so Save stays enabled
  // and the attachment can be switched in one step. renderPreview() re-clamps the index for the new layout.
  linkSel.onchange = () => { linkedTo = linkSel.value || null; loadAnchor(); };
  linkRow.append(el('span', 'sb-lbl', 'Main Workspace'), linkSel);
  body.appendChild(linkRow);

  // Layout preview: the chosen workspace's layout, each pane clickable. Click the CHART to anchor to.
  const pickWrap = el('div', 'sb-layout-pick');
  const pickHint = el('div', 'sb-lp-hint', 'Pick a workspace, then click the chart to anchor the studies to.');
  const pickGrid = el('div', 'sb-lp-grid');
  pickWrap.append(pickHint, pickGrid);
  body.appendChild(pickWrap);

  listWorkspaces().then((wss) => {
    (wss || []).filter((w) => !w.isBoard && w.id !== (edit && edit.wsId)).forEach((w) => {   // anchor only to a CHART workspace, never a board or itself
      const o = /** @type {HTMLOptionElement} */ (el('option', null, w.name || 'Untitled')); o.value = w.id; linkSel.appendChild(o);
    });
    if (linkedTo && [...linkSel.options].some((o) => o.value === linkedTo)) linkSel.value = linkedTo; else linkedTo = null;
    loadAnchor();
  }).catch(() => {});

  // Load the anchored workspace's layout and render the clickable preview.
  async function loadAnchor() {
    anchorWs = null; pickGrid.innerHTML = '';
    if (!linkedTo) { pickHint.textContent = 'Pick a workspace, then click the chart to anchor the studies to.'; updateCreate(); return; }
    const rec = await readWorkspace(linkedTo).catch(() => null);
    anchorWs = rec && rec.ws;
    renderPreview();
    updateCreate();
  }

  function renderPreview() {
    pickGrid.innerHTML = '';
    const ws = anchorWs;
    const panes = (ws && ws.panes) || [];
    if (!ws || !panes.length) { pickHint.textContent = 'Could not read that workspace.'; return; }
    if (linkedPane == null || linkedPane >= panes.length) linkedPane = 0;   // default anchor: first chart (click another to change)
    pickHint.textContent = panes.length > 1 ? 'Click the chart to anchor the studies to:' : 'Anchored to this chart:';
    const g = ws.grid || { cols: '1fr', rows: '1fr', areas: '"a"', cells: ['a'] };
    pickGrid.style.gridTemplateColumns = g.cols || '1fr';
    pickGrid.style.gridTemplateRows = g.rows || '1fr';
    pickGrid.style.gridTemplateAreas = g.areas || '"a"';
    panes.forEach((/** @type {any} */ pn, /** @type {number} */ i) => {
      const cell = el('div', 'sb-lp-cell' + (i === linkedPane ? ' sel' : ''));
      if (g.cells && g.cells[i]) cell.style.gridArea = g.cells[i];
      cell.append(el('div', 'sb-lp-sym', pn.symbol || '—'), el('div', 'sb-lp-tf', pn.tfId || ''));
      cell.onclick = () => { linkedPane = i; renderPreview(); updateCreate(); };
      pickGrid.appendChild(cell);
    });
  }

  // Link sync options (board <-> anchored chart).
  const link = { range: edit && edit.link ? edit.link.range !== false : true,
                 crosshair: edit && edit.link ? edit.link.crosshair !== false : true };
  const linkOpts = el('div', 'sb-link-opts');
  const mkChk = (/** @type {string} */ labelTxt, /** @type {'range'|'crosshair'} */ key) => {
    const row = el('label', 'sb-chk');
    const c = /** @type {HTMLInputElement} */ (el('input')); c.type = 'checkbox'; c.checked = link[key];
    c.onchange = () => { link[key] = c.checked; };
    row.append(c, el('span', null, labelTxt));
    return row;
  };
  linkOpts.append(mkChk('Sync range with chart', 'range'), mkChk('Sync crosshair with chart', 'crosshair'));
  body.appendChild(linkOpts);

  // One shared time scale: hide the (redundant) time scale + labels on every pane but the bottom one.
  let sharedTimeAxis = (edit && edit.ws) ? edit.ws.sharedTimeAxis !== false : true;
  const taRow = el('label', 'sb-chk sb-ta-opt');
  const taChk = /** @type {HTMLInputElement} */ (el('input')); taChk.type = 'checkbox'; taChk.checked = sharedTimeAxis;
  taChk.onchange = () => { sharedTimeAxis = taChk.checked; };
  taRow.append(taChk, el('span', null, 'Show only the bottom time scale & labels'));
  body.appendChild(taRow);

  body.appendChild(el('div', 'sb-section', 'Studies'));

  const rowsWrap = el('div', 'sb-rows');
  body.appendChild(rowsWrap);

  const addBtn = el('button', 'sb-add', '+  Add row');
  addBtn.onclick = () => { rows.push({ ...base(), studyId: firstOsc }); renderRows(); };
  body.appendChild(addBtn);

  const foot = el('div', 'sb-foot');
  const createBtn = /** @type {HTMLButtonElement} */ (el('button', 'primary', edit ? 'Save changes' : 'Create study board'));
  createBtn.onclick = async () => {
    const valid = rows.filter((r) => r.symbol && (r.compare || r.studyId));
    if (!valid.length || linkedTo == null || linkedPane == null) return;
    const name = (nameInput.value || '').trim() || 'Study board';
    const anchorPane = anchorWs && anchorWs.panes && anchorWs.panes[linkedPane];
    const tf = (anchorPane && anchorPane.tfId) || null;   // the board's timeframe = the anchored chart's
    const specs = valid.map((r) => ({ symbol: r.symbol, broker: r.broker, studyId: r.studyId, compare: !!r.compare, chartType: r.chartType,
                                      params: r.params || {}, _settings: r._settings, _range: r._range }));
    const opts = { linkedTo, linkedPane, tf, link, sharedTimeAxis };
    if (edit && edit.wsId) updateBoard(edit.wsId, name, mergeStudyBoard(edit.ws, specs, opts));  // preserve state
    else await createWorkspaceTab(name, studyBoardWorkspace(specs, opts));                        // fresh board
    closeStudyBoardBuilder();
  };
  foot.appendChild(createBtn);
  body.appendChild(foot);

  function updateCreate() {
    const ok = linkedTo != null && linkedPane != null && rows.some((r) => r.symbol && (r.compare || r.studyId));
    createBtn.disabled = !ok;
    createBtn.title = ok ? '' : 'Pick a Main Workspace and click the chart to anchor to.';
  }

  dlg.appendChild(body);
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  dragByHandle(dlg, head);   // drag the dialog around by its header

  x.onclick = closeStudyBoardBuilder;
  overlay.onclick = (/** @type {MouseEvent} */ e) => { if (e.target === overlay) closeStudyBoardBuilder(); };
  const esc = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { closeStudyBoardBuilder(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);

  function renderRows() {
    rowsWrap.innerHTML = '';
    rows.forEach((/** @type {BoardRow} */ r, /** @type {number} */ i) => rowsWrap.appendChild(rowEl(r, i)));
    updateCreate();
  }

  /**
   * @param {BoardRow} r
   * @param {number} i
   */
  function rowEl(r, i) {
    const row = el('div', 'sb-row');

    const ord = el('div', 'sb-ord');
    const up = /** @type {HTMLButtonElement} */ (el('button', 'sb-ord-btn', '▲')); up.title = 'Move up'; up.disabled = i === 0;
    up.onclick = () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; renderRows(); };
    const dn = /** @type {HTMLButtonElement} */ (el('button', 'sb-ord-btn', '▼')); dn.title = 'Move down'; dn.disabled = i === rows.length - 1;
    dn.onclick = () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; renderRows(); };
    ord.append(up, dn);

    const symBtn = el('button', 'sb-sym', r.symbol || 'Pick symbol…');
    symBtn.onclick = () => openSymbolSearch((/** @type {string} */ bid, /** @type {string} */ sym) => { r.broker = bid; r.symbol = sym; renderRows(); });

    const stSel = /** @type {HTMLSelectElement} */ (el('select', 'sb-study'));
    const cmpOpt = /** @type {HTMLOptionElement} */ (el('option', null, '＋ Compare (price)')); cmpOpt.value = '__compare__'; stSel.appendChild(cmpOpt);   // a price chart of the symbol, not a study
    oscs.forEach((/** @type {any} */ s) => { const o = /** @type {HTMLOptionElement} */ (el('option', null, s.name || s.id)); o.value = s.id; stSel.appendChild(o); });
    stSel.value = r.compare ? '__compare__' : (r.studyId || firstOsc);
    stSel.onchange = () => {
      if (stSel.value === '__compare__') { r.compare = true; r.studyId = null; }
      else { if (stSel.value !== r.studyId) r.params = {}; r.compare = false; r.studyId = stSel.value; }   // new study -> fresh params
    };

    const rm = /** @type {HTMLButtonElement} */ (el('button', 'sb-rm', '✕')); rm.title = 'Remove row'; rm.disabled = rows.length <= 1;
    rm.onclick = () => { rows.splice(i, 1); renderRows(); };

    row.append(ord, symBtn, stSel, rm);
    return row;
  }

  renderRows();
  nameInput.focus();
}
