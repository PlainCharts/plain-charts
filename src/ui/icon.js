// @ts-check
// The one icon primitive: icon -> mask -> output -> app.
// Every chrome icon (toolbar, right rail, panel action buttons, top strip) is built here, so a single
// setting governs the whole collection app-wide:
//   maskIcons off : the raw PNG in its own colours (background-image) -- for colourful icons.
//   maskIcons on  : the PNG's alpha becomes a CSS mask, filled with the theme's --icon colour (set by
//                   theme.js from the active theme's palette). The icon colour is therefore PART OF THE
//                   THEME and switches with it -- there is no separate global "icon colour" setting.
// Each icon carries data-app-icon so applyIconMode() can re-skin every one already in the DOM the
// moment masking is toggled -- open panels and the rail update with no re-render.
import { getSetting } from '../settings/settings.js';

/** @param {string|null|undefined} src @param {number} [size] @returns {HTMLSpanElement} */
export function themeIcon(src, size) {
  const s = document.createElement('span');
  s.className = 'app-icon';
  s.dataset.appIcon = /** @type {any} */ (src);
  s.style.backgroundImage = 'url("' + src + '")'; // shown when unmasked (real colours)
  if (size) {
    s.style.width = size + 'px';
    s.style.height = size + 'px';
  }
  paint(s);
  return s;
}

/** @param {HTMLElement} s @returns {void} */
function paint(s) {
  const src = s.dataset.appIcon;
  if (!src) return;
  if (getSetting('maskIcons')) {
    s.classList.add('masked'); // CSS fills it with var(--icon)
    s.style.webkitMaskImage = s.style.maskImage = 'url("' + src + '")';
  } else {
    s.classList.remove('masked');
    s.style.webkitMaskImage = s.style.maskImage = '';
  }
}

// Masking is a document-level flag so glyph + inline-SVG icons (which can't carry an image mask) can
// also take the theme's --icon colour via CSS, but only while masking is on.
/** @returns {void} */
function applyMaskFlag() {
  document.documentElement.classList.toggle('icons-masked', !!getSetting('maskIcons'));
}

// Re-skin every icon already in the DOM (call after the maskIcons toggle changes).
/** @returns {void} */
export function applyIconMode() {
  applyMaskFlag();
  document.querySelectorAll(/** @type {'span'} */ ('.app-icon[data-app-icon]')).forEach(paint);
}

// Upgrade STATIC HTML chrome icons (the top-strip <img class="strip-ico"> in index.html) into
// primitive spans, so they mask with everything else. Call once at startup; the size/spacing class
// is preserved, and applyIconMode() then handles them on every later toggle.
/** @param {Document|HTMLElement} [root] @returns {void} */
export function upgradeIcons(root = document) {
  applyMaskFlag(); // set the icons-masked flag on first load
  root.querySelectorAll('img.strip-ico').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;
    const span = themeIcon(src);
    span.classList.add('strip-ico'); // keep its 15px box + layout
    img.replaceWith(span);
  });
}
