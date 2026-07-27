// @ts-check
// Sub-pane controls: a top-right cluster (move up/down, maximize, collapse, remove) for each
// non-overlay study. The buttons just call the host's pane-management mechanics
// (movePane / setPaneMode / remove); the skin only renders + positions them.
import { paneGeom, scaleWidth, chromeVisible } from './geometry.js';

/**
 * Attach the per-pane control cluster to a skin. Hub boundary: the skin/host/attachment objects are
 * kapelka-internal, dynamically shaped surrogates, so they stay `any`.
 * @param {any} skin  the skin object built by createSkin (host, chart, container, per-map, ...)
 */
export function attachControls(skin) {
  const { host, chart, container } = skin;
  if (!container) return;

  /** @param {any} a  an attachment (study instance) */
  const build = (a) => {
    if (a.overlay) return;
    const rec = skin.per.get(a); if (!rec || rec.ctrlsEl) return;
    /**
     * @param {string} txt  button glyph
     * @param {string} title  hover title
     * @param {() => void} fn  click action
     */
    const mk = (txt, title, fn) => {
      const b = document.createElement('button'); b.className = 'skin-ctrl'; b.textContent = txt; b.title = title;
      b.onclick = (/** @type {MouseEvent} */ e) => { e.stopPropagation(); fn(); }; return b;
    };
    const ctrls = document.createElement('div'); ctrls.className = 'skin-ctrls';
    const up = mk('↑', 'Move up', () => host.movePane(a, -1));
    const dn = mk('↓', 'Move down', () => host.movePane(a, 1));
    const max = mk('⤢', 'Maximize', () => host.setPaneMode(a, a.mode === 'max' ? 'normal' : 'max'));
    const col = mk('⌄', 'Collapse', () => host.setPaneMode(a, a.mode === 'collapsed' ? 'normal' : 'collapsed'));
    const btns = [up, dn, max, col];
    // host may opt out of the remove button (e.g. a study board, where the study set is chosen elsewhere)
    if (!host._noRemove) btns.push(mk('🗑', 'Remove', () => { const i = host.attached.indexOf(a); if (i >= 0) host.remove(i); }));
    ctrls.append(...btns);
    container.appendChild(ctrls);
    rec.ctrlsEl = ctrls; rec.maxBtn = max; rec.colBtn = col;
  };

  /** @param {any} a  an attachment (study instance) */
  const position = (a) => {
    const rec = skin.per.get(a); if (!rec || !rec.ctrlsEl) return;
    if (!chromeVisible(host, a)) { rec.ctrlsEl.style.display = 'none'; return; }   // per-study / global hide
    const { idx, top } = paneGeom(chart, a.plots.values().next().value);
    if (idx < 0) { rec.ctrlsEl.style.display = 'none'; return; }
    rec.ctrlsEl.style.display = ''; rec.ctrlsEl.style.top = (top + 4) + 'px'; rec.ctrlsEl.style.right = (scaleWidth(chart) + 6) + 'px';
  };
  skin._positioners.push(() => host.attached.forEach(position));

  host.on('added', build);
  host.on('computed', (/** @type {any} */ a) => { build(a); skin.reposition(); });
  host.on('removed', (/** @type {any} */ a) => { const rec = skin.per.get(a); if (rec && rec.ctrlsEl) { try { rec.ctrlsEl.remove(); } catch (_) {} } });
  host.on('moved', () => skin.reposition());
  host.on('panemode', (/** @type {any} */ a, /** @type {string} */ mode) => {
    const rec = skin.per.get(a); if (!rec) return;
    if (rec.colBtn) { const c = mode === 'collapsed'; rec.colBtn.textContent = c ? '⌃' : '⌄'; rec.colBtn.title = c ? 'Expand' : 'Collapse'; }
    if (rec.maxBtn) rec.maxBtn.title = mode === 'max' ? 'Restore' : 'Maximize';
    skin.reposition();
  });

  host.attached.forEach(build);   // adopt pre-existing studies
}
