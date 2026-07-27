// @ts-check
// Settings -> About section (Tier 3 of the chart-dialog de-monolith). App name/slogan/version.
// Receives the shared `ctx` (content container + helpers) from the shell.
import { t } from '../../i18n/i18n.js';   // vocabulary lookup (the app NAME stays as-is -- it is a brand)

const APP = {
  name: 'Plain Charts',
  version: '0.1.0',
  icon: 'images/logo.png',
};

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content } = ctx;
  const wrap = document.createElement('div'); wrap.className = 'sd-about';
  const logo = document.createElement('img'); logo.className = 'sd-about-logo'; logo.src = APP.icon; logo.alt = '';
  const title = document.createElement('div'); title.className = 'sd-about-title'; title.textContent = APP.name;
  const slogan = document.createElement('div'); slogan.className = 'sd-about-slogan'; slogan.textContent = t('Price and Time. Nothing else unless you want it.');
  const ver = document.createElement('div'); ver.className = 'sd-about-ver'; ver.textContent = t('Version') + ' ' + APP.version;
  wrap.append(logo, title, slogan, ver);

  content.appendChild(wrap);
}
