// @ts-check
// Config window: a draggable panel with an Inputs tab (study params -> host.setParam) and a Style
// tab (plot appearance -> host.setStyle). Opened via skin.openSettings(a), which the legends' gear
// buttons call. Framework-free; uses a native color input so there's no custom picker dependency.
import { SOURCES } from '../studies/util.js';

/** Build a DOM element. Used polymorphically (input/select/span) then mutated by callers, so the
 * return is the DOM boundary -> any. @param {string} tag @param {string|null} [cls] @param {string|null} [txt] @returns {any} */
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
/** @param {string} [v] @returns {string|undefined} */
const toHex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#888888');
/** @param {string} label @returns {{ r: any, c: any }} */
const row = (label) => { const r = mk('div', 'skin-row'); const c = mk('span', 'skin-row-c'); r.append(mk('span', 'skin-row-l', label), c); return { r, c }; };

/** @param {any} skin  the skin hub (boundary -> any); exposes host, _offs, openSettings */
export function attachConfig(skin) {
  const { host } = skin;
  /** @type {any} */
  let win = null;
  /** @param {any} a @returns {number} */
  const idx = (a) => host.attached.indexOf(a);
  /** @param {any} a @param {string} k @param {any} v */
  const setParam = (a, k, v) => { const i = idx(a); if (i >= 0) host.setParam(i, k, v); };
  /** @param {any} a @param {string} k @param {any} patch */
  const setStyle = (a, k, patch) => { const i = idx(a); if (i >= 0) host.setStyle(i, k, patch); };

  const close = () => { if (win) { try { win._cleanup && win._cleanup(); win.remove(); } catch (_) {} win = null; } };
  skin._offs.push(close);

  /** @param {any} body @param {any} a */
  function renderInputs(body, a) {
    body.innerHTML = '';
    const ins = (a.study.inputs || []).filter((/** @type {any} */ i) => !i.hidden);
    if (!ins.length) { body.appendChild(mk('div', 'skin-note', 'No inputs.')); return; }
    ins.forEach((/** @type {any} */ inp) => {
      const { r, c } = row(inp.name || inp.key);
      const val = a.params[inp.key];
      /** @type {any} */
      let ctrl;
      if (inp.type === 'bool') {
        ctrl = mk('input'); ctrl.type = 'checkbox'; ctrl.checked = !!val; ctrl.onchange = () => setParam(a, inp.key, ctrl.checked);
      } else if (inp.type === 'source' || inp.type === 'select') {
        ctrl = mk('select'); (inp.type === 'source' ? SOURCES : (inp.options || [])).forEach((/** @type {any} */ s) => { const o = mk('option', null, s.name || s.key); o.value = s.key; if (s.key === val) o.selected = true; ctrl.appendChild(o); }); ctrl.onchange = () => setParam(a, inp.key, ctrl.value);
      } else if (inp.type === 'color') {
        ctrl = mk('input'); ctrl.type = 'color'; ctrl.value = toHex(val); ctrl.oninput = () => setParam(a, inp.key, ctrl.value);
      } else if (inp.type === 'number') {
        ctrl = mk('input'); ctrl.type = 'number'; ctrl.value = val; if (inp.min != null) ctrl.min = inp.min; if (inp.max != null) ctrl.max = inp.max; if (inp.step != null) ctrl.step = inp.step;
        ctrl.oninput = () => { const v = parseFloat(ctrl.value); if (!Number.isNaN(v)) setParam(a, inp.key, v); };
      } else {
        ctrl = mk('input'); ctrl.type = 'text'; ctrl.value = val != null ? val : ''; ctrl.oninput = () => setParam(a, inp.key, ctrl.value);
      }
      ctrl.className = (ctrl.className ? ctrl.className + ' ' : '') + 'skin-in';
      c.appendChild(ctrl); body.appendChild(r);
    });
  }

  /** @param {any} body @param {any} a */
  function renderStyle(body, a) {
    body.innerHTML = '';
    const metas = a.plotMeta || [];
    if (!metas.length) { body.appendChild(mk('div', 'skin-note', 'No plots.')); return; }
    metas.forEach((/** @type {any} */ pm) => {
      const eff = host.styleOf(idx(a), pm.key);
      const { r, c } = row(pm.name || pm.key);
      const vis = mk('input'); vis.type = 'checkbox'; vis.checked = eff.visible !== false; vis.onchange = () => setStyle(a, pm.key, { visible: vis.checked });
      c.appendChild(vis);
      if (eff.type !== 'segmented') {   // segmented colors live per-segment in the data
        const color = mk('input'); color.type = 'color'; color.value = toHex(eff.color); color.oninput = () => setStyle(a, pm.key, { color: color.value });
        const width = mk('input', 'skin-in'); width.type = 'number'; width.min = 1; width.max = 8; width.value = eff.lineWidth || 2; width.style.width = '46px';
        width.oninput = () => { const v = parseFloat(width.value); if (!Number.isNaN(v)) setStyle(a, pm.key, { lineWidth: v }); };
        c.append(color, width);
      }
      body.appendChild(r);
    });
  }

  /** @param {any} a @returns {any} */
  function build(a) {
    const w = mk('div', 'skin-win');
    const head = mk('div', 'skin-win-head');
    const x = mk('span', 'skin-win-x', '✕'); x.onclick = close;
    head.append(mk('span', 'skin-win-title', a.study.name || a.study.id), x);
    const tabs = mk('div', 'skin-win-tabs');
    const tIn = mk('span', 'skin-tab skin-on', 'Inputs');
    const tSt = mk('span', 'skin-tab', 'Style');
    tabs.append(tIn, tSt);
    const body = mk('div', 'skin-win-body');
    tIn.onclick = () => { tIn.classList.add('skin-on'); tSt.classList.remove('skin-on'); renderInputs(body, a); };
    tSt.onclick = () => { tSt.classList.add('skin-on'); tIn.classList.remove('skin-on'); renderStyle(body, a); };
    w.append(head, tabs, body);
    w.style.left = '64px'; w.style.top = '64px';
    draggable(w, head);
    renderInputs(body, a);
    return w;
  }

  /** @param {any} w @param {any} handle */
  function draggable(w, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    const down = (/** @type {PointerEvent} */ e) => { on = true; sx = e.clientX; sy = e.clientY; ox = parseFloat(w.style.left) || 0; oy = parseFloat(w.style.top) || 0; e.preventDefault(); };
    const move = (/** @type {PointerEvent} */ e) => { if (!on) return; w.style.left = (ox + e.clientX - sx) + 'px'; w.style.top = (oy + e.clientY - sy) + 'px'; };
    const up = () => { on = false; };
    handle.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    w._cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }

  skin.openSettings = (/** @type {any} */ a) => { close(); win = build(a); document.body.appendChild(win); };
  // re-render the open window if its study recomputed (e.g. params changed live)
  host.on('computed', (/** @type {any} */ a) => { /* values update via the legends; window stays as-is */ });
}
