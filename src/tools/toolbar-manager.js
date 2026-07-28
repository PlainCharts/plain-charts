// @ts-check
// The "Customize toolbar" manager dialog: choose which tools appear on the bar, reorder
// them, set a custom icon and a hotkey per tool, author / edit / delete user tool
// packages, and reorder the pinned feature buttons. The bar's renderer and the feature descriptors are PASSED IN via
// openManager (dependency inversion) so this module never imports the bar back.
import { listTools, getTool, unregisterTool } from './registry.js';
import { toolbarTools, onBar, iconFor, setOnBar, placeTool, setIcon, toolHotkey, setToolHotkey, featureOrder, placeFeature } from './toolbar-store.js';
import { comboOf, isModifierKey, prettyCombo } from '../edit/hotkeys.js';
import { getActiveTool, setActiveTool } from './controller.js';
import { reloadUserToolFile, toolIdForFile, fileForTool, toolIconUrl, clearToolIconUrl } from './user-loader.js';
import { openCodeEditor } from '../studies/editor.js';
import { t as tr } from '../i18n/i18n.js';   // vocabulary lookup (aliased -- `t` is a tool-def param here)
import { makeDraggable } from '../ui/draggable.js';
import { confirmDialog } from '../ui/confirm.js';   // gate the destructive package-folder delete
import { themeIcon } from '../ui/icon.js';   // recolour previews with the theme, same as the on-bar buttons

/** @typedef {{ label: string, icon: string, build: () => HTMLButtonElement }} Feature */

/** @type {() => void} */
let refreshBar = () => {};        // re-render the toolbar; set by openManager
/** @type {Record<string, Feature>} */
let features = {};                // the bar's pinned feature descriptors; set by openManager
/** @type {(() => void) | null} */
let managerRender = null;   // set while the manager is open, so saves can refresh it

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el2 = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/** @param {any} s @returns {boolean} */
const isImg = (s) => typeof s === 'string' && (s.startsWith('/') || s.startsWith('data:') || s.startsWith('http'));

// normalize any picked image to a small centred 64x64 PNG data URL
/** @param {Blob} file @returns {Promise<string>} */
function fileToIconDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const S = 64, c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      const scale = Math.min(S / img.width, S / img.height);
      const w = img.width * scale, h = img.height * scale;
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** @param {string} id @param {(() => void)} [after] */
function uploadIcon(id, after) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    let dataUrl;
    try { dataUrl = await fileToIconDataURL(file); } catch (_) { alert(tr('Could not read that image.')); return; }
    const folder = fileForTool(id) || id;   // the tool's PACKAGE folder (parent) — the icon lands inside it, not a phantom folder
    const r = await fetch('/api/tool-icon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, id, dataUrl }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) { alert(tr('Icon upload failed:') + ' ' + r.error); return; }
    setIcon(id, r.path + '?v=' + Date.now());   // cache-bust so re-uploads show immediately
    if (after) after();
  };
  inp.click();
}

const TOOL_TEMPLATE = `// A tool — full JS, no DSL. Register it and it appears in the toolbar manager.
// This is a 'draw' tool: a real vector shape on the chart that you can select,
// move, reshape (drag handles), style, and label — like the built-in tools.
Tools.register({
  id: 'my_tool',
  name: 'My Tool',
  icon: '◆',                       // toolbar icon (override per-bar in the manager)
  kind: 'draw',                    // 'draw' = vector shape; 'click' = native price line; 'cursor' = none
  points: 2,                       // anchors collected on create (1, 2, …); stored as { time, price }
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid' },
  // Settings dialog (optional). 'style' rows show in the Style tab; a color control
  // with width/lineStyle keys becomes a combined stroke picker.
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
    ],
  },
  // Paint the shape. c = 2D canvas ctx; pts = screen points [{x,y}] for each anchor;
  // d = the drawing (d.style, d.text…); sel = selected?; view = { width, height, priceDecimals }.
  draw(c, pts, d, sel, view) {
    if (pts.length < 2) return;
    const s = d.style;
    c.save();
    c.strokeStyle = s.color; c.lineWidth = s.width || 2;
    c.setLineDash(Tools.dash(s.lineStyle));     // 'solid' | 'dashed' | 'dotted'
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y); c.lineTo(pts[1].x, pts[1].y); c.stroke();
    c.restore();
  },
  // Hit-test for selection. Return { part:'body' } or { part:'point', index } or null.
  // Tools.geom has helpers: dist, distToSegment, pointInRect.
  hitTest(pts, x, y, tol) {
    for (let i = 0; i < pts.length; i++)
      if (Tools.geom.dist(x, y, pts[i].x, pts[i].y) <= tol + 3) return { part: 'point', index: i };
    if (Tools.geom.distToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= tol) return { part: 'body' };
    return null;
  },
});

// Reuse another tool instead of rewriting it — e.g. an arrow IS a trend line:
//   const TL = () => Tools.get('trendline');
//   Tools.register({ id:'my_arrow', name:'Arrow', kind:'draw', points:2,
//     defaultStyle:{ color:'#2962ff', width:2, lineStyle:'solid', arrows:'end' },
//     get settings(){ return TL().settings; },
//     draw(...a){ return TL().draw(...a); }, hitTest(...a){ return TL().hitTest(...a); } });

// Or a 'click' tool that drops a native horizontal price line (no canvas):
//   kind:'click',
//   onClick(pt, ctx){ if (pt.price!=null) ctx.add({ price: pt.price, color:'#2962ff', width:2, style:0 }); },
//   render(d, ctx){ return ctx.series.addLevel({ price:d.price, color:d.color, lineWidth:d.width||2, showAxisLabel:true }); },
//   remove(h, ctx){ ctx.series.removeLevel(h); },
`;

// The code-editor's onSave callback signature (see studies/editor.js openCodeEditor).
/** @typedef {{ setCon: (text: string, kind?: string) => void, lockName: () => void, close: () => void }} EditorApi */

/** @param {string} fn @param {string} code @param {EditorApi} api */
const toolOnSave = async (fn, code, api) => {
  api.setCon(tr('Saving…'));
  const r = await fetch('/api/user-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fn, code }) })
    .then((x) => x.json()).catch((e) => ({ error: String(e) }));
  if (r.error) { api.setCon('✗ ' + r.error, 'err'); return; }
  try { await reloadUserToolFile(r.folder); }
  catch (/** @type {any} */ e) { api.setCon('✗ Load error\n' + (e.stack || e.message || e), 'err'); return; }
  const id = toolIdForFile(r.folder);
  const tool = id && getTool(id);
  if (!tool) { api.setCon('✗ Loaded, but no tool registered.\nDid you call Tools.register({ id, name, ... }) ?', 'err'); return; }
  api.lockName();
  api.setCon('✓ Saved & loaded — "' + tool.name + '". Tick it below to add it to the bar.', 'ok');
  if (managerRender) managerRender();
  refreshBar();
};

function writeNewTool() { openCodeEditor({ title: tr('New tool'), name: '', code: TOOL_TEMPLATE, saveLabel: tr('Save tool'), onSave: toolOnSave }); }
/** @param {string} file */
async function editTool(file) {
  const base = (file || '').replace(/\.js$/, '');
  const r = await fetch('/api/user-tools/file?name=' + encodeURIComponent(base)).then((x) => x.json()).catch(() => ({}));
  openCodeEditor({ title: tr('Edit tool'), name: base, code: r.code || TOOL_TEMPLATE, saveLabel: tr('Save tool'), onSave: toolOnSave });
}
/** @param {string} file @param {string} id */
async function deleteTool(file, id) {
  if (!await confirmDialog({ title: tr('Delete tool'), message: tr('Delete the tool') + ` "${id}"? ` + tr('This permanently removes its package folder from packages/tools.'), yes: tr('Delete'), no: tr('Cancel') })) return;
  const base = (file || '').replace(/\.js$/, '');
  await fetch('/api/user-tools/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: base }) }).catch(() => {});
  unregisterTool(id);
  setOnBar(id, false);
  if (getActiveTool() === id) setActiveTool('cursor');
  if (managerRender) managerRender();
  refreshBar();
}

/** @type {HTMLElement | null} */
let panel = null;
export function closeManager() { managerRender = null; if (panel) { panel.remove(); panel = null; } }

// A per-tool hotkey recorder cell. Click → captures the next modifier+key chord
// (Ctrl/Alt/Meta required, so it never clashes with the bare-letter symbol search);
// Backspace clears, Esc cancels. The combo is stored and dispatched by hotkeys.js.
/** @type {(() => void) | null} */
let hkRecording = null;   // cancel fn for the currently-recording cell (only one at a time)
/** @param {string} toolId @param {() => void} refresh */
function hotkeyCell(toolId, refresh) {
  const cur = toolHotkey(toolId);
  const cell = document.createElement('span');
  cell.className = 'tool-hk' + (cur ? '' : ' empty');
  cell.textContent = cur ? prettyCombo(cur) : tr('Set hotkey');
  cell.title = tr('Click to record a shortcut (Ctrl/Alt + key). Backspace clears, Esc cancels.');
  cell.onclick = (e) => {
    e.stopPropagation();
    if (hkRecording) hkRecording();
    cell.classList.remove('empty'); cell.classList.add('rec');
    cell.textContent = tr('Press keys…');
    const onKey = (/** @type {KeyboardEvent} */ ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === 'Escape') { done(false); return; }
      if (ev.key === 'Backspace' || ev.key === 'Delete') { setToolHotkey(toolId, ''); done(true); return; }
      if (isModifierKey(ev.key)) return;                                   // wait for the real key
      if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) { cell.textContent = tr('Use Ctrl/Alt + key'); return; }
      setToolHotkey(toolId, comboOf(ev));
      done(true);
    };
    /** @param {boolean} changed */
    const done = (changed) => {
      document.removeEventListener('keydown', onKey, true);
      hkRecording = null;
      if (changed) { refresh(); return; }
      cell.classList.remove('rec');
      cell.classList.toggle('empty', !cur);
      cell.textContent = cur ? prettyCombo(cur) : tr('Set hotkey');
    };
    hkRecording = () => done(false);
    document.addEventListener('keydown', onKey, true);
  };
  return cell;
}

/** @param {() => void} refresh   re-render the toolbar after a change
 *  @param {Record<string, Feature>} FEATURES   the bar's pinned feature descriptors */
export function openManager(refresh, FEATURES) {
  refreshBar = refresh;
  features = FEATURES;
  closeManager();
  // Floating (non-modal) panel so the chart stays interactive while it's open — no click-away close.
  const dlg = document.createElement('div'); dlg.className = 'dialog'; panel = dlg; dlg.style.zIndex = '60';
  dlg.style.width = '440px';
  const head = document.createElement('div'); head.className = 'lib-head';
  const x = document.createElement('span'); x.className = 'lib-x'; x.textContent = '✕'; x.onclick = closeManager;
  head.append(Object.assign(document.createElement('h3'), { textContent: tr('Customize toolbar') }), x);
  dlg.appendChild(head);

  const list = document.createElement('div'); list.className = 'tool-mgr-list';
  dlg.appendChild(list);

  // drag-to-reorder state (same idiom as the desk-tab column editor): whole row draggable,
  // an indicator line on the hovered row shows the insertion point (top half -> above, bottom
  // half -> below), and the drop inserts exactly there. Tools and features are separate lists,
  // so each keeps its own drag id and can't be dropped across the divider.
  /** @type {string | null} */ let dragTool = null;
  /** @type {string | null} */ let dragFeature = null;
  const clearDropMarks = () => list.querySelectorAll('.tool-mgr-drop-above, .tool-mgr-drop-below')
    .forEach((el) => el.classList.remove('tool-mgr-drop-above', 'tool-mgr-drop-below'));
  /** @param {HTMLElement} row @param {string} id
   *  @param {() => string | null} getDrag @param {(id: string | null) => void} setDrag
   *  @param {(dragId: string, targetId: string, after: boolean) => void} place @param {() => void} rerender */
  const wireRowDrag = (row, id, getDrag, setDrag, place, rerender) => {
    row.draggable = true;
    row.ondragstart = (e) => { setDrag(id); row.classList.add('tool-mgr-dragging'); try { const dt = /** @type {DataTransfer} */ (e.dataTransfer); dt.effectAllowed = 'move'; dt.setData('text/plain', id); } catch (_) {} };
    row.ondragend = () => { setDrag(null); row.classList.remove('tool-mgr-dragging'); clearDropMarks(); };
    row.ondragover = (e) => {
      const d = getDrag();
      if (!d || d === id) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const below = e.clientY > r.top + r.height / 2;
      row.classList.toggle('tool-mgr-drop-below', below);
      row.classList.toggle('tool-mgr-drop-above', !below);
    };
    row.ondragleave = () => row.classList.remove('tool-mgr-drop-above', 'tool-mgr-drop-below');
    row.ondrop = (e) => {
      e.preventDefault();
      const after = row.classList.contains('tool-mgr-drop-below');
      clearDropMarks();
      const d = getDrag();
      if (!d || d === id) return;
      place(d, id, after);
      setDrag(null);
      rerender(); refreshBar();
    };
  };

  const render = () => {
    list.innerHTML = '';

    // author / import actions
    const actions = document.createElement('div'); actions.className = 'tool-mgr-actions';
    const write = document.createElement('span'); write.className = 'tool-mgr-action'; write.textContent = '✎ ' + tr('Write new tool');
    write.onclick = writeNewTool;
    const fld = document.createElement('span'); fld.className = 'tool-mgr-action'; fld.textContent = '⊞ ' + tr('Open folder');
    fld.title = tr('Open the tools folder — drop a tool package (folder) in, then reload');
    fld.onclick = () => fetch('/api/user-tools/open', { method: 'POST' }).catch(() => {});
    actions.append(write, fld);
    list.appendChild(actions);

    // tools that are on the bar (in order) first, then the rest
    const all = listTools();
    // filter(Boolean) drops the undefined misses but TS can't narrow it, so cast to ToolDef[].
    const ordered = /** @type {import('./registry.js').ToolDef[]} */ ([...toolbarTools().map((id) => all.find((t) => t.id === id)).filter(Boolean),
      ...all.filter((t) => !onBar(t.id))]);
    ordered.forEach((tool) => {
      const row = document.createElement('div'); row.className = 'tool-mgr-row';
      const chk = document.createElement('span'); chk.className = 'tool-chk' + (onBar(tool.id) ? ' on' : '');
      chk.textContent = onBar(tool.id) ? '☑' : '☐';
      chk.onclick = () => { setOnBar(tool.id, !onBar(tool.id)); render(); refreshBar(); };

      const iconCell = document.createElement('div'); iconCell.className = 'tool-icon-cell';
      const cur = iconFor(tool.id) || toolIconUrl(tool.id);
      const prev = document.createElement('span'); prev.className = 'tool-icon-prev';
      if (isImg(cur)) prev.appendChild(themeIcon(/** @type {string} */ (cur), 20));
      else prev.textContent = cur || tool.glyph || '•';
      const upBtn = document.createElement('span'); upBtn.className = 'tool-ico'; upBtn.textContent = '🖼'; upBtn.title = tr('Upload PNG icon');
      upBtn.onclick = () => uploadIcon(tool.id, () => { render(); refreshBar(); });
      iconCell.append(prev, upBtn);
      if (isImg(cur)) {
        const clr = document.createElement('span'); clr.className = 'tool-ico'; clr.textContent = '✕'; clr.title = tr('Remove icon');
        // clear BOTH icon sources: the toolbar override AND the package's folder icon.png, so it truly reverts to
        // the glyph and a fresh upload can take. Otherwise the folder icon.png re-shows and the button looks dead.
        clr.onclick = async () => {
          setIcon(tool.id, '');
          await fetch('/api/user-tools/icon?name=' + encodeURIComponent(tool.id), { method: 'DELETE' }).catch(() => {});
          clearToolIconUrl(tool.id);
          render(); refreshBar();
        };
        iconCell.append(clr);
      }

      const name = document.createElement('span'); name.className = 'tool-mgr-name'; name.textContent = tr(tool.name);

      const hk = hotkeyCell(tool.id, () => { render(); refreshBar(); });

      // on-bar tools reorder by drag (off-bar tools have no position on the bar)
      const grip = el2('span', 'tool-mgr-grip', '⠿'); grip.title = tr('Drag to reorder');
      if (onBar(tool.id)) wireRowDrag(row, tool.id, () => dragTool, (v) => { dragTool = v; }, placeTool, render);
      else grip.style.visibility = 'hidden';

      row.append(grip, chk, iconCell, name, hk);

      const file = fileForTool(tool.id);
      if (file) {
        const edit = document.createElement('span'); edit.className = 'tool-ico'; edit.textContent = '✎'; edit.title = tr('Edit code');
        edit.onclick = () => editTool(file);
        const del = document.createElement('span'); del.className = 'tool-ico'; del.textContent = '✕'; del.title = tr('Delete tool');
        del.onclick = () => deleteTool(file, tool.id);
        row.append(edit, del);
      }
      list.appendChild(row);
    });

    // ---- Features (reorderable, but never added/removed) ----
    list.appendChild(el2('div', 'tool-mgr-sep'));
    list.appendChild(el2('div', 'tool-mgr-fhead', tr('Features')));
    featureOrder().forEach((id) => {
      const f = features[id]; if (!f) return;
      const row = document.createElement('div'); row.className = 'tool-mgr-row';
      const grip = el2('span', 'tool-mgr-grip', '⠿'); grip.title = tr('Drag to reorder');
      const noChk = el2('span', 'tool-chk'); noChk.style.visibility = 'hidden';   // no add/remove for features
      const iconCell = document.createElement('div'); iconCell.className = 'tool-icon-cell';
      const prev = el2('span', 'tool-icon-prev'); prev.appendChild(themeIcon(f.icon, 20)); iconCell.appendChild(prev);
      const name = el2('span', 'tool-mgr-name', tr(f.label));
      wireRowDrag(row, id, () => dragFeature, (v) => { dragFeature = v; }, placeFeature, render);
      row.append(grip, noChk, iconCell, name);
      list.appendChild(row);
    });
  };
  managerRender = render;
  render();

  document.body.appendChild(dlg);
  // center on open (fixed), then drag by the header
  dlg.style.position = 'fixed'; dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 2) + 'px';
  makeDraggable(dlg, head);
}
