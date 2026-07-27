// @ts-check
// Indicators Library modal: search + a sidebar (Favorites · On chart · All ·
// your own lists) + the indicator list. You organize indicators into categories
// you create; the ƒx button opens this instead of a flat dropdown.
import { listStudies, getStudy, unregisterStudy } from './registry.js';
import * as lib from './library-store.js';
import { fileForStudy, reloadUserFile } from './user-loader.js';
import { openEditor } from './editor.js';
import { getActivePane } from '../chart/layout.js';
import { log } from '../dom.js';
import { confirmDialog } from '../ui/confirm.js';
import { makeDraggable } from '../ui/draggable.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup (list + study names may be user data; fall back to English)

/** Which slice of the library is shown: all studies, favorites, or one user category. */
/** @typedef {{ type: string, catId?: string }} LibView */
/** The cached body sub-elements the render functions write into. */
/** @typedef {{ side: HTMLElement, list: HTMLElement, search: HTMLInputElement }} LibEls */

/** @param {string} tag @param {string|null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @type {HTMLElement | null} */
let panel = null;
/** @type {HTMLElement | null} */
let popover = null;
/** @type {LibEls | null} */
let els = null;
/** @type {{ view: LibView, search: string }} */
let state = { view: { type: 'all' }, search: '' };

export function openLibrary() {
  closeLibrary();
  // Floating (non-modal) panel so the chart stays interactive while it's open — no click-away close.
  const dlg = el('div', 'dialog lib'); panel = dlg; dlg.style.zIndex = '60';
  const head = el('div', 'lib-head');
  const x = el('span', 'lib-x', '✕'); x.onclick = closeLibrary;
  head.append(el('h3', null, 'Studies'), x);

  const search = /** @type {HTMLInputElement} */ (el('input', 'lib-search')); search.placeholder = t('Search'); search.value = state.search;
  search.oninput = () => { state.search = search.value.trim(); renderList(); };

  const body = el('div', 'lib-body');
  const side = el('div', 'lib-side');
  const list = el('div', 'lib-list');
  body.append(side, list);

  dlg.append(head, search, body);
  document.body.appendChild(dlg);
  // center on open (fixed), then drag by the header
  dlg.style.position = 'fixed'; dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 2) + 'px';
  makeDraggable(dlg, head);   // drag the dialog by its header

  els = { side, list, search };
  renderSide();
  renderList();
  search.focus();
}

export function closeLibrary() { closePopover(); if (panel) { panel.remove(); panel = null; } }

/** @param {string} label @param {string} icon @param {boolean} active @param {(e: MouseEvent) => void} onclick */
function navItem(label, icon, active, onclick) {
  const r = el('div', 'lib-nav' + (active ? ' active' : ''));
  r.append(el('span', 'lib-nav-ico', icon), el('span', 'lib-nav-lbl', t(label)));
  r.onclick = onclick;
  return r;
}
/** @param {LibView} view */
const go = (view) => { state.view = view; renderSide(); renderList(); };

function renderSide() {
  const s = /** @type {LibEls} */ (els).side; s.innerHTML = '';
  const v = state.view;

  s.append(navItem('All studies', '∑', v.type === 'all', () => go({ type: 'all' })));
  s.append(navItem('Favorites', '★', v.type === 'favorites', () => go({ type: 'favorites' })));
  const write = navItem('Write new', '✎', false, () => openEditor({ onSaved: () => go({ type: 'all' }) }));
  write.classList.add('lib-newlist'); s.append(write);
  const imp = navItem('Import .js', '⬆', false, () => importStudyFile());
  imp.classList.add('lib-newlist'); s.append(imp);

  s.append(el('div', 'lib-sec', t('My lists')));
  lib.categories().forEach((c) => {
    const r = navItem(c.name, '≡', v.type === 'category' && v.catId === c.id, () => go({ type: 'category', catId: c.id }));
    const tools = el('span', 'lib-nav-tools');
    const ren = el('span', 'lib-ico', '✎'); ren.title = 'Rename'; ren.onclick = (e) => { e.stopPropagation(); renameCat(c, r); };
    const del = el('span', 'lib-ico', '✕'); del.title = 'Delete list'; del.onclick = async (e) => {
      e.stopPropagation();
      if (!await confirmDialog({ title: t('Delete list'), message: t('Delete the list') + ` "${c.name}"? ` + t('The studies themselves stay under All studies.'), yes: t('Delete'), no: t('Cancel') })) return;
      lib.deleteCategory(c.id);
      if (v.type === 'category' && v.catId === c.id) state.view = { type: 'favorites' };
      renderSide(); renderList();
    };
    tools.append(ren, del); r.append(tools);
    s.append(r);
  });
  const add = navItem('New list', '＋', false, () => newCat());
  add.classList.add('lib-newlist');
  s.append(add);
}

/** @param {import('./library-store.js').StudyCategory} c @param {HTMLElement} rowEl */
function renameCat(c, rowEl) {
  const inp = /** @type {HTMLInputElement} */ (el('input', 'lib-rename')); inp.value = c.name;
  rowEl.innerHTML = ''; rowEl.appendChild(inp); inp.focus(); inp.select();
  const done = () => { const v = inp.value.trim(); if (v) lib.renameCategory(c.id, v); renderSide(); };
  inp.onblur = done;
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') renderSide(); };
}
function newCat() {
  const r = el('div', 'lib-nav active');
  const inp = /** @type {HTMLInputElement} */ (el('input', 'lib-rename')); inp.placeholder = t('List name');
  r.appendChild(inp); /** @type {LibEls} */ (els).side.appendChild(r); inp.focus();
  const done = () => { const v = inp.value.trim(); if (v) { const id = lib.addCategory(v); state.view = { type: 'category', catId: id }; } renderSide(); renderList(); };
  inp.onblur = done;
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') renderSide(); };
}

function renderList() {
  const L = /** @type {LibEls} */ (els).list; L.innerHTML = '';
  const pane = getActivePane();
  const q = state.search.toLowerCase();

  let ids;
  if (q || state.view.type === 'all') ids = listStudies().map((s) => s.id);
  else if (state.view.type === 'favorites') ids = lib.favorites();
  else if (state.view.type === 'category') { const c = lib.categories().find((c) => c.id === state.view.catId); ids = c ? c.items : []; }
  else ids = listStudies().map((s) => s.id);

  let rows = /** @type {NonNullable<ReturnType<typeof getStudy>>[]} */ (ids.map((id) => getStudy(id)).filter(Boolean));   // filter(Boolean) drops the undefined getStudy() misses, but TS can't narrow it
  if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q));

  if (!rows.length) {
    const msg = q ? t('No matches.')
      : state.view.type === 'favorites' ? t('No favorites yet — tap ☆ on any study.')
      : state.view.type === 'category' ? t('Empty list — tap the ⊞ on a study to add it here.')
      : t('Nothing here yet.');
    L.append(el('div', 'lib-empty', msg));
    return;
  }

  rows.forEach((s) => {
    const file = fileForStudy(s.id);
    const r = el('div', 'lib-row');
    const star = el('span', 'lib-star' + (lib.isFav(s.id) ? ' on' : ''), lib.isFav(s.id) ? '★' : '☆');
    star.onclick = (e) => { e.stopPropagation(); lib.toggleFav(s.id); renderList(); };
    const name = el('span', 'lib-name', t(s.name));
    const addto = el('span', 'lib-ico lib-addto', '⊞'); addto.title = t('Add to a list…');
    addto.onclick = (e) => { e.stopPropagation(); openCatPopover(s.id, addto); };
    r.append(star, name, addto);
    if (file) {
      const edit = el('span', 'lib-ico', '✎'); edit.title = t('Edit code');
      edit.onclick = (e) => { e.stopPropagation(); editStudy(s, file); };
      const del = el('span', 'lib-ico', '✕'); del.title = t('Delete');
      del.onclick = (e) => { e.stopPropagation(); deleteStudy(s, file); };
      r.append(edit, del);
    }
    r.onclick = () => { if (pane) { pane.studies.add(s.id); flash(r); log(t('Added') + ' ' + t(s.name) + '.'); renderSide(); } };
    L.append(r);
  });
}

/** @param {StudySpec} s @param {string} folder   the study's package folder id */
async function editStudy(s, folder) {
  const code = await fetch('/api/user-studies/file?name=' + encodeURIComponent(folder)).then((x) => x.json()).then((d) => d.code).catch(() => '');
  openEditor({ name: folder, code, onSaved: () => { renderSide(); renderList(); } });
}
/** @param {StudySpec} s @param {string} folder   the study's package folder id */
async function deleteStudy(s, folder) {
  if (!await confirmDialog({ title: t('Delete study'), message: t('Delete the study') + ` "${t(s.name)}"? ` + t('This permanently deletes its package folder from packages/studies.'), yes: t('Delete'), no: t('Cancel') })) return;
  await fetch('/api/user-studies/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folder }) }).catch(() => {});
  unregisterStudy(s.id);
  renderSide(); renderList();
}

function importStudyFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.js,text/javascript';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const code = await file.text();
    const name = file.name.replace(/\.js$/i, '');
    const r = await fetch('/api/user-studies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) { log(t('Import failed:') + ' ' + r.error, true); return; }
    try { await reloadUserFile(r.file); } catch (/** @type {any} */ e) { log(t('Imported, but failed to load:') + ' ' + (e.message || e), true); return; }
    log(t('Imported') + ' ' + r.file + '.');
    state.view = { type: 'all' };
    renderSide(); renderList();
  };
  inp.click();
}

// per-indicator "add to list" popover with checkboxes + create-new
/** @param {string} studyId @param {HTMLElement} anchor */
function openCatPopover(studyId, anchor) {
  closePopover();
  popover = el('div', 'lib-pop');
  lib.categories().forEach((c) => {
    const on = lib.inCategory(c.id, studyId);
    const row = el('div', 'lib-pop-row');
    row.append(el('span', 'lib-check' + (on ? ' on' : ''), on ? '☑' : '☐'), el('span', null, c.name));
    row.onclick = () => { lib.toggleMember(c.id, studyId); openCatPopover(studyId, anchor); renderList(); };
    /** @type {HTMLElement} */ (popover).append(row);
  });
  const add = el('div', 'lib-pop-row lib-pop-new');
  const inp = /** @type {HTMLInputElement} */ (el('input', 'lib-pop-input')); inp.placeholder = 'New list…';
  inp.onclick = (e) => e.stopPropagation();
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') { const v = inp.value.trim(); if (v) { const id = lib.addCategory(v); lib.toggleMember(id, studyId); openCatPopover(studyId, anchor); renderSide(); renderList(); } }
  };
  add.append(inp); popover.append(add);

  document.body.appendChild(popover);
  const rc = anchor.getBoundingClientRect();
  popover.style.left = Math.min(rc.left, window.innerWidth - 230) + 'px';
  popover.style.top = (rc.bottom + 4) + 'px';
}
function closePopover() { if (popover) { popover.remove(); popover = null; } }
document.addEventListener('click', (e) => { if (popover && !popover.contains(/** @type {Node | null} */ (e.target))) closePopover(); });

/** @param {HTMLElement} row */
function flash(row) { row.classList.add('added'); setTimeout(() => row.classList.remove('added'), 500); }
