// @ts-check
// The dialog's presentation layer: the element helper, header-drag behavior, and the injected stylesheet.
// DOM-only — no Pacman state lives here.

/** @param {string} tag @param {string|null} [cls] @param {string|null} [txt] @returns {HTMLElement} */
export const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// Drag `box` by `handle` (the header). On first grab the box switches from the overlay's flex-centering to
// fixed left/top at its current spot, then follows the cursor. Clicks on inputs/buttons don't start a drag.
/** @param {HTMLElement} box @param {HTMLElement} handle */
export function makeDraggable(box, handle) {
  handle.style.cursor = 'move';
  handle.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('input,button,.lib-x')) return;
    const r = box.getBoundingClientRect();
    box.style.position = 'fixed';
    box.style.margin = '0';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    const dx = e.clientX - r.left,
      dy = e.clientY - r.top;
    const move = (/** @type {MouseEvent} */ ev) => {
      box.style.left = ev.clientX - dx + 'px';
      box.style.top = ev.clientY - dy + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });
}

let CSS_DONE = false;
export function injectCss() {
  if (CSS_DONE) return;
  CSS_DONE = true;
  const s = document.createElement('style');
  s.textContent = `
  .pac-dialog{width:640px;max-width:92vw;height:560px;max-height:88vh;display:flex;flex-direction:column;padding:0;}
  .pac-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd);}
  .pac-title{font-weight:600;flex:1;color:var(--tx);}
  .pac-search{flex:0 0 200px;padding:5px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--field);color:var(--tx);}
  .pac-modebar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px 2px;}
  .pac-count{font-size:.8em;color:var(--tx-dim);}
  .pac-badge{flex:0 0 auto;align-self:center;margin-left:8px;padding:2px 7px;border-radius:10px;border:1px solid var(--bd);background:var(--field);color:var(--tx-dim);font-size:.72em;white-space:nowrap;}
  .pac-switch{display:inline-flex;min-width:200px;border:1px solid var(--accent);border-radius:6px;overflow:hidden;cursor:pointer;}
  .pac-switch > span{flex:1;padding:6px 0;display:flex;align-items:center;justify-content:center;gap:3px;font-size:.9em;color:var(--tx-dim);}
  .pac-switch > span.on{background:var(--active);color:var(--accent);}
  .pac-switch .pac-ico{width:13px;height:13px;}
  .pac-list{flex:1;overflow-y:auto;}
  .pac-row{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid var(--bd-soft);cursor:pointer;}
  .pac-row:hover{background:var(--hover);}
  .pac-row.sel{background:var(--active);box-shadow:inset 3px 0 0 var(--accent);}
  .pac-thumb{flex:0 0 32px;width:32px;height:32px;border-radius:5px;background:transparent center/contain no-repeat;overflow:hidden;}
  .pac-thumb.pac-flag{height:24px;border-radius:3px;background-size:cover;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}
  .pac-thumb.pac-mask{background:var(--icon,var(--tx));-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}
  .pac-body{flex:1;min-width:0;}
  .pac-name{font-weight:600;color:var(--tx);}
  .pac-name .pac-by{font-weight:400;color:var(--tx-dim);}
  .pac-id{font-style:italic;color:var(--tx-dim);font-size:.85em;margin:1px 0 3px;}
  .pac-desc{color:var(--tx2,var(--tx-dim));font-size:.9em;line-height:1.35;}
  .pac-act{flex:0 0 auto;align-self:center;display:flex;gap:6px;}
  .pac-btn{min-width:34px;height:34px;padding:0 8px;border-radius:6px;border:1px solid var(--bd);background:var(--btn);color:var(--tx);cursor:pointer;font-size:15px;}
  .pac-btn:hover{background:var(--btn-h);}
  .pac-btn.on{color:var(--pos);border-color:var(--pos);}
  .pac-ico{display:inline-block;width:16px;height:16px;vertical-align:middle;background:currentColor;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}
  .pac-ico-ext{-webkit-mask-image:url("/addons/pacman/images/external-link.png");mask-image:url("/addons/pacman/images/external-link.png");}
  .pac-ico-github{-webkit-mask-image:url("/addons/pacman/images/brand-github.png");mask-image:url("/addons/pacman/images/brand-github.png");}
  .pac-ico-desktop{-webkit-mask-image:url("/addons/pacman/images/device-desktop.png");mask-image:url("/addons/pacman/images/device-desktop.png");}
  .pac-ico-info{width:20px;height:20px;-webkit-mask-image:url("/addons/pacman/images/info-circle.png");mask-image:url("/addons/pacman/images/info-circle.png");}
  .pac-ico-min{-webkit-mask-image:url("/addons/pacman/images/circle-minus.png");mask-image:url("/addons/pacman/images/circle-minus.png");}
  .pac-ico-set{-webkit-mask-image:url("/addons/pacman/images/settings.png");mask-image:url("/addons/pacman/images/settings.png");}
  .pac-ico-ref{-webkit-mask-image:url("/addons/pacman/images/refresh.png");mask-image:url("/addons/pacman/images/refresh.png");}
  .pac-cats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 12px;border-top:1px solid var(--bd);}
  .pac-cat{padding:8px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--btn);color:var(--tx);cursor:pointer;font-size:.85em;text-align:center;}
  .pac-cat:hover{background:var(--btn-h);}
  .pac-cat.sel{border-color:var(--accent);color:var(--accent);}
  .pac-ctrl{display:flex;justify-content:center;gap:8px;padding:10px 12px;border-top:1px solid var(--bd);}
  .pac-status{padding:6px 14px;font-size:.85em;color:var(--tx-dim);min-height:18px;}
  .pac-cfg{padding:14px;display:none;flex-direction:column;gap:10px;}
  .pac-cfg.show{display:flex;}
  .pac-cfg label{font-size:.85em;color:var(--tx-dim);display:flex;flex-direction:column;gap:4px;}
  .pac-cfg input{padding:6px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--field);color:var(--tx);}
  `;
  document.head.appendChild(s);
}
