// @ts-check
// The ADD/EDIT CONDITION dialog -- where ONE alert condition is crafted. Progressive: the form builds
// itself as the user picks, showing only what the current picks require (subject -> condition -> second
// object -> its value/band), so new alert families never fight a fixed column grid. The alert dialog holds
// the resulting conditions as a sentence LIST; this dialog is the only place a condition's internals are
// edited. Interval is NOT here: it is per-alert, owned by the alert dialog.
//
// The stored row shape is unchanged ({left, op, right, value, percent, amount, lookback, plot}), so every
// existing record edits cleanly. The pure state<->row mapping (parseRow/buildRow) is exported for Node
// tests; the DOM assembly below is a thin renderer over it.
import { t } from '../i18n/i18n.js';
import { el, roundPrice } from './dialog-controls.js';
import { MOVE_OPS, isMoveOp, compileConditions } from './alert-conditions.js';
import { conditionEvaluable } from './eval.js';

// Level operators between two objects (the Moving family is Price-only and self-referential).
const LEVEL_OPS = ['Crossing', 'Crossing Up', 'Crossing Down', 'Greater Than', 'Less Than'];

/** @typedef {{ studyId:string, studyUrl:(string|null), params:any, plots:{key:string,name:string}[], overlay:boolean, headless:boolean }} SeriesEntry */
/** @typedef {{ objectName:string, seriesByLabel:Record<string, SeriesEntry>, dec?:number }} CondCtx */
/** @typedef {{ left:string, op:string, right:string, value:(number|null), percent:(number|null), amount:(number|null), lookback:(number|null), plot:(string|null) }} CondRow */
/** @typedef {{ subject:string, op:string, obj2:(string|null), value:(number|null), plot:(string|null), percent:(number|null), amount:(number|null), lookback:(number|null) }} CondState */

/** the study labels usable as a SUBJECT (their own value vs Value): any headless study. @param {CondCtx} ctx */
export const subjectStudies = (ctx) =>
  Object.entries(ctx.seriesByLabel || {})
    .filter(([, s]) => s.headless !== false)
    .map(([label]) => label);

/** the labels usable as the SECOND object under a Price subject: Value, the anchored drawing, overlay
 * headless studies -- only what actually compiles (compile stays the backstop for stored rows). @param {CondCtx} ctx */
export const priceObjects = (ctx) => {
  /** @type {string[]} */
  const out = [t('Value')];
  if (ctx.objectName) out.push(ctx.objectName);
  for (const [label, s] of Object.entries(ctx.seriesByLabel || {}))
    if (s.overlay && s.headless !== false) out.push(label);
  return out;
};

/** a fresh default state: Price crossing Value. @param {number|null} [value] prefilled Value @returns {CondState} */
export const freshState = (value = null) =>
  /** @type {CondState} */ ({
    subject: 'price',
    op: 'Crossing',
    obj2: 'value',
    value,
    plot: null,
    percent: null,
    amount: null,
    lookback: null,
  });

/**
 * A stored row -> the dialog's state (edit mode). Pure.
 * @param {CondRow|any} r @param {CondCtx} ctx @param {string} priceLabel @param {string} valueLabel
 * @returns {CondState}
 */
export function parseRow(r, ctx, priceLabel, valueLabel) {
  const s = freshState();
  if (!r) return s;
  s.op = r.op || 'Crossing';
  s.value = r.value != null ? r.value : null;
  s.plot = r.plot != null ? r.plot : null;
  s.percent = r.percent != null ? r.percent : null;
  s.amount = r.amount != null ? r.amount : null;
  s.lookback = r.lookback != null ? r.lookback : null;
  const leftPrice = r.left === priceLabel;
  s.subject = leftPrice ? 'price' : r.left || 'price';
  if (isMoveOp(s.op)) {
    s.obj2 = null;
    return s;
  }
  if (leftPrice)
    s.obj2 = r.right === valueLabel ? 'value' : r.right === ctx.objectName ? 'drawing' : r.right || 'value';
  else s.obj2 = 'value'; // a study subject only compares against Value
  return s;
}

/**
 * The dialog's state -> a stored row. Pure; the row is the SAME shape the table produced, so compile,
 * persistence, drag-sync, and edit mode all keep working unchanged.
 * @param {CondState} s @param {CondCtx} ctx @param {string} priceLabel @param {string} valueLabel
 * @returns {CondRow}
 */
export function buildRow(s, ctx, priceLabel, valueLabel) {
  const left = s.subject === 'price' ? priceLabel : s.subject;
  /** @type {CondRow} */
  const row = {
    left,
    op: s.op,
    right: '',
    value: null,
    percent: null,
    amount: null,
    lookback: null,
    plot: s.plot != null ? s.plot : null,
  };
  if (isMoveOp(s.op)) {
    row.percent = s.percent != null ? s.percent : null;
    row.amount = s.amount != null ? roundPrice(s.amount, ctx.dec) : null;
    row.lookback = s.lookback != null ? s.lookback : null;
    return row;
  }
  if (s.subject !== 'price' || s.obj2 === 'value') {
    row.right = valueLabel;
    row.value = s.value != null ? roundPrice(s.value, ctx.dec) : null;
  } else if (s.obj2 === 'drawing') {
    row.right = ctx.objectName;
  } else {
    row.right = s.obj2 || '';
  }
  return row;
}

/** @type {HTMLElement | null} */
let panel = null;
export function closeConditionDialog() {
  if (panel) {
    panel.remove();
    panel = null;
  }
}

/**
 * Open the Add/Edit-condition dialog.
 * @param {{ row?: any, prefill?: any, ctx: CondCtx, level?: (number|null), extent?: any, title?: string,
 *   onDone: (row: CondRow) => void }} opts
 *   row     an existing condition row to EDIT (prefills; the button reads Save); omit to ADD
 *   prefill a row-shaped seed for a NEW condition (ADD semantics with the form pre-set -- the drawing
 *           entry flow opens "Price Crossing <drawing>" this way)
 *   ctx     the alert dialog's object context (anchored drawing name + attached-study map + decimals)
 *   level/extent  the anchored drawing's reductions (validation input, same values the alert dialog holds)
 *   onDone  receives the built row when Add/Save is pressed
 */
export function openConditionDialog(opts) {
  closeConditionDialog();
  const ctx = opts.ctx;
  const priceLabel = t('Price');
  const valueLabel = t('Value');
  const editing = !!opts.row;
  const init = opts.row || opts.prefill;
  const state = init ? parseRow(init, ctx, priceLabel, valueLabel) : freshState();

  const dlg = el('div', 'dialog alert-dlg acond-dlg');
  panel = dlg;
  dlg.style.zIndex = '74'; // above the alert dialog (72)

  const head = el('div', 'aldlg-head');
  head.append(el('div', 'aldlg-title', opts.title || t(editing ? 'Edit condition' : 'Add condition')));
  const x = el('span', 'lib-x', '✕');
  x.onclick = closeConditionDialog;
  head.appendChild(x);
  dlg.appendChild(head);

  const body = el('div', 'acond-body');
  dlg.appendChild(body);

  const warn = el('div', 'aldlg-warn', t('This condition is not supported yet, so the alert would never fire.'));
  warn.style.display = 'none';
  dlg.appendChild(warn);

  const foot = el('div', 'aldlg-foot');
  const cancel = el('button', null, t('Cancel'));
  cancel.onclick = closeConditionDialog;
  const add = /** @type {HTMLButtonElement} */ (el('button', 'primary', t(editing ? 'Save' : 'Add')));
  add.onclick = () => {
    const row = buildRow(state, ctx, priceLabel, valueLabel);
    closeConditionDialog();
    opts.onDone(row);
  };
  foot.append(cancel, add);
  dlg.appendChild(foot);

  /** a full-width select. @param {{label:string,value:string}[]} options @param {string} value @param {(v:string)=>void} onSet */
  const sel = (options, value, onSet) => {
    const s = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-sel acond-sel'));
    options.forEach((o) => {
      const op = /** @type {HTMLOptionElement} */ (el('option', null, o.label));
      op.value = o.value;
      s.appendChild(op);
    });
    s.value = value;
    s.onchange = () => onSet(s.value);
    return s;
  };
  /** a numeric input. @param {number|null} v @param {(n:number|null)=>void} onSet @param {string} [step] */
  const num = (v, onSet, step = 'any') => {
    const i = /** @type {HTMLInputElement} */ (el('input', 'aldlg-in acond-num'));
    i.type = 'number';
    i.step = step;
    i.value = v != null ? String(v) : '';
    i.oninput = () => onSet(i.value === '' ? null : parseFloat(i.value));
    return i;
  };

  // PROGRESSIVE render: each pick reveals the next control; nothing exists before it is needed. State that
  // no longer applies after a pick is reset, never silently carried (a Value typed for one pairing must not
  // leak into another).
  const render = () => {
    body.innerHTML = '';

    // 1 -- the SUBJECT: Price, or any study whose own value can be watched
    const subjects = [
      { label: priceLabel, value: 'price' },
      ...subjectStudies(ctx).map((l) => ({ label: l, value: l })),
    ];
    body.appendChild(
      sel(subjects, state.subject, (v) => {
        state.subject = v;
        state.obj2 = v === 'price' ? 'value' : null;
        state.value = null;
        state.plot = null;
        if (v !== 'price' && isMoveOp(state.op)) state.op = 'Crossing'; // Moving is Price-only
        render();
      }),
    );

    // a multi-plot study SUBJECT picks its band right under the subject
    if (state.subject !== 'price') {
      const entry = ctx.seriesByLabel[state.subject];
      const plots = (entry && entry.plots) || [];
      if (plots.length > 1) {
        if (!state.plot || !plots.some((p) => p.key === state.plot)) state.plot = plots[0].key;
        body.appendChild(
          sel(
            plots.map((p) => ({ label: p.name || p.key, value: p.key })),
            /** @type {string} */ (state.plot),
            (v) => {
              state.plot = v;
              validate();
            },
          ),
        );
      }
    }

    // 2 -- the CONDITION: level ops for everything; the Moving family only for Price
    const ops = state.subject === 'price' ? [...LEVEL_OPS, ...MOVE_OPS] : LEVEL_OPS;
    body.appendChild(
      sel(
        ops.map((o) => ({ label: t(o), value: o })),
        state.op,
        (v) => {
          state.op = v;
          if (isMoveOp(v)) {
            state.obj2 = null;
            if (state.lookback == null) state.lookback = 1;
          } else if (state.obj2 == null) {
            state.obj2 = 'value';
          }
          render();
        },
      ),
    );

    // 3 -- what the condition compares against
    if (isMoveOp(state.op)) {
      // Moving: a magnitude (percent or absolute price move) over N bars of the alert's interval
      const pct = /%\s*$/.test(state.op);
      const rowEl = el('div', 'acond-pair');
      if (pct) {
        if (state.percent == null) state.percent = 1;
        rowEl.append(
          num(state.percent, (n) => {
            state.percent = n;
            validate();
          }),
          el('span', 'aldlg-cond-unit', '%'),
        );
      } else {
        rowEl.append(
          num(state.amount != null ? roundPrice(state.amount, ctx.dec) : null, (n) => {
            state.amount = n;
            validate();
          }),
        );
      }
      rowEl.append(
        el('span', 'aldlg-cond-unit', t('in')),
        num(
          state.lookback,
          (n) => {
            state.lookback = n == null ? null : Math.trunc(n);
            validate();
          },
          '1',
        ),
        el('span', 'aldlg-cond-unit', t('bar')),
      );
      body.appendChild(rowEl);
    } else if (state.subject === 'price') {
      // Price vs: Value (typed level) | the anchored drawing | an overlay study's band
      const objects = priceObjects(ctx).map((l) => ({
        label: l,
        value: l === valueLabel ? 'value' : l === ctx.objectName ? 'drawing' : l,
      }));
      const pair = el('div', 'acond-pair');
      pair.appendChild(
        sel(objects, /** @type {string} */ (state.obj2 || 'value'), (v) => {
          state.obj2 = v;
          state.value = null;
          state.plot = null;
          render();
        }),
      );
      if (state.obj2 === 'value') {
        if (state.value == null) state.value = 0;
        pair.appendChild(
          num(roundPrice(state.value, ctx.dec), (n) => {
            state.value = n;
            validate();
          }),
        );
      } else if (state.obj2 && state.obj2 !== 'drawing') {
        const entry = ctx.seriesByLabel[state.obj2];
        const plots = (entry && entry.plots) || [];
        if (plots.length > 1) {
          if (!state.plot || !plots.some((p) => p.key === state.plot)) state.plot = plots[0].key;
          pair.appendChild(
            sel(
              plots.map((p) => ({ label: p.name || p.key, value: p.key })),
              /** @type {string} */ (state.plot),
              (v) => {
                state.plot = v;
                validate();
              },
            ),
          );
        }
      }
      body.appendChild(pair);
    } else {
      // a study subject compares against a typed Value on ITS OWN scale (RSI vs 35)
      const pair = el('div', 'acond-pair');
      pair.appendChild(el('span', 'acond-lbl', valueLabel));
      if (state.value == null) state.value = 0;
      pair.appendChild(
        num(state.value, (n) => {
          state.value = n;
          validate();
        }),
      );
      body.appendChild(pair);
    }

    validate();
  };

  // live validation: the row must COMPILE evaluable (same predicate as everywhere) or Add stays disabled
  const validate = () => {
    const row = buildRow(state, ctx, priceLabel, valueLabel);
    const compiled = compileConditions(
      { match: 'All', conditions: [row] },
      priceLabel,
      ctx.objectName,
      opts.level != null ? opts.level : null,
      opts.extent || null,
      ctx.seriesByLabel || null,
    );
    const ok = conditionEvaluable(compiled);
    warn.style.display = ok ? 'none' : '';
    add.disabled = !ok;
  };

  render();
  document.body.appendChild(dlg);

  // float + drag by the header (same gesture as the other alert dialogs)
  dlg.style.position = 'fixed';
  dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 3) + 'px';
  /** @type {{ dx: number, dy: number } | null} */
  let drag = null;
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('.lib-x')) return;
    drag = { dx: e.clientX - dlg.offsetLeft, dy: e.clientY - dlg.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dlg.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
    dlg.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
  });
  head.addEventListener('pointerup', () => {
    drag = null;
  });
}
