// @ts-check
// Settings -> Development section (Tier 3 of the chart-dialog de-monolith). Debug tooling, Electron
// only: DevTools console + remote debugging (CDP) port. Receives the shared `ctx` from the shell and
// imports its own domain deps directly.
import { setSetting } from '../settings.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section } = ctx;
  // Debug tooling (Electron only). The old app.log file mirror was removed -- logging now goes to
  // the DevTools console (and, in dev, the remote debugging port lets external tooling attach).
  const desktop = (typeof window !== 'undefined' && window.desktop && window.desktop.isDesktop) ? window.desktop : null;
  if (!desktop) {
    section('DEBUG');
    const e = document.createElement('div'); e.className = 'sd-placeholder'; e.style.marginTop = '8px';
    e.textContent = t('Debug tooling is available in the desktop (Electron) build. Use your browser DevTools console here.');
    content.appendChild(e);
    return;
  }

  section('DEBUG');
  // DevTools console: opens this window's console AND the hidden data host's (where the
  // broker/connection layer runs). The live, interactive log.
  const r1 = document.createElement('div'); r1.className = 'sd-row';
  const chk1 = document.createElement('input'); chk1.type = 'checkbox';
  chk1.onchange = () => desktop.devtools(chk1.checked);
  const l1 = document.createElement('span'); l1.className = 'sd-label'; l1.textContent = t('DevTools console (this window + data host)');
  r1.append(chk1, l1);
  content.appendChild(r1);

  // Remote debugging port: a CDP endpoint external tooling can attach to. Default on in dev,
  // off in a packaged build; the switch is set before app-ready, so a change applies on restart.
  const info = (desktop.debugInfo && desktop.debugInfo()) || { port: 9222, active: false, dev: false };
  const r2 = document.createElement('div'); r2.className = 'sd-row';
  const chk2 = document.createElement('input'); chk2.type = 'checkbox';
  chk2.checked = info.active;
  const note = document.createElement('span'); note.className = 'sd-placeholder'; note.style.marginLeft = '8px';
  chk2.onchange = () => {
    setSetting('debugPort', chk2.checked);
    note.textContent = t('Restart to apply');
  };
  const l2 = document.createElement('span'); l2.className = 'sd-label';
  l2.textContent = t('Remote debugging port') + ' (' + info.port + ')';
  r2.append(chk2, l2, note);
  content.appendChild(r2);

  const hint = document.createElement('div'); hint.className = 'sd-placeholder'; hint.style.marginTop = '8px';
  hint.textContent = info.active
    ? t('Active — attach a debugger at') + ' http://localhost:' + info.port + '/json'
    : t('Inactive. Enable, then restart the app to attach a debugger.');
  content.appendChild(hint);
}
