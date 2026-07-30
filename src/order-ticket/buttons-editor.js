// @ts-check
// The quick-button GEAR EDITOR -- the modal the ticket's button bar opens (buttons.js): a TEMPLATE dropdown + one
// compact row per button [drag] [label] [script preview] [hotkey] [x]. Add / delete / drag-reorder, set a per-button
// hotkey (recorded live, conflicts refused), and switch / create / remove named templates (autosaved, palette-picker
// pattern). Done commits the edited buttons to the active template. The script preview opens the script dialog
// (script-dialog.js). Only openEditor crosses the module boundary.
import { parseScript } from '../../data_engine/index.js'; // pure parser -- flags an invalid script in the row preview
import { comboOf, isModifierKey, prettyCombo } from '../edit/combo.js'; // pure key-combo helpers for the hotkey recorder
import { requestAppCombos, appComboConflict } from '../edit/order-hotkeys.js'; // cross-window: the app's command/tool combos (conflict check)
import {
  templateButtons,
  activeTemplateId,
  getTemplate,
  templateList,
  setActiveTemplate,
  createTemplate,
  removeTemplate,
  setTemplateButtons,
  newId,
} from './templates-store.js'; // named button sets (autosaved)
import { openScriptDialog } from './script-dialog.js'; // the DSL script editor modal the row preview opens
import { t } from '../i18n/i18n.js'; // vocabulary lookup for the editor chrome (button labels + script text stay user data)

/** @typedef {import('./templates-store.js').ButtonDef} ButtonDef */

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};

// A per-button HOTKEY recorder cell (mirrors the toolbar's tool-hotkey cell). Click -> records the next Ctrl/Alt + key
// chord onto it.hotkey; Backspace clears, Esc cancels. A chord already taken by a command, a drawing tool, or another
// quick button is REFUSED with an inline note (findConflict) -- the user clears the other binding in its own dialog.
// Only one cell records at a time (hkRecording cancels a prior one).
/** @type {(() => void) | null} */
let hkRecording = null;
/** @param {ButtonDef} it @param {(combo: string) => { label: string, kind: string } | null} findConflict @param {(text: string, err?: boolean) => void} setMsg @returns {HTMLElement} */
function hotkeyCell(it, findConflict, setMsg) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.title = t('Click to record a shortcut (Ctrl/Alt + key). Backspace clears, Esc cancels.');
  const paint = () => {
    cell.className = 'ot-ed-hk' + (it.hotkey ? '' : ' empty');
    cell.textContent = it.hotkey ? prettyCombo(it.hotkey) : t('Set hotkey');
  };
  paint();
  cell.onclick = (e) => {
    e.stopPropagation();
    if (hkRecording) hkRecording(); // cancel any other recording cell
    setMsg('');
    cell.className = 'ot-ed-hk rec';
    cell.textContent = t('Press keys…');
    const onKey = (/** @type {KeyboardEvent} */ ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        done();
        return;
      }
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        it.hotkey = '';
        done();
        return;
      }
      if (isModifierKey(ev.key)) return; // wait for the real key
      if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) {
        setMsg(t('Use Ctrl or Alt with a key — a bare key would clash with typing.'), true);
        return;
      }
      const combo = comboOf(ev);
      const clash = findConflict(combo);
      if (clash) {
        // taken elsewhere -> refuse, explain WHY at the bottom, keep the old binding
        document.removeEventListener('keydown', onKey, true);
        hkRecording = null;
        paint();
        setMsg(
          prettyCombo(combo) +
            ' ' +
            t('is already used by') +
            ' “' +
            clash.label +
            '” (' +
            t(clash.kind) +
            '). ' +
            t('Clear it there first.'),
          true,
        );
        return;
      }
      it.hotkey = combo;
      done();
    };
    const done = () => {
      document.removeEventListener('keydown', onKey, true);
      hkRecording = null;
      setMsg('');
      paint();
    };
    hkRecording = done;
    document.addEventListener('keydown', onKey, true);
  };
  return cell;
}

// --- the gear editor: a TEMPLATE dropdown + one compact row per button [drag] [label] [script preview] [hotkey] [x].
// The preview opens the script dialog. Add / delete / drag-reorder, set a hotkey; Done commits the buttons to the
// active template. Switching / creating / removing a template autosaves immediately (palette-picker pattern). ---
/** @param {() => void} onClose refresh the ticket bar (re-read the active template) after any change */
export function openEditor(onClose) {
  const rootEl = /** @type {HTMLElement} */ (document.getElementById('order-root'));
  const overlay = document.createElement('div');
  overlay.className = 'ot-editor';
  requestAppCombos(); // refresh the command/tool combo cache from the chart window before recording

  /** @type {ButtonDef[]} an editable copy of the ACTIVE template's buttons */
  let items = templateButtons(activeTemplateId()).map((b) => ({ ...b }));
  // write the edited buttons back into the active template (dropping half-authored rows). Autosaves through the store.
  const commit = () => {
    const id = activeTemplateId();
    if (id)
      setTemplateButtons(
        id,
        items.filter((b) => b.label && b.script),
      );
  };
  // adding a button needs a template to hold it; if none is active yet, create one (like the colour picker's "My Colors").
  const ensureTemplate = () => {
    if (!activeTemplateId()) createTemplate();
  };

  // a chord is refused if it's taken by another button in THIS list, or by a command/drawing-tool (bus). We block
  // (never steal) across dialogs -- the user clears the other binding in its own settings. @param {string} combo
  const findConflict = (/** @type {string} */ combo, /** @type {string} */ selfId) => {
    const other = items.find((b) => b.id !== selfId && b.hotkey === combo);
    if (other) return { label: other.label || other.script || t('another button'), kind: 'quick button' };
    return appComboConflict(combo); // a command or a drawing tool, from the chart window
  };

  const head = document.createElement('div');
  head.className = 'ot-ed-head';
  const title = document.createElement('span');
  title.textContent = t('Quick buttons');
  const closeX = document.createElement('button');
  closeX.type = 'button';
  closeX.className = 'ot-ed-x';
  closeX.textContent = '✕';
  closeX.title = t('Close');
  closeX.onclick = () => {
    onClose();
    overlay.remove();
  }; // discard uncommitted button edits; template ops already autosaved
  head.append(title, closeX);

  // a bottom status line (mirrors the script dialog's error line): explains WHY a chord was refused, since the
  // recorder cell reverts silently. Cleared on the next recording / a valid assignment.
  const msg = document.createElement('div');
  msg.className = 'ot-ed-msg';
  /** @param {string} text @param {boolean} [err] */
  const setMsg = (text, err) => {
    msg.textContent = text || '';
    msg.className = 'ot-ed-msg' + (err ? ' err' : '');
  };

  const listEl = document.createElement('div');
  listEl.className = 'ot-ed-list';
  let dragFrom = -1;
  const clearDropMarks = () =>
    [...listEl.children].forEach((c) => c.classList.remove('dragging', 'drop-above', 'drop-below'));
  const render = () => {
    listEl.innerHTML = '';
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'ot-ed-empty';
      e.textContent = t('No buttons — add one below.');
      listEl.appendChild(e);
    }
    items.forEach((it, i) => {
      const r = document.createElement('div');
      r.className = 'ot-ed-row';
      const handle = document.createElement('span');
      handle.className = 'ot-ed-drag';
      handle.textContent = '⠿';
      handle.title = t('Drag to reorder');
      handle.draggable = true;
      handle.ondragstart = (/** @type {any} */ e) => {
        dragFrom = i;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setDragImage(r, 12, 14);
          } catch (_) {}
        }
        r.classList.add('dragging');
      };
      handle.ondragend = () => {
        dragFrom = -1;
        clearDropMarks();
      };
      const lab = document.createElement('input');
      lab.className = 'ot-input ot-ed-label';
      lab.value = it.label;
      lab.placeholder = t('Label');
      lab.oninput = () => {
        it.label = lab.value;
      };
      // script PREVIEW -- abbreviated (CSS ellipsis); click opens the full script dialog
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'ot-ed-scriptpreview';
      preview.title = t('Edit script');
      const paintPreview = () => {
        preview.textContent = it.script || t('(click to add a script)');
        try {
          if (it.script) parseScript(it.script);
          preview.classList.remove('invalid');
        } catch (_) {
          preview.classList.add('invalid');
        }
      };
      preview.onclick = () =>
        openScriptDialog(it.script, (val) => {
          it.script = val;
          paintPreview();
        });
      paintPreview();
      const hk = hotkeyCell(it, (combo) => findConflict(combo, it.id), setMsg); // fixed HOTKEY column: records a chord, refuses one already in use (reason shown at the bottom)
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ot-ed-mini';
      del.textContent = '✕';
      del.title = t('Remove');
      del.onclick = () => {
        items.splice(i, 1);
        render();
      };
      r.append(handle, lab, preview, hk, del);
      r.ondragover = (/** @type {any} */ e) => {
        if (dragFrom === -1) return;
        e.preventDefault();
        const rect = r.getBoundingClientRect();
        const below = e.clientY > rect.top + rect.height / 2;
        r.classList.toggle('drop-below', below && dragFrom !== i);
        r.classList.toggle('drop-above', !below && dragFrom !== i);
      };
      r.ondragleave = () => {
        r.classList.remove('drop-above', 'drop-below');
      };
      r.ondrop = (/** @type {any} */ e) => {
        if (dragFrom === -1) return;
        e.preventDefault();
        const rect = r.getBoundingClientRect();
        let to = e.clientY > rect.top + rect.height / 2 ? i + 1 : i;
        const moved = items.splice(dragFrom, 1)[0];
        if (dragFrom < to) to--;
        items.splice(to, 0, moved);
        dragFrom = -1;
        render();
      };
      listEl.appendChild(r);
    });
  };

  const foot = document.createElement('div');
  foot.className = 'ot-ed-foot';
  // template dropdown (left) -- switch / create / remove the named button set. Switching commits the current edits
  // first, then loads the chosen template's buttons into the list.
  const dd = buildTemplateDropdown({
    commit,
    reload: () => {
      items = templateButtons(activeTemplateId()).map((b) => ({ ...b }));
      render();
    },
    changed: onClose,
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ot-btn-close';
  add.textContent = t('Add');
  add.onclick = () => {
    ensureTemplate();
    dd.refreshName();
    items.push({ id: newId('b'), label: '', script: '' });
    render();
    const labs = listEl.querySelectorAll('.ot-ed-label');
    const last = /** @type {HTMLElement} */ (labs[labs.length - 1]);
    if (last) last.focus();
  };
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'ot-btn-primary';
  done.textContent = t('Done');
  done.onclick = () => {
    commit();
    onClose();
    overlay.remove();
  };
  foot.append(dd.wrap, add, done);

  overlay.append(head, listEl, msg, foot);
  render();
  rootEl.appendChild(overlay);
}

// The template selector shown in the editor footer: a button showing the active template + a menu to switch, create
// ("New template…"), or remove one (the "×" per row) -- the same pattern as the colour picker's palette dropdown.
/** @param {{ commit: () => void, reload: () => void, changed: () => void }} h @returns {{ wrap: HTMLElement, refreshName: () => void }} */
function buildTemplateDropdown(h) {
  const wrap = el('div', 'ot-tpldd');
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'ot-tpldd-btn'));
  btn.type = 'button';
  const name = el('span', 'ot-tpldd-name');
  btn.append(name, el('span', 'ot-tpldd-caret', '▾'));
  wrap.appendChild(btn);
  const refreshName = () => {
    const tpl = getTemplate(activeTemplateId());
    name.textContent = tpl ? tpl.name : t('No template');
  };
  refreshName();

  /** @type {HTMLElement | null} */
  let menu = null;
  /** @type {((e: PointerEvent) => void) | null} */
  let outside = null;
  const closeMenu = () => {
    if (!menu) return;
    if (outside) document.removeEventListener('pointerdown', outside, true);
    menu.remove();
    menu = null;
    outside = null;
  };
  /** @param {string} id */
  const select = (id) => {
    h.commit();
    setActiveTemplate(id);
    h.reload();
    refreshName();
    h.changed();
    closeMenu();
  };
  const openMenu = () => {
    closeMenu();
    const m = el('div', 'ot-tplmenu');
    menu = m;
    const rebuild = () => {
      m.innerHTML = '';
      templateList().forEach((tpl) => {
        const r = el('div', 'ot-tplmenu-row' + (tpl.id === activeTemplateId() ? ' sel' : ''));
        const nm = el('span', 'ot-tplmenu-name', tpl.name);
        nm.onclick = () => select(tpl.id);
        const x = /** @type {HTMLButtonElement} */ (el('button', 'ot-tplmenu-x', '×'));
        x.type = 'button';
        x.title = t('Remove template');
        x.onclick = (e) => {
          e.stopPropagation();
          removeTemplate(tpl.id);
          h.reload();
          refreshName();
          h.changed();
          rebuild();
        };
        r.append(nm, x);
        m.appendChild(r);
      });
      const addRow = el('div', 'ot-tplmenu-row ot-tplmenu-new');
      const inp = /** @type {HTMLInputElement} */ (el('input', 'ot-tplmenu-input'));
      inp.placeholder = t('New template…');
      inp.onclick = (e) => e.stopPropagation();
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const v = inp.value.trim();
          if (v) {
            h.commit();
            createTemplate(v);
            h.reload();
            refreshName();
            h.changed();
            closeMenu();
          }
        }
      };
      addRow.appendChild(inp);
      m.appendChild(addRow);
    };
    rebuild();
    wrap.appendChild(m);
    outside = (e) => {
      if (menu && !m.contains(/** @type {Node} */ (e.target)) && !btn.contains(/** @type {Node} */ (e.target)))
        closeMenu();
    };
    setTimeout(() => {
      if (outside) document.addEventListener('pointerdown', outside, true);
    }, 0);
  };
  btn.onclick = () => {
    if (menu) closeMenu();
    else openMenu();
  };
  return { wrap, refreshName };
}
