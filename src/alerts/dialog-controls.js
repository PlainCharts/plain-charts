// @ts-check
// Form-control BUILDERS for the create-alert dialog -- pure DOM/view widgets (a leaf: no store, no funnel, no alert
// logic). Each returns { el, get() } (or similar) that the dialog composes. Also holds the shared el()/roundPrice()
// helpers and the per-control option lists. Kept apart from create-alert-dialog.js so that file is just assembly +
// openers; nothing here reaches into the engine.
import { t } from '../i18n/i18n.js';
import { openDateTimePicker, formatDateTime } from '../ui/datetime-picker.js';

/** @param {string} tag @param {string | null} [cls] @param {string} [txt] @returns {HTMLElement} */
export const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** round a price to the instrument's decimals (2 = index futures, 5 = forex, …). @param {any} v @param {number} [dec] */
export const roundPrice = (v, dec) => {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(dec != null ? dec : 2)) : n;
};

// Expiration presets + the per-control option lists — LABELS ONLY (no sub-text). Trigger cadences
// live with the dialog (it owns that choice via selectOf); these lists are consumed inside their own controls here.
const EXPIRATIONS = ['Open-ended', 'End of day', '1 week', '1 month', 'Custom date'];
// (Condition operators live with the Add-condition dialog now -- conditions here are a sentence LIST.)
// Message placeholder tokens — clicked into the message text; the engine substitutes them when the
// alert fires. Kept as literal `#tags` (NOT translated) so a message is portable across languages.
const PLACEHOLDERS = ['#symbol', '#broker', '#interval', '#timenow', '#price'];
// Actions the alert can run when it fires (chosen per row in the Actions table). The three notification
// deliveries are independent user preferences: Toast (corner, auto-dismiss), System notification (OS tray,
// persists), Popup window (center of workspace, stays until dismissed).
const ACTIONS = [
  'Toast notification',
  'System notification',
  'Popup window',
  'Send email',
  'Telegram notification',
  'Play sound',
  'Webhook URL',
];

// One collapsible section: a header (disclosure triangle + title, optional right-corner accessory)
// over a body. `fill` populates the body; `headExtra` is pinned to the header's right.
/** @param {string} title @param {(body: HTMLElement) => void} [fill] @param {HTMLElement} [headExtra] @returns {HTMLElement} */
export function section(title, fill, headExtra) {
  const sec = el('div', 'aldlg-sec');
  const head = el('div', 'aldlg-sec-head');
  const tri = el('span', 'aldlg-sec-tri', '▼');
  head.append(tri, el('span', 'aldlg-sec-title', title));
  if (headExtra) head.appendChild(headExtra);
  const body = el('div', 'aldlg-sec-body');
  if (fill) fill(body);
  else sec.classList.add('aldlg-sec-empty');
  head.onclick = () => {
    const c = sec.classList.toggle('collapsed');
    tri.textContent = c ? '▶' : '▼';
  };
  sec.append(head, body);
  return sec;
}

// Play/pause enable toggle for the alert. Enabled = "playing" (pause glyph shown, click to pause);
// disabled = "paused" (play glyph shown, click to enable). Returns { el, get() }.
const SVG_PLAY =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><circle cx="8" cy="8" r="6.4"/><path d="M6.6 5.4 10.4 8l-3.8 2.6V5.4Z" fill="currentColor"/></svg>';
const SVG_PAUSE =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><circle cx="8" cy="8" r="6.4"/><path d="M6.4 5.6v4.8M9.6 5.6v4.8"/></svg>';
/** @param {boolean} [initial] @returns {{ el: HTMLElement, get: () => boolean }} */
export function enableToggle(initial = true) {
  let on = initial;
  const btn = el('button', 'aldlg-play');
  const paint = () => {
    btn.innerHTML = on ? SVG_PAUSE : SVG_PLAY;
    btn.title = on ? t('Enabled') : t('Paused');
    btn.classList.toggle('off', !on);
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    on = !on;
    paint();
  }; // don't collapse the section
  paint();
  return { el: btn, get: () => on };
}

// Interval picker -- the ALERT'S OWN timeframe, set here instead of inherited from whatever chart is open.
// Favourite intervals render as segments; "Other" opens the full configured list. The tf catalog is passed IN
// (favIds + allTfs) so this stays a view leaf with no engine import. Returns { el, get() } -> the selected id.
/** @param {string} initId @param {string[]} favIds @param {{ id:string }[]} allTfs @param {(id:string)=>void} [onChange]
 *  @returns {{ el: HTMLElement, get: () => string }} */
export function intervalControl(initId, favIds, allTfs, onChange) {
  let cur = initId || favIds[0] || (allTfs[0] && allTfs[0].id) || '';
  const wrap = el('div', 'aldlg-tf');
  /** @type {HTMLElement|null} */ let menu = null;
  /** @type {((e: PointerEvent) => void)|null} */ let away = null;
  const closeMenu = () => {
    if (away) {
      document.removeEventListener('pointerdown', /** @type {any} */ (away), true);
      away = null;
    }
    if (menu) {
      menu.remove();
      menu = null;
    }
  };
  /** @param {string} id */
  const setCur = (id) => {
    cur = id;
    paint();
    if (onChange) onChange(id);
  };
  const paint = () => {
    closeMenu();
    wrap.innerHTML = '';
    wrap.append(el('span', 'aldlg-tf-lbl', t('Interval') + ':'));
    const segs = favIds.slice();
    if (cur && segs.indexOf(cur) < 0) segs.push(cur); // always surface the current pick as a segment, fav or not
    segs.forEach((id) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'aldlg-tf-seg' + (id === cur ? ' active' : ''), id));
      b.type = 'button';
      b.onclick = (e) => {
        e.preventDefault();
        setCur(id);
      };
      wrap.appendChild(b);
    });
    const other = /** @type {HTMLButtonElement} */ (el('button', 'aldlg-tf-other'));
    other.type = 'button';
    other.append(el('span', null, t('Other')), el('span', 'aldlg-caret', '⌄'));
    other.onclick = () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el('div', 'dwg-menu');
      allTfs.forEach((tf) => {
        const row = el('div', 'dwg-item');
        row.append(el('span', 'dwg-check', tf.id === cur ? '✓' : ''), el('span', 'dwg-label', tf.id));
        row.onclick = () => {
          setCur(tf.id);
        };
        /** @type {HTMLElement} */ (menu).appendChild(row);
      });
      document.body.appendChild(menu);
      const r = other.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = r.bottom + 4 + 'px';
      away = (e) => {
        if (
          menu &&
          !menu.contains(/** @type {Node} */ (e.target)) &&
          e.target !== other &&
          !other.contains(/** @type {Node} */ (e.target))
        )
          closeMenu();
      };
      setTimeout(
        () => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (away), true),
        0,
      );
    };
    wrap.appendChild(other);
  };
  paint();
  return { el: wrap, get: () => cur };
}

// A labelled field row inside a section body.
/** @param {string} label @param {HTMLElement} control @returns {HTMLElement} */
export function field(label, control) {
  const r = el('div', 'aldlg-frow');
  r.append(
    el('label', null, label),
    (() => {
      const c = el('div', 'aldlg-fctl');
      c.appendChild(control);
      return c;
    })(),
  );
  return r;
}

// A select built from label-only options.
/** @param {string[]} options @returns {HTMLSelectElement} */
export function selectOf(options) {
  const s = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-sel'));
  options.forEach((o) => {
    const op = /** @type {HTMLOptionElement} */ (el('option', null, t(o)));
    op.value = o;
    s.appendChild(op);
  });
  return s;
}

// Resolve an expiration preset to an absolute epoch ms (local), or null for open-ended.
/** @param {string} kind @param {number|null} customMs @returns {number|null} */
function resolveExpiry(kind, customMs) {
  const now = new Date();
  if (kind === 'End of day') return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0).getTime();
  if (kind === '1 week') return now.getTime() + 7 * 86400000;
  if (kind === '1 month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  if (kind === 'Custom date') return customMs;
  return null; // Open-ended
}

// Expiration control: a custom dropdown whose COLLAPSED label shows the resolved date+time
// ("August 18, 2026 at 23:48"), while the menu lists only the type labels. "Custom date" opens the
// universal picker. Returns { el, kind(), ms() }.
/** @param {string} [initKind] @param {number|null} [initMs] @returns {{ el: HTMLElement, kind: () => string, ms: () => number|null }} */
export function expirationControl(initKind, initMs) {
  let kind = initKind || 'Open-ended';
  /** @type {number|null} */
  let customMs = initMs != null ? initMs : null;
  /** @type {HTMLElement|null} */
  let menu = null;
  /** @type {((e: PointerEvent) => void)|null} */
  let away = null;

  const btn = el('div', 'aldlg-drop');
  const lbl = el('span', 'aldlg-drop-lbl');
  btn.append(lbl, el('span', 'aldlg-caret', '⌄'));
  const paint = () => {
    lbl.textContent =
      kind === 'Open-ended' ? t('Open-ended') : formatDateTime(/** @type {number} */ (resolveExpiry(kind, customMs)));
  };

  const closeMenu = () => {
    if (away) {
      document.removeEventListener('pointerdown', away, true);
      away = null;
    }
    if (menu) {
      menu.remove();
      menu = null;
    }
  };
  /** @param {string} k */
  const pick = (k) => {
    closeMenu();
    if (k === 'Custom date') {
      openDateTimePicker({
        value: customMs != null ? customMs : undefined,
        title: t('Set custom date'),
        onSet: (v) => {
          customMs = v;
          kind = 'Custom date';
          paint();
        },
      });
      return;
    }
    kind = k;
    paint();
  };
  btn.onclick = () => {
    if (menu) {
      closeMenu();
      return;
    }
    menu = el('div', 'dwg-menu');
    EXPIRATIONS.forEach((k) => {
      const row = el('div', 'dwg-item');
      row.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t(k)));
      row.onclick = () => pick(k);
      /** @type {HTMLElement} */ (menu).appendChild(row);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.minWidth = r.width + 'px';
    away = (e) => {
      if (
        menu &&
        !menu.contains(/** @type {Node|null} */ (e.target)) &&
        e.target !== btn &&
        !btn.contains(/** @type {Node|null} */ (e.target))
      )
        closeMenu();
    };
    setTimeout(
      () => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (away), true),
      0,
    );
  };
  paint();
  return { el: btn, kind: () => kind, ms: () => resolveExpiry(kind, customMs) };
}

// Conditions LIST: the alert dialog shows each condition as ONE SENTENCE ("Price Crossing 7700") -- no
// column grid, so any alert family fits without new columns. Crafting/editing happens in the Add-condition
// dialog (the caller wires openEditor); this widget lists, adds, edits, removes, and owns the All/Any line.
/** @param {any[]} [initRows]  existing condition rows (edit mode / entry-flow prefill)
 *  @param {string} [initMatch]  saved match mode ('All' | 'Any')
 *  @param {{ sentence: (r: any) => string, openEditor: (row: (any|null), done: (row: any) => void) => void,
 *    onChange?: (ui: any) => void }} [opts]
 *  @returns {{ el: HTMLElement, get: () => any }} */
export function conditionsListControl(initRows, initMatch, opts = { sentence: () => '', openEditor: () => {} }) {
  /** @type {any[]} */
  const rows = (initRows || []).map((r) => ({ ...r }));
  const wrap = el('div', 'aldlg-cond');
  // "If [All | Any] of the following conditions are met" -- All = every condition must fire, Any = at least one.
  const matchLine = el('div', 'aldlg-cond-match');
  const matchSel = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-cond-msel'));
  ['All', 'Any'].forEach((o) => {
    const op = /** @type {HTMLOptionElement} */ (el('option', null, t(o)));
    op.value = o;
    matchSel.appendChild(op);
  });
  matchSel.value = /any/i.test(initMatch || 'all') ? 'Any' : 'All';
  matchLine.append(
    document.createTextNode(t('If') + ' '),
    matchSel,
    document.createTextNode(' ' + t('of the following conditions are met')),
  );
  const readAll = () => ({ match: matchSel.value, conditions: rows.map((r) => ({ ...r })) });
  const notify = () => {
    if (opts.onChange) opts.onChange(readAll());
  };
  matchSel.onchange = notify;

  const listEl = el('div', 'aldlg-clist');
  const acts = el('div', 'aldlg-cond-acts');
  const addLink = el('span', 'aldlg-cond-act', '+ ' + t('Add condition'));
  addLink.onclick = () =>
    opts.openEditor(null, (row) => {
      rows.push(row);
      render();
      notify();
    });
  acts.append(addLink);

  const render = () => {
    listEl.innerHTML = '';
    if (!rows.length) listEl.appendChild(el('div', 'aldlg-clist-empty', t('No conditions set')));
    rows.forEach((r, i) => {
      const rowEl = el('div', 'aldlg-clist-row');
      rowEl.appendChild(el('span', 'aldlg-clist-txt', opts.sentence(r)));
      const edit = el('span', 'aldlg-clist-btn', '✎');
      edit.title = t('Edit condition');
      edit.onclick = () =>
        opts.openEditor({ ...r }, (row) => {
          rows[i] = row;
          render();
          notify();
        });
      const del = el('span', 'aldlg-clist-btn', '✕');
      del.title = t('remove');
      del.onclick = () => {
        rows.splice(i, 1);
        render();
        notify();
      };
      rowEl.append(edit, del);
      listEl.appendChild(rowEl);
    });
  };
  render();

  wrap.append(matchLine, listEl, acts);
  return { el: wrap, get: readAll };
}

// Actions table: a single column of action dropdowns. Same idiom as conditions — click a row to select,
// add appends + selects, remove deletes the selection, edit focuses it. Returns { el, get() }.
/** @param {string[]} [initActions]  existing actions (edit mode) @returns {{ el: HTMLElement, get: () => string[] }} */
export function actionsControl(initActions) {
  /** @type {{ action: string }[]} */
  const rows = initActions && initActions.length ? initActions.map((a) => ({ action: a })) : [{ action: ACTIONS[0] }];
  const wrap = el('div', 'aldlg-cond');

  const table = el('div', 'aldlg-cond-table aldlg-cond-1col');
  const hrow = el('div', 'aldlg-cond-row aldlg-cond-head');
  hrow.append(el('div', 'aldlg-cond-cell', t('Action')));
  const bodyEl = el('div', 'aldlg-cond-tbody');
  table.append(hrow, bodyEl);

  const acts = el('div', 'aldlg-cond-acts');
  const addLink = el('span', 'aldlg-cond-act', t('add'));
  const removeLink = el('span', 'aldlg-cond-act', t('remove'));
  acts.append(addLink, removeLink); // no "edit" — the action dropdown is already inline-editable

  let sel = 0;
  /** @type {HTMLElement[]} */
  const rowEls = [];
  const applySel = () => {
    rowEls.forEach((rw, i) => rw.classList.toggle('sel', i === sel));
    const has = sel >= 0 && sel < rows.length;
    removeLink.classList.toggle('disabled', !has || rows.length <= 1);
  };
  /** @param {string} val @param {(v: string) => void} onset @returns {HTMLSelectElement} */
  const actSel = (val, onset) => {
    const s = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-cond-op'));
    ACTIONS.forEach((o) => {
      const op = /** @type {HTMLOptionElement} */ (el('option', null, t(o)));
      op.value = o;
      s.appendChild(op);
    });
    s.value = val;
    s.onchange = () => onset(s.value);
    return s;
  };
  const render = () => {
    bodyEl.innerHTML = '';
    rowEls.length = 0;
    rows.forEach((r, i) => {
      const row = el('div', 'aldlg-cond-row');
      const c = el('div', 'aldlg-cond-cell');
      c.appendChild(
        actSel(r.action, (v) => {
          r.action = v;
        }),
      );
      row.append(c);
      row.onclick = () => {
        sel = i;
        applySel();
      };
      bodyEl.appendChild(row);
      rowEls.push(row);
    });
    applySel();
  };
  addLink.onclick = () => {
    rows.push({ action: ACTIONS[0] });
    sel = rows.length - 1;
    render();
  };
  removeLink.onclick = () => {
    if (sel >= 0 && sel < rows.length && rows.length > 1) {
      rows.splice(sel, 1);
      sel = Math.min(sel, rows.length - 1);
      render();
    }
  };
  render();

  wrap.append(table, acts);
  return { el: wrap, get: () => rows.map((r) => r.action) };
}

// Insert a token at the textarea's caret, keeping single spaces around it.
/** @param {HTMLTextAreaElement} ta @param {string} token */
function insertToken(ta, token) {
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : s;
  const before = ta.value.slice(0, s),
    after = ta.value.slice(e);
  const lead = before && !before.endsWith(' ') ? ' ' : '';
  const trail = after && !after.startsWith(' ') ? ' ' : '';
  const ins = lead + token + trail;
  ta.value = before + ins + after;
  const pos = (before + lead + token).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

// Message editor: a text area plus a single "Placeholders" button that opens a dropdown list of the
// #tokens; picking one inserts it at the caret. Returns { el, get() }.
/** @param {string} initial @returns {{ el: HTMLElement, get: () => string }} */
export function messageControl(initial) {
  const wrap = el('div', 'aldlg-msg-wrap');
  const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'aldlg-msg-text'));
  ta.value = initial;
  ta.rows = 3;
  ta.spellcheck = false;
  ta.placeholder = t('Alert message');

  const bar = el('div', 'aldlg-tags');
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'aldlg-tag-btn'));
  btn.type = 'button';
  btn.append(el('span', null, t('Placeholders')), el('span', 'aldlg-caret', '⌄'));
  /** @type {HTMLElement|null} */
  let menu = null;
  /** @type {((e: PointerEvent) => void)|null} */
  let away = null;
  const closeMenu = () => {
    if (away) {
      document.removeEventListener('pointerdown', away, true);
      away = null;
    }
    if (menu) {
      menu.remove();
      menu = null;
    }
  };
  btn.onclick = () => {
    if (menu) {
      closeMenu();
      return;
    }
    menu = el('div', 'dwg-menu');
    PLACEHOLDERS.forEach((p) => {
      const row = el('div', 'dwg-item');
      row.append(el('span', 'dwg-label aldlg-ph-item', p));
      row.onclick = () => {
        insertToken(ta, p);
        closeMenu();
      };
      /** @type {HTMLElement} */ (menu).appendChild(row);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.minWidth = r.width + 'px';
    away = (e) => {
      if (
        menu &&
        !menu.contains(/** @type {Node|null} */ (e.target)) &&
        e.target !== btn &&
        !btn.contains(/** @type {Node|null} */ (e.target))
      )
        closeMenu();
    };
    setTimeout(
      () => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (away), true),
      0,
    );
  };
  bar.appendChild(btn);
  wrap.append(ta, bar);
  return { el: wrap, get: () => ta.value };
}
