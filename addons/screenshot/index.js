// @ts-check
// Screenshot (sample) — the built-in snapshot feature rebuilt as an ADDON. It owns ZERO capture
// logic: the app composites the chart via api.chart.snapshot() (returns a canvas of exactly what's
// painted, drawings/alerts/studies included). This addon is pure consumer code: capture -> download
// / copy / print / preview, all plain browser APIs. Proof that a built-in feature is just an addon.
module.exports = {
  popup: true,   // show as a dropdown anchored to the rail icon (not a docked slide-out)

  /** @param {HTMLElement} root @param {import('../../src/panels/addons.js').AddonApi} api */
  ui(root, api) {
    const t = api.t;   // vocabulary lookup — the app hands addons the same translation the rest of the UI uses
    /** @param {string} tag @param {string} [css] @param {string} [txt] */
    const el = (tag, css, txt) => { const d = document.createElement(tag); if (css) d.style.cssText = css; if (txt != null) d.textContent = txt; return d; };
    const out = el('div', 'margin:8px 0;color:var(--tx-dim);font-size:12px;', t('Capture the chart — exactly what is painted.'));
    /** @param {string} m */
    const say = (m) => { out.textContent = m; };

    // the app owns the capture; we just ask for the image
    const grab = () => { const c = api.chart && api.chart.snapshot && api.chart.snapshot(); if (!c) say(t('no chart to capture')); return c; };

    const download = () => { const c = grab(); if (!c) return; c.toBlob((/** @type {Blob | null} */ b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'chart-' + Date.now() + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); say(t('saved')); }, 'image/png'); };
    const copy = () => { const c = grab(); if (!c) return; c.toBlob(async (/** @type {Blob | null} */ b) => { if (!b) return; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); say(t('copied to clipboard')); } catch (e) { say(t('copy failed:') + ' ' + ((/** @type {any} */ (e) && (/** @type {any} */ (e)).message) || e)); } }, 'image/png'); };
    const print = () => {
      const c = grab(); if (!c) return;
      const url = c.toDataURL('image/png');
      const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(frame);
      const doc = (/** @type {Window} */ (frame.contentWindow)).document; doc.open();
      doc.write('<html><head><title>Chart</title><style>@page{size:landscape;margin:10mm;}html,body{margin:0}img{max-width:100%}</style></head><body><img src="' + url + '"></body></html>'); doc.close();
      const go = () => { try { (/** @type {Window} */ (frame.contentWindow)).focus(); (/** @type {Window} */ (frame.contentWindow)).print(); } catch (_) {} setTimeout(() => frame.remove(), 1000); };
      const img = doc.querySelector('img'); if (img && !img.complete) img.onload = go; else go();
      say(t('printing…'));
    };
    // items use the app's shared menu-item class (same as every other "..." menu) so the dropdown
    // flows with the app -- subtle theme hover, no custom colours or button chrome.
    /** @param {string} txt @param {() => void} fn */
    const mk = (txt, fn) => { const b = el('div', undefined, txt); b.className = 'menu-action'; b.onclick = fn; return b; };
    const row = el('div');   // stacked menu items; the popup wrapper supplies the chrome
    row.append(mk(t('Download image'), download), mk(t('Copy image'), copy), mk(t('Print…'), print));
    root.append(row, out);
  },

  /** @param {any} ctx */
  start(ctx) { ctx.log('screenshot addon ready'); },
  stop() {},
};
