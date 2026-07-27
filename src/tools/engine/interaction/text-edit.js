// @ts-check
// In-place text editing for a drawing's label (part of the Interaction class, split out as a
// prototype mixin). A contentEditable box is dropped on the canvas at the label's anchor (computed
// in primitive.js -> engine._textBox), positioned/rotated to match the rendered label. These methods
// run with `this` bound to the Interaction instance (attached via Object.assign in interaction.js).
import { getTool } from '../../registry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Tool} Tool */

export const textEditMethods = {
  // ---- edit a drawing's text in place: a contentEditable box dropped on the canvas
  // at the label's anchor (computed in primitive.js → engine._textBox). ----
  /** @this {Ix} @param {string} id */
  _startTextEdit(id) {
    const d = this.engine.get(id); const tool = d && getTool(d.tool);
    if (!d || !tool || !(tool.settings && tool.settings.text) || (tool.textEnabled && !tool.textEnabled(d))) return;
    const box = this.engine._textBox;
    if (!box || box.id !== id) return;   // need the freshly-painted anchor
    this._closeTextEdit();
    if (!d.textStyle) {
      const def = tool.settings.text.defaults || {};
      d.textStyle = { color: '#787b86', size: 14, bold: false, italic: false, vAlign: def.vAlign || 'middle', hAlign: def.hAlign || 'center' };
    }
    const ts = d.textStyle;
    this._editOrig = d.text || '';
    this.engine._editingId = id;
    this.engine.requestUpdate();   // hide the rendered label / placeholder while editing

    const ed = document.createElement('div');
    ed.className = 'draw-text-edit';
    ed.contentEditable = 'true';
    ed.textContent = d.text || '';
    // box coords are surface-local; the editor is absolute in pane.el, so add the
    // active surface's y-offset (0 for the main pane, the sub-pane top otherwise).
    const yoff = this._active && this._active.yOffset ? this._active.yOffset() : 0;
    const tx = box.ha === 'right' ? '-100%' : box.ha === 'center' ? '-50%' : '0';
    if (box.angle != null) {
      // rotated label: pin the editor's anchor corner at (cx,cy) and rotate to the slope
      const ty = box.baseline === 'bottom' ? '-100%' : box.baseline === 'middle' ? '-50%' : '0';
      ed.style.left = box.cx + 'px';
      ed.style.top = (/** @type {number} */ (box.cy) + yoff) + 'px';
      ed.style.transformOrigin = '0 0';
      ed.style.transform = `rotate(${box.angle}rad) translate(${tx}, ${ty})`;
    } else {
      ed.style.left = box.x + 'px';
      ed.style.top = (/** @type {number} */ (box.yTop) + yoff) + 'px';
      ed.style.transform = 'translateX(' + tx + ')';
    }
    ed.style.textAlign = /** @type {string} */ (box.ha);
    ed.style.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + (ts.size || 14) + 'px sans-serif';
    ed.style.color = ts.color || '#787b86';
    // text-box editor: fixed-width wrapping that matches the rendered box (the tool's
    // textGeom asks for it). Offset by the box padding so the caret sits over the text.
    if (box.editor) {
      ed.style.transform = 'none';
      ed.style.left = (/** @type {number} */ (box.cx) + box.editor.offX) + 'px';
      ed.style.top = (/** @type {number} */ (box.cy) + yoff + box.editor.offY) + 'px';
      ed.style.background = box.editor.bg || 'transparent';   // match the Style background (WYSIWYG)
      if (box.editor.wrap) {                          // fixed width, WORD wrap (never split a word)
        ed.style.width = box.editor.width + 'px';
        ed.style.whiteSpace = 'pre-wrap';
        ed.style.overflowWrap = 'normal';
        ed.style.wordBreak = 'normal';
      } else {                                        // grow with the text, keep newlines
        ed.style.whiteSpace = 'pre';
      }
    }
    this.pane.el.appendChild(ed);
    this._textEdit = { id, ed };

    ed.addEventListener('input', () => { d.text = ed.innerText; this.engine.liveUpdate(d); });
    ed.addEventListener('keydown', (ev) => {
      ev.stopPropagation();   // keep Delete/Backspace/hotkeys from acting on the drawing
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this._commitTextEdit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); this._cancelTextEdit(); }
    });
    ed.addEventListener('blur', () => this._commitTextEdit());
    setTimeout(() => {
      ed.focus();
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);   // caret at end
      const sel = /** @type {Selection} */ (window.getSelection()); sel.removeAllRanges(); sel.addRange(r);
    }, 0);
  },
  /** @this {Ix} */
  _commitTextEdit() {
    const te = this._textEdit; if (!te) return;
    const txt = te.ed.innerText.replace(/\n$/, '').trim();
    this._closeTextEdit();
    this.engine._editingId = null;
    const d = this.engine.get(te.id);
    if (d) { d.text = txt || undefined; this.engine.persist(); this.engine.liveUpdate(d); }
    this.engine.requestUpdate();
  },
  /** @this {Ix} */
  _cancelTextEdit() {
    const te = this._textEdit; if (!te) return;
    this._closeTextEdit();
    this.engine._editingId = null;
    const d = this.engine.get(te.id);
    if (d) { d.text = this._editOrig || undefined; this.engine.liveUpdate(d); }
    this.engine.requestUpdate();
  },
  /** @this {Ix} */
  _closeTextEdit() {
    const te = this._textEdit;
    if (!te) return;
    this._textEdit = null;                 // null FIRST so the re-entrant blur this remove() fires is a no-op
    try { te.ed.remove(); } catch (_) {}
  },
};
