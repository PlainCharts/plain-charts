// @ts-check
// Object Manager — the right slide-out Object Tree. A FOLDER TREE for mental
// organization of drawings: folders hold drawings and sub-folders (any depth). This
// is organization ONLY — it never affects stacking (z) or visibility. The tree is
// SHARED PER SYMBOL (in the sync store), so every same-symbol chart shows the same
// organization; it references drawings by id and persists with the tab workspace.
// Indicators stay per-chart; drawings local to another pane render only on that pane.
//
// This module is the panel shell: init, the render orchestration and the tree rows.
// The shared UI state lives in objects-state.js (single store + render slot); the
// mutations in objects-actions.js; drag/drop in objects-dnd.js; the layer tabs in
// objects-layers.js; the context menus in objects-menus.js; the pure tree operations
// in objects-tree-ops.js; Save/Load file I/O in objects-io.js.
import { bus } from '../bus.js';
import { themeIcon } from '../ui/icon.js';
import { getActivePane, getAllPanes } from '../chart/layout.js';
import { getTool } from '../tools/registry.js';
import { openStudySettings } from '../studies/settings.js';
import { visibleOnTf } from '../tools/engine/visibility.js';
import { folderDrawingIds } from './objects-tree-ops.js';
import { saveDrawingSet, loadDrawingSet } from './objects-io.js';
import { state, eng, setRenderer } from './objects-state.js';
import { startRename, renameInput, createFolder, removeSelection, removeFolderDeep } from './objects-actions.js';
import { rowDnd, doDrop } from './objects-dnd.js';
import { buildLayerTabs } from './objects-layers.js';
import { closeObjMenu, openObjMenu, openFolderMenu } from './objects-menus.js';
import { t } from '../i18n/i18n.js';
import * as rp from './rightpanel.js';

// The vendored kapelka engine surface — panes, drawing/folder-tree engines, drawings, folder
// nodes and tool descriptors have no TS types here, so they are treated as `any` at this boundary.
/** @typedef {any} Pane */
/** @typedef {any} Engine */
/** @typedef {any} Drawing */
/** @typedef {any} Tool */
/** @typedef {import('./objects-tree-ops.js').TreeNode} TreeNode */

/** @type {HTMLElement|null} */
let panel = null;
/** @type {HTMLElement} */
let listEl = /** @type {any} */ (null);
/** @type {ReturnType<typeof setTimeout>|null} */
let renameTimer = null; // slow-click (Explorer-style) rename timer
/** @type {string|undefined} */
let lastSel = undefined; // last chart selection seen (to sync chart → tree highlight)
let rendering = false; // guard against re-entrant render (reconcile→save→render)
let drawingsCollapsed = false; // section collapse state (object tree only, not persisted)
let indicatorsCollapsed = false;
let comparePaneCollapsed = false;
let revealSig = ''; // last chart-selection signature scrolled into view

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @param {Engine} e */
function registerEngine(e) {
  if (!e) return;
  /** @param {TreeNode[]|undefined} nodes */
  const walk = (nodes) =>
    (nodes || []).forEach((/** @type {TreeNode} */ n) => {
      state.engineById.set(n.id, e);
      if (n.type === 'folder') walk(n.children);
    });
  e.allTrees().forEach(walk); // every layer's tree (main chart has one tree per layer)
  e.objects().forEach((/** @type {Drawing} */ d) => state.engineById.set(d.id, e));
}

// the object tree's current multi-selection, drawings only (folders excluded) —
// used by copy/paste so Ctrl+C can grab several at once.
/** @returns {string[]} */
export function getSelectedDrawingIds() {
  const e = eng();
  if (!e) return [];
  return [...state.selectedIds].filter((id) => e.get(id));
}
/** @param {Drawing} d */
const labelOf = (d) => d.name || (getTool(d.tool) || {}).name || d.tool;

// keep the tree in sync with the actual drawings: drop dead refs, add new ones at root top.
// The tree is shared per symbol, so prune against the UNION of every same-symbol pane's
// drawings — a drawing that's local to another pane must not be pruned here. New drawings
// from THIS pane are added at root; ones local to other panes render only on their pane.
/** @param {Engine} e @returns {TreeNode[]} */
function reconcile(e) {
  /** @type {Set<string>} */
  const ids = new Set();
  if (e.isolated) {
    // a sub-pane's tree only references its own (local) drawings
    e.objects().forEach((/** @type {Drawing} */ d) => ids.add(d.id));
  } else {
    const sym = e.pane.symbol;
    getAllPanes().forEach((/** @type {Pane} */ p) => {
      if (p.symbol === sym && p.drawings) p.drawings.objects().forEach((/** @type {Drawing} */ d) => ids.add(d.id));
    });
  }
  /** @type {Set<string>} */
  const present = new Set();
  let changed = false;
  /** @param {TreeNode[]} nodes */
  const prune = (nodes) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === 'folder') {
        prune(n.children || (n.children = []));
      } else if (ids.has(n.id)) present.add(n.id);
      else {
        nodes.splice(i, 1);
        changed = true;
      }
    }
  };
  // Prune dead refs across EVERY layer (a drawing lives in exactly one), then add brand-new
  // drawings to the ACTIVE layer's tree (= getTree()).
  e.allTrees().forEach(prune);
  const active = e.getTree();
  e.objects().forEach((/** @type {Drawing} */ d) => {
    if (!present.has(d.id)) {
      active.unshift({ type: 'drawing', id: d.id });
      changed = true;
    }
  });
  if (changed) e.saveTree();
  return active;
}

export function initObjects() {
  panel = el('div', 'obj-view');

  const head = el('div', 'obj-head');
  // built-once chrome (title + toolbar tips): tag with data-i18n* so the live vocabulary switch
  // re-localizes it centrally (the render() below only rebuilds the list, not this header/bar)
  const titleSpan = el('span', null, t('Object tree'));
  titleSpan.setAttribute('data-i18n', 'Object tree');
  head.append(
    titleSpan,
    (() => {
      const x = el('span', 'lib-x', '✕');
      x.onclick = () => rp.toggle('objects', false);
      return x;
    })(),
  );
  const bar = el('div', 'obj-bar');
  const nf = el('button', 'obj-bar-btn', '🗀﹢');
  nf.title = t('New folder (groups the selection)');
  nf.setAttribute('data-i18n-title', 'New folder (groups the selection)');
  nf.onclick = () => createFolder([...state.selectedIds]);
  const sv = el('button', 'obj-bar-btn');
  sv.title = t('Save all drawings on this chart to a file');
  sv.setAttribute('data-i18n-title', 'Save all drawings on this chart to a file');
  sv.appendChild(themeIcon('/images/save.png', 15));
  sv.onclick = saveDrawingSet;
  const ld = el('button', 'obj-bar-btn');
  ld.title = t('Load drawings from a file (replaces all drawings on this chart)');
  ld.setAttribute('data-i18n-title', 'Load drawings from a file (replaces all drawings on this chart)');
  ld.appendChild(themeIcon('/images/load.png', 15));
  ld.onclick = () => loadDrawingSet(render);
  bar.append(nf, el('span', 'obj-bar-sep'), sv, ld);
  listEl = el('div', 'obj-list');
  state.listEl = listEl; // the permanent list element (drop-marker cleanup queries it)
  // dropping on empty list area → move to root
  listEl.ondragover = (ev) => {
    if (state.dragId) ev.preventDefault();
  };
  listEl.ondrop = (ev) => {
    if (!state.dragId) return;
    ev.preventDefault();
    state.dropTarget = null;
    doDrop();
  }; // empty area → root end
  panel.append(head, bar, listEl);
  const railIcon = themeIcon('/images/layers.png', 18);
  rp.addView({ id: 'objects', icon: railIcon, title: 'Object tree', content: panel, width: 320 });
  bus.on('rightpanel:shown', (id) => {
    if (id === 'objects') render();
  });

  const refresh = () => {
    if (rp.isShown('objects') && !state.renamingId && !state.dragId) render();
  };
  bus.on('vocab:changed', refresh); // live vocabulary switch
  bus.on('objects:changed', refresh);
  bus.on('pane:changed', refresh);
  bus.on('pane:active', () => {
    state.renamingId = null;
    state.selectedIds.clear();
    refresh();
  });
  // a timeframe change flips per-interval visibility, so the orange "hidden on this
  // interval" eye must re-evaluate (defer so the pane's tfId is updated first)
  bus.on('tf:selected', () => setTimeout(refresh, 0));

  // capture phase + stopPropagation so the chart's own Delete handler doesn't also fire
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!rp.isShown('objects') || state.renamingId || !state.selectedIds.size) return;
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      const a = /** @type {HTMLElement|null} */ (document.activeElement),
        tag = a && a.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
      ev.preventDefault();
      ev.stopPropagation();
      removeSelection();
    },
    true,
  );
}

function render() {
  if (rendering) return; // a reconcile/save inside render can re-trigger render; ignore the nested call
  rendering = true;
  try {
    _render();
  } finally {
    rendering = false;
  }
}
setRenderer(render); // actions/layers/menus re-render through the state slot
function _render() {
  const e = eng();
  // reflect a chart-originated selection in the tree. We mirror the engine's full
  // multi-selection (canvas Ctrl+click) keyed by a signature, so the tree highlights
  // every selected drawing — but only when the tree isn't itself driving a richer
  // multi-selection (folders / shift-range), so we don't collapse that.
  if (e) {
    const sig = e.selectedIds().slice().sort().join(',');
    if (sig !== lastSel) {
      const chartSet = new Set(e.selectedIds());
      if (state.selectedIds.size <= 1 || chartSet.size > 1) {
        state.selectedIds = chartSet;
        state.anchorId = e.selectedId;
      }
      lastSel = sig;
    }
  }
  listEl.innerHTML = '';
  state.flatOrder = [];
  state.engineById = new Map();
  state.pendingFocus = null;
  closeObjMenu();
  const p = getActivePane();
  if (!e) {
    listEl.appendChild(el('div', 'obj-empty', t('No chart.')));
    return;
  }

  // ---- Drawings section: left-edge LAYER tabs + the active layer's folder tree ----
  registerEngine(e);
  const tree = reconcile(e);
  listEl.appendChild(
    sectionHead(t('Drawings'), drawingsCollapsed, () => {
      drawingsCollapsed = !drawingsCollapsed;
      render();
    }),
  );
  if (!drawingsCollapsed) {
    if (e.layers()) {
      // main chart: left-edge layer tabs + the active layer's tree
      const wrap = el('div', 'obj-layers');
      const treeCol = el('div', 'obj-layer-tree');
      wrap.append(buildLayerTabs(e), treeCol);
      listEl.appendChild(wrap);
      treeCol.ondragover = (ev) => {
        if (state.dragId) ev.preventDefault();
      };
      treeCol.ondrop = (ev) => {
        if (!state.dragId) return;
        ev.preventDefault();
        state.dropTarget = null;
        doDrop();
      }; // drop in empty tree area → root end
      // render the active layer's tree INTO the tree column (retarget row appends, then restore)
      const prev = listEl;
      listEl = treeCol;
      if (!tree.length) treeCol.appendChild(el('div', 'obj-empty', t('No drawings on this layer.')));
      renderTreeNodes(e, tree, 0);
      listEl = prev;
    } else {
      // study board / no-layer context: plain folder tree, no layer tabs
      if (!tree.length) listEl.appendChild(el('div', 'obj-empty', t('No drawings on this chart.')));
      renderTreeNodes(e, tree, 0);
    }
  }

  // ---- Compare sub-pane: its OWN group (a pane is its own space, not an indicator),
  // with the drawings made on it nested underneath ----
  if (p && p.compare) appendComparePaneGroup(p);

  // ---- Indicators section (per-chart studies) ----
  const studies = p ? p.studies.list() : [];
  if (studies.length) {
    listEl.appendChild(
      sectionHead(t('Indicators'), indicatorsCollapsed, () => {
        indicatorsCollapsed = !indicatorsCollapsed;
        render();
      }),
    );
    if (!indicatorsCollapsed)
      studies.forEach((/** @type {any} */ a) => {
        listEl.appendChild(buildIndicatorRow(p, a));
        const ce = p.studies.surfaceEngine(a.i); // oscillator sub-pane → its drawings nested below
        if (ce) appendSurfaceDrawingRows(ce, 1);
      });
  }

  if (state.pendingFocus) {
    /** @type {HTMLInputElement} */ (state.pendingFocus).focus();
    /** @type {HTMLInputElement} */ (state.pendingFocus).select();
  }

  // reveal: when the chart selection changes, scroll the highlighted row into view
  /** @type {string[]} */
  const subSel = [];
  if (p && p.compareDrawings) subSel.push(...p.compareDrawings.selectedIds());
  if (p && p.studies)
    p.studies.list().forEach((/** @type {any} */ a) => {
      const ce = p.studies.surfaceEngine(a.i);
      if (ce) subSel.push(...ce.selectedIds());
    });
  const selSig = [...(e ? e.selectedIds() : []), ...subSel].sort().join(',');
  if (selSig && selSig !== revealSig) {
    const sel = listEl.querySelector('.obj-row.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  revealSig = selSig;
}

// a collapsible section divider ("Drawings" / "Indicators")
/** @param {string} label @param {boolean} collapsed @param {(this: GlobalEventHandlers, ev: MouseEvent) => any} onToggle */
function sectionHead(label, collapsed, onToggle) {
  const r = el('div', 'obj-section');
  const tw = el('span', 'obj-twirl', collapsed ? '▸' : '▾');
  r.append(tw, el('span', 'obj-section-lbl', label));
  r.onclick = onToggle;
  return r;
}

// a small image action button (used by pane groups + drawing rows)
/** @param {string} src @param {string} title @param {string} cls @param {() => void} fn */
const imgAct = (src, title, cls, fn) => {
  const b = el('button', 'obj-act' + (cls ? ' ' + cls : ''));
  b.title = title;
  b.appendChild(themeIcon(src, 14));
  b.onclick = (ev) => {
    ev.stopPropagation();
    fn();
  };
  return b;
};

// render an engine's folder tree (drawings + folders, any depth) as rows. Shared by the
// main chart and every sub-pane surface, so all of them get the same drag/drop + folders.
/** @param {Engine} e @param {TreeNode[]} nodes @param {number} depth @param {boolean=} inhHidden @param {boolean=} inhLocked */
function renderTreeNodes(e, nodes, depth, inhHidden, inhLocked) {
  nodes.forEach((node) => {
    if (node.type === 'folder') {
      listEl.appendChild(
        buildFolderRow(
          e,
          node,
          depth,
          (/** @type {HTMLInputElement} */ inp) => {
            state.pendingFocus = inp;
          },
          inhHidden,
          inhLocked,
        ),
      );
      // a folder's own hidden/locked flow down to everything inside it (own-flag inheritance, no cascade)
      if (node.expanded)
        renderTreeNodes(e, node.children || [], depth + 1, inhHidden || !!node.hidden, inhLocked || !!node.locked);
    } else {
      const d = e.get(node.id);
      if (!d) return;
      listEl.appendChild(
        buildDrawingRow(
          e,
          d,
          node,
          depth,
          (/** @type {HTMLInputElement} */ inp) => {
            state.pendingFocus = inp;
          },
          inhHidden,
          inhLocked,
        ),
      );
    }
  });
}

// render the drawings of a sub-pane surface engine `ce`, nested under its group header,
// through the SAME folder-tree path as the main chart (drag/drop + folders, within-surface).
/** @param {Engine} ce @param {number} baseDepth */
function appendSurfaceDrawingRows(ce, baseDepth) {
  if (!ce) return;
  registerEngine(ce);
  const tree = reconcile(ce);
  if (!tree.length) {
    const e = el('div', 'obj-empty', t('No drawings on this pane.'));
    e.style.paddingLeft = 10 + baseDepth * 16 + 'px';
    listEl.appendChild(e);
    return;
  }
  renderTreeNodes(ce, tree, baseDepth);
}

// the compare sub-pane as its own group: a header (the symbol, with hide/remove for
// the whole pane) and, nested under it, the drawings made on that pane.
/** @param {Pane} pane */
function appendComparePaneGroup(pane) {
  const cmp = pane.compare;
  if (!cmp) return;
  const head = el('div', 'obj-section obj-pane-head' + (cmp.hidden ? ' hidden' : ''));
  head.append(
    el('span', 'obj-twirl', comparePaneCollapsed ? '▸' : '▾'),
    el('span', 'obj-ico', '∿'),
    el('span', 'obj-section-lbl', cmp.symbol),
  );
  const hacts = el('div', 'obj-acts');
  hacts.append(
    imgAct(
      cmp.hidden ? '/images/invisible.png' : '/images/visible.png',
      cmp.hidden ? t('Show') : t('Hide'),
      cmp.hidden ? 'shown' : '',
      () => pane.compareSetHidden(!cmp.hidden),
    ),
    imgAct('/images/trash.png', t('Remove pane'), '', () => pane.removeCompare()),
  );
  head.appendChild(hacts);
  head.onclick = (ev) => {
    if (/** @type {HTMLElement} */ (ev.target).closest('.obj-acts')) return;
    comparePaneCollapsed = !comparePaneCollapsed;
    render();
  };
  listEl.appendChild(head);
  if (comparePaneCollapsed) return;
  appendSurfaceDrawingRows(pane.compareDrawings, 1);
}

// one indicator row: icon + name (click → settings) + show/hide + settings + remove
/** @param {Pane} pane @param {any} a */
function buildIndicatorRow(pane, a) {
  const row = el('div', 'obj-row obj-ind' + (a.hidden ? ' hidden' : ''));
  row.style.paddingLeft = '10px';
  row.append(el('span', 'obj-twirl'), el('span', 'obj-ico', '∿'));
  const name = el('span', 'obj-name', a.name);
  if (a.error) {
    name.title = a.error;
    name.append(' ', el('span', 'obj-ind-warn', '⚠'));
  }
  row.appendChild(name);
  row.onclick = () => openStudySettings(pane, a.i);

  const acts = el('div', 'obj-acts');
  acts.append(
    imgAct(
      a.hidden ? '/images/invisible.png' : '/images/visible.png',
      a.hidden ? t('Show') : t('Hide'),
      a.hidden ? 'shown' : '',
      () => pane.studies.toggleHidden(a.i),
    ),
    imgAct('/images/settings.png', t('Settings'), '', () => openStudySettings(pane, a.i)),
    imgAct('/images/trash.png', t('Remove'), '', () => pane.studies.remove(a.i)),
  );
  row.appendChild(acts);
  return row;
}

// ---- rows ----
/** @param {Engine} e @param {Drawing} d @param {TreeNode} node @param {number} depth @param {(inp: HTMLInputElement) => void} setFocus @param {boolean=} inhHidden @param {boolean=} inhLocked */
function buildDrawingRow(e, d, node, depth, setFocus, inhHidden, inhLocked) {
  const tool = getTool(d.tool);
  // two reasons a drawing isn't shown on THIS chart: manual hide (d.hidden, grey eye)
  // vs interval visibility filtering it out on the current timeframe (orange eye). It's also dimmed when
  // an ancestor folder/layer is hidden (inhHidden) -- own-flag inheritance, the drawing's own eye is intact.
  const ivHidden = !d.hidden && !!d.visibility && !visibleOnTf(d, e.pane.tf && e.pane.tf());
  const effHidden = d.hidden || ivHidden;
  const row = el(
    'div',
    'obj-row' +
      (state.selectedIds.has(d.id) || e.isSelected(d.id) ? ' sel' : '') +
      (effHidden || inhHidden ? ' hidden' : '') +
      (inhLocked ? ' obj-inh-lock' : ''),
  );
  row.style.paddingLeft = 10 + depth * 16 + 'px';
  state.flatOrder.push(d.id);
  row.append(el('span', 'obj-twirl'), el('span', 'obj-ico', (tool && tool.glyph) || '•'));

  if (d.id === state.renamingId) {
    const inp = renameInput(d.id, labelOf(d), (v) => e.rename(d.id, v));
    setFocus(inp);
    row.appendChild(inp);
  } else {
    const name = el('span', 'obj-name', labelOf(d));
    row.appendChild(name);
    row.onclick = (ev) => selectClick(e, d.id, ev, true);
    row.ondblclick = () => {
      clearTimeout(/** @type {any} */ (renameTimer));
      startRename(d.id);
    };
    row.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!state.selectedIds.has(d.id)) {
        state.selectedIds = new Set([d.id]);
        state.anchorId = d.id;
        e.select(d.id);
        render();
      }
      openObjMenu(d.id, ev.clientX, ev.clientY, e);
    };
    rowDnd(e, row, d.id, false);
  }

  const acts = el('div', 'obj-acts');
  // visibility eye: crossed-eye when hidden on this chart; ORANGE (masked) when the
  // reason is interval visibility rather than a manual hide. Click toggles manual hide.
  const eye = el('button', 'obj-act' + (effHidden ? ' shown' : '') + (ivHidden ? ' iv' : ''));
  eye.title = d.hidden ? t('Show') : ivHidden ? t('Hidden on this interval (visibility)') : t('Hide');
  if (ivHidden) eye.appendChild(el('span', 'obj-eye-iv'));
  else eye.appendChild(themeIcon(effHidden ? '/images/invisible.png' : '/images/visible.png', 14));
  eye.onclick = (ev) => {
    ev.stopPropagation();
    e.setHidden(d.id, !d.hidden);
  };
  acts.append(
    eye,
    imgAct('/images/lock.png', d.locked ? t('Unlock') : t('Lock'), d.locked ? 'shown' : '', () =>
      e.setLocked(d.id, !d.locked),
    ),
    imgAct('/images/clone.png', t('Clone'), '', () => e.clone(d.id)),
    imgAct('/images/trash.png', t('Remove'), '', () => e.removeDrawing(d.id)),
  );
  row.appendChild(acts);
  return row;
}

/** @param {Engine} e @param {TreeNode} node @param {number} depth @param {(inp: HTMLInputElement) => void} setFocus @param {boolean=} inhHidden @param {boolean=} inhLocked */
function buildFolderRow(e, node, depth, setFocus, inhHidden, inhLocked) {
  // Highlight a COLLAPSED folder that (recursively) contains a chart-selected drawing: when the
  // folder is closed its child row isn't rendered, so the object's own highlight is invisible --
  // marking the folder tells you which one the selected object is hidden in. Same .sel styling as a
  // selected row, so the reveal-scroll below lands on the folder too. Only when collapsed: an open
  // folder already shows the child's highlight.
  const containsChartSel = !node.expanded && folderDrawingIds(node).some((/** @type {string} */ i) => e.isSelected(i));
  const dimmed = inhHidden || !!node.hidden; // this folder is effectively hidden (own flag or an ancestor's)
  const row = el(
    'div',
    'obj-row obj-folder' +
      (state.selectedIds.has(node.id) || containsChartSel ? ' sel' : '') +
      (dimmed ? ' hidden' : '') +
      (inhLocked ? ' obj-inh-lock' : ''),
  );
  row.style.paddingLeft = 10 + depth * 16 + 'px';
  state.flatOrder.push(node.id);
  const tw = el('span', 'obj-twirl', node.expanded ? '▾' : '▸');
  tw.onclick = (ev) => {
    ev.stopPropagation();
    node.expanded = !node.expanded;
    e.saveTree();
  };
  row.append(tw, el('span', 'obj-ico', node.expanded ? '🗁' : '🗀'));

  if (node.id === state.renamingId) {
    const inp = renameInput(node.id, node.name || 'Folder', (v) => {
      node.name = v || 'Folder';
      e.saveTree();
    });
    setFocus(inp);
    row.appendChild(inp);
  } else {
    row.appendChild(el('span', 'obj-name', node.name || t('Folder')));
    row.onclick = (ev) => selectClick(e, node.id, ev, false);
    row.ondblclick = () => {
      clearTimeout(/** @type {any} */ (renameTimer));
      startRename(node.id);
    };
    row.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!state.selectedIds.has(node.id)) {
        state.selectedIds = new Set([node.id]);
        state.anchorId = node.id;
        render();
      }
      openFolderMenu(node, ev.clientX, ev.clientY, e);
    };
    rowDnd(e, row, node.id, true);

    // folder actions: hide / lock the folder ITSELF (own flag -- descendants inherit it, no cascade writes
    // over the contents), remove (folder + contents).
    const acts = el('div', 'obj-acts');
    acts.append(
      imgAct(
        node.hidden ? '/images/invisible.png' : '/images/visible.png',
        node.hidden ? t('Show') : t('Hide'),
        node.hidden ? 'shown' : '',
        () => {
          node.hidden = !node.hidden;
          e.saveTree();
        },
      ),
      imgAct('/images/lock.png', node.locked ? t('Unlock') : t('Lock'), node.locked ? 'shown' : '', () => {
        node.locked = !node.locked;
        e.saveTree();
      }),
      imgAct('/images/trash.png', t('Remove folder & contents'), '', () => {
        removeFolderDeep(e, node);
        e.saveTree();
      }),
    );
    row.appendChild(acts);
  }
  return row;
}

// ---- selection ----
/** @param {Engine} e @param {string} id @param {MouseEvent} ev @param {boolean} isDrawing */
function selectClick(e, id, ev, isDrawing) {
  clearTimeout(/** @type {any} */ (renameTimer));
  if (ev.shiftKey && state.anchorId != null) {
    const a = state.flatOrder.indexOf(state.anchorId),
      b = state.flatOrder.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      state.selectedIds = new Set(state.flatOrder.slice(lo, hi + 1));
    } else state.selectedIds = new Set([id]);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    state.anchorId = id;
  } else {
    // slow-click rename (Explorer-style): click an already sole-selected row again
    if (state.selectedIds.size === 1 && state.selectedIds.has(id)) {
      renameTimer = setTimeout(() => startRename(id), 450);
      return;
    }
    state.selectedIds = new Set([id]);
    state.anchorId = id;
  }
  if (isDrawing) e.select(id); // chart follows the clicked drawing
  render();
}
