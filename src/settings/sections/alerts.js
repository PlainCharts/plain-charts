// @ts-check
// Settings -> Alerts section (per-chart + sound):
//  - ALERTS (per-chart): the alert line's style (alertColor/alertWidth/alertDash) + Price label -- the
//    horizontal line an alert drops via the price-scale + / "Add alert at <price>". See quickAlertAtPrice in
//    src/alerts/alert-drawing-sync.js.
//  - SOUND: the notification sound played by the "Play sound" action.
// The date/clock/timezone display moved to App > General > TIME (sections/app-time.js) -- it was never
// alert-specific; it's the app-wide time display every surface formats through.
import { alertSoundName, alertSoundPath, setAlertSound, clearAlertSoundName, soundObjectUrl } from '../../alerts/alert-display.js';
import { t } from '../../i18n/i18n.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, row, lineStroke, liveCheck } = ctx;
  section('ALERTS');
  content.appendChild(row('Alert line', lineStroke('alert')));
  content.appendChild(liveCheck('Price label', 'alertLabel'));

  // Notification sound — the mp3 played by the "Play sound" alert action. Pick any mp3 anywhere on the system;
  // we store its path and read it in place when it plays (no copy). Desktop only — a browser can't hand an
  // app a file path. This row shows the display name; Choose / preview / clear.
  section('SOUND');
  const nameSpan = document.createElement('span'); nameSpan.className = 'sd-unit';
  const refreshName = () => { nameSpan.textContent = alertSoundName() || t('None'); };
  refreshName();
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'audio/mpeg,.mp3'; file.style.display = 'none';
  file.onchange = () => {
    const f = file.files && file.files[0]; if (!f) return;
    let p = '';
    try { const req = /** @type {any} */ (globalThis).require; p = req && req('electron').webUtils.getPathForFile(f); } catch (_) {}
    if (p) { setAlertSound(p, f.name); refreshName(); }
    else console.warn('[alerts] could not resolve the file path — the desktop app is required to pick a sound');
    file.value = '';
  };
  /** @param {string} txt @param {string} title @param {() => void} on */
  const btn = (txt, title, on) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sd-btn'; b.textContent = txt; b.title = t(title); b.onclick = on; return b; };
  const choose = btn(t('Choose…'), 'Choose an mp3 file', () => file.click());
  const preview = btn('▶', 'Preview', () => { const u = soundObjectUrl(alertSoundPath()); if (u) new Audio(u).play().catch(() => {}); });
  const clear = btn('✕', 'Clear sound', () => { clearAlertSoundName(); refreshName(); });
  content.appendChild(row('Notification sound', nameSpan, choose, preview, clear));
  content.appendChild(file);
}
