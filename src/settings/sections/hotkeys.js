// @ts-check
// Settings -> Hotkeys section. Lists every command grouped by category with a rebind recorder
// (click a cell, press a chord), the read-only wildcard behaviors, the reference gestures, and any
// per-tool drawing shortcuts. Rebinding writes a user override (commands/keybindings.js) that the
// hotkey dispatcher picks up live -- no restart.
import { getSetting, setSetting } from '../settings.js';
import { hotkeyCatalog, toolHotkeyCatalog, comboOf, isModifierKey, prettyCombo } from '../../edit/hotkeys.js';
import { toolHotkeys } from '../../tools/toolbar-store.js';
import { listCommands } from '../../commands/registry.js';
import { keyFor, setKeybinding } from '../../commands/keybindings.js';
import { getJSON } from '../../api.js';   // read the order-ticket quick buttons (they carry hotkeys too -- surfaced here so the two dialogs stay aware of each other)
import { t } from '../../i18n/i18n.js';   // vocabulary lookup for command titles, categories, gestures

// The full engine gesture list lives in the docs (too many to mirror). Point at the source page
// until the docs site is deployed; update to the published URL once it's live.
const HOTKEYS_DOC_URL = 'https://github.com/ether-strannik/plain_charts_vanilla/blob/main/docs/web/src/pages/docs/hotkeys.md';

/** cancel fn for the currently-recording cell (only one records at a time). @type {(() => void) | null} */
let recording = null;

// A rebind recorder cell for a command. Click -> capture the next chord; a bare letter/number is
// rejected (reserved for the change-symbol / change-interval quick-search). Backspace clears
// (explicit unbind), Esc cancels. A chord already held by a drawing tool or an order-ticket quick
// button is REFUSED (cross-kind clash -- clashOf); a command-on-command clash is fine (setKeybinding steals).
/** @param {{ id: string, title: string }} cmd @param {() => void} refresh @param {(combo: string) => { label: string, kind: string } | null} clashOf */
function cmdHotkeyCell(cmd, refresh, clashOf) {
  const cur = keyFor(cmd.id);
  const cell = document.createElement('span');
  cell.className = 'tool-hk' + (cur ? '' : ' empty');
  cell.textContent = cur ? prettyCombo(cur) : t('Set hotkey');
  cell.title = t('Click to record a shortcut. Backspace clears, Esc cancels. Bare letters/numbers are reserved.');
  cell.onclick = (e) => {
    e.stopPropagation();
    if (recording) recording();
    cell.classList.remove('empty'); cell.classList.add('rec');
    cell.textContent = t('Press keys…');
    const onKey = (/** @type {KeyboardEvent} */ ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === 'Escape') { done(false); return; }
      if (ev.key === 'Backspace' || ev.key === 'Delete') { setKeybinding(cmd.id, ''); done(true); return; }
      if (isModifierKey(ev.key)) return;                                   // wait for the real key
      const bareAlnum = !(ev.ctrlKey || ev.metaKey || ev.altKey) && ev.key.length === 1 && /[a-zA-Z0-9,]/.test(ev.key);
      if (bareAlnum) { cell.textContent = t('Reserved -- add a modifier'); return; }
      const combo = comboOf(ev);
      const clash = clashOf(combo);
      if (clash) {   // taken by a tool or a quick button -> refuse, name the owner, keep the old binding
        document.removeEventListener('keydown', onKey, true); recording = null;
        cell.classList.remove('rec'); cell.classList.add('empty'); cell.textContent = prettyCombo(combo) + ' — ' + t('in use');
        cell.title = t('Used by') + ' ' + clash.label + ' (' + t(clash.kind) + ')';
        return;
      }
      setKeybinding(cmd.id, combo);
      done(true);
    };
    /** @param {boolean} changed */
    const done = (changed) => {
      document.removeEventListener('keydown', onKey, true);
      recording = null;
      if (changed) { refresh(); return; }
      cell.classList.remove('rec');
      cell.classList.toggle('empty', !cur);
      cell.textContent = cur ? prettyCombo(cur) : t('Set hotkey');
    };
    recording = () => done(false);
    document.addEventListener('keydown', onKey, true);
  };
  return cell;
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section } = ctx;

  // order-ticket quick buttons carry their own hotkeys (order-buttons.json). Loaded here so this panel can
  // both REFUSE a command chord that collides with one (clashOf) and LIST them read-only (awareness).
  /** @type {Array<{ label: string, hotkey: string }>} */
  let quickButtons = [];

  // a read-only reference row (label + description), with an optional enable/disable checkbox
  const hkRow = (/** @type {{ label: string, desc: string, toggleKey?: string }} */ h) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(h.label);
    const d = document.createElement('span'); d.className = 'hk-desc'; d.textContent = t(h.desc);
    r.append(l, d);
    if (h.toggleKey) {
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'hk-toggle';
      cb.checked = getSetting(h.toggleKey) !== false; cb.title = t('Enable / disable this hotkey');
      cb.onchange = () => setSetting(/** @type {string} */ (h.toggleKey), cb.checked);
      r.append(cb);
    }
    content.appendChild(r);
  };

  // a chord held by a drawing TOOL or a quick BUTTON (cross-kind) -> the owner, so a command rebind is refused.
  // A command-on-command clash is NOT reported here (setKeybinding reassigns within commands). @param {string} combo
  const clashOf = (/** @type {string} */ combo) => {
    const th = toolHotkeys();
    const toolCat = toolHotkeyCatalog();
    for (const id in th) { if (th[id] === combo) { const c = toolCat.find((x) => x.id === id); return { label: (c && c.label) || id, kind: 'drawing tool' }; } }
    const b = quickButtons.find((x) => x.hotkey === combo);
    if (b) return { label: b.label, kind: 'quick button' };
    return null;
  };

  const draw = () => {
    content.innerHTML = '';

    // --- rebindable commands, grouped by category ---
    // Only commands that SHIP with a keyboard key (`defaultKey`) are keyboard actions and belong here. Many registered
    // commands are menu/AI actions with no key (e.g. Add study, Add drawing, Apply theme) -- listing those gave each a
    // meaningless "Set hotkey" slot for something a keystroke can't do (they need args). They are not shown.
    const cmds = listCommands();
    /** @type {Map<string, typeof cmds>} */
    const byCat = new Map();
    cmds.filter((c) => !c.wildcard && c.defaultKey).forEach((c) => {
      const cat = c.category || 'General';
      if (!byCat.has(cat)) byCat.set(cat, []);
      (byCat.get(cat) || []).push(c);
    });
    for (const [cat, rows] of byCat) {
      section(t(cat).toUpperCase());
      rows.forEach((c) => {
        const r = document.createElement('div'); r.className = 'sd-row';
        const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(c.title);
        r.append(l, cmdHotkeyCell(c, draw, clashOf));
        content.appendChild(r);
      });
    }

    // --- wildcard behaviors (bare-key, not rebindable) ---
    const wilds = cmds.filter((c) => c.wildcard);
    if (wilds.length) {
      section(t('QUICK INPUT'));
      wilds.forEach((c) => hkRow({ label: c.title, desc: c.wildcard === 'letter' ? t('Any letter key') : t('Any number key, or ,') }));
    }

    // --- reference gestures + the full-list doc link ---
    section(t('GESTURES'));
    const note = document.createElement('div'); note.className = 'sd-row';
    const nl = document.createElement('span'); nl.className = 'sd-label'; nl.textContent = t('Full hotkey reference');
    const a = document.createElement('a'); a.className = 'hk-desc'; a.textContent = t('Open documentation →');
    a.style.cursor = 'pointer'; a.onclick = () => window.open(HOTKEYS_DOC_URL, '_blank', 'noopener');
    note.append(nl, a); content.appendChild(note);
    hotkeyCatalog().forEach(hkRow);

    // --- per-tool drawing shortcuts the user assigned (recorded in the toolbar manager) ---
    const tools = toolHotkeyCatalog();
    if (tools.length) { section(t('DRAWING TOOLS')); tools.forEach(hkRow); }

    // --- order-ticket quick-button shortcuts (read-only here; edited in the order dialog's button editor) ---
    const qb = quickButtons.filter((b) => b.hotkey);
    if (qb.length) { section(t('QUICK BUTTONS')); qb.forEach((b) => hkRow({ label: b.label, desc: prettyCombo(b.hotkey) })); }
  };

  draw();
  // pull the quick buttons, then redraw so their chords appear + block command rebinds
  getJSON('/api/order-buttons').then((d) => {
    const list = d && Array.isArray(d.buttons) ? d.buttons : [];
    quickButtons = list.filter((/** @type {any} */ b) => b && typeof b.hotkey === 'string' && b.hotkey).map((/** @type {any} */ b) => ({ label: b.label || b.script || t('quick button'), hotkey: b.hotkey }));
    if (quickButtons.length) draw();
  }).catch(() => {});
}
