// @ts-check
// Self-contained CSS for kapelka/skin — injected once, so a consumer gets the chrome styling without
// copying any CSS. Colors hang off CSS vars set on the container (--skin-text, --skin-accent),
// so the skin follows the host page's theme.
let injected = false;

export function ensureStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const css = `
.skin-legend { position:absolute; z-index:4; display:inline-flex; align-items:baseline; gap:8px;
  pointer-events:none; white-space:nowrap; font:13px -apple-system,BlinkMacSystemFont,Arial,sans-serif;
  padding:2px 7px; border-radius:5px; background:var(--skin-legend-bg,transparent); }
.skin-legend-name { color:var(--skin-text,#787b86); pointer-events:auto; cursor:pointer; }
.skin-legend-name:hover { color:var(--skin-accent,#4d88ff); }
.skin-legend-vals { display:inline-flex; gap:7px; font-variant-numeric:tabular-nums; }
.skin-legend-v { font-size:12px; }
.skin-price { position:absolute; z-index:4; display:inline-flex; align-items:baseline; gap:10px;
  pointer-events:none; white-space:nowrap; font:12px -apple-system,BlinkMacSystemFont,Arial,sans-serif;
  color:var(--skin-text,#787b86); }
.skin-price-vals { display:inline-flex; gap:9px; font-variant-numeric:tabular-nums; }
.skin-price-v { color:var(--skin-text,#787b86); }
.skin-ctrls { position:absolute; z-index:6; display:flex; gap:2px; }
.skin-ctrl { width:22px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px;
  background:var(--skin-panel,rgba(127,127,127,0.14)); color:var(--skin-text,#787b86);
  border:1px solid var(--skin-bd,rgba(127,127,127,0.32)); border-radius:4px; cursor:pointer; }
.skin-ctrl:hover { color:var(--skin-accent,#4d88ff); }
.skin-ovl { position:absolute; z-index:4; display:flex; flex-direction:column; align-items:flex-start; gap:1px; pointer-events:none; }
.skin-ovl-row { display:inline-flex; align-items:center; gap:8px; padding:4px 9px; pointer-events:auto;
  white-space:nowrap; border:1px solid transparent; border-radius:5px; background:var(--skin-legend-bg,transparent); }
.skin-ovl-row:hover { border-color:var(--skin-bd,rgba(127,127,127,0.32)); }
.skin-ovl-name { color:var(--skin-text,#787b86); font-size:13px; cursor:pointer; }
.skin-ovl-name:hover { color:var(--skin-accent,#4d88ff); }
.skin-ovl-v { font-size:12px; font-variant-numeric:tabular-nums; }
.skin-ovl-ico { color:var(--skin-text,#787b86); opacity:0.6; font-size:12px; cursor:pointer; visibility:hidden; }
.skin-ovl-row:hover .skin-ovl-ico { visibility:visible; }
.skin-ovl-ico.skin-always { visibility:visible; }
.skin-ovl-ico:hover { color:var(--skin-accent,#4d88ff); opacity:1; }
.skin-dim .skin-ovl-name { opacity:0.5; }
.skin-ovl-chip { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; pointer-events:auto; cursor:pointer;
  color:var(--skin-text,#787b86); font-size:13px; border:1px solid transparent; border-radius:4px; }
.skin-ovl-chip:hover { border-color:var(--skin-bd,rgba(127,127,127,0.32)); color:var(--skin-accent,#4d88ff); }
.skin-ovl-count { font-variant-numeric:tabular-nums; }
.skin-ovl-tw { font-size:10px; opacity:0.7; }
.skin-ovl-collapse { align-self:flex-start; pointer-events:auto; cursor:pointer; color:var(--skin-text,#787b86);
  font-size:10px; opacity:0.55; padding:1px 6px; } .skin-ovl-collapse:hover { opacity:1; color:var(--skin-accent,#4d88ff); }
.skin-win { position:fixed; z-index:9999; min-width:248px; background:var(--skin-winbg,#1b1e26);
  color:var(--skin-text,#d1d4dc); border:1px solid var(--skin-bd,rgba(127,127,127,0.4)); border-radius:8px;
  box-shadow:0 8px 30px rgba(0,0,0,0.45); font:13px -apple-system,BlinkMacSystemFont,Arial,sans-serif; }
.skin-win-head { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; cursor:move;
  border-bottom:1px solid var(--skin-bd,rgba(127,127,127,0.3)); }
.skin-win-title { font-weight:600; }
.skin-win-x { cursor:pointer; opacity:0.6; } .skin-win-x:hover { opacity:1; }
.skin-win-tabs { display:flex; gap:14px; padding:8px 12px 0; }
.skin-tab { cursor:pointer; padding-bottom:6px; border-bottom:2px solid transparent; opacity:0.7; }
.skin-tab.skin-on { opacity:1; border-bottom-color:var(--skin-accent,#4d88ff); }
.skin-win-body { padding:8px 12px 12px; max-height:340px; overflow:auto; }
.skin-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:4px 0; }
.skin-row-l { opacity:0.85; }
.skin-row-c { display:inline-flex; align-items:center; gap:6px; }
.skin-in { background:var(--skin-panel,rgba(127,127,127,0.14)); color:inherit;
  border:1px solid var(--skin-bd,rgba(127,127,127,0.3)); border-radius:4px; padding:3px 6px; }
.skin-note { opacity:0.6; padding:6px 0; }
`;
  const el = document.createElement('style');
  el.id = 'skin-styles';
  el.textContent = css;
  document.head.appendChild(el);
}
