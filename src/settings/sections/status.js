// @ts-check
// Settings -> Status section (Tier 3 of the chart-dialog de-monolith). The on-chart status line:
// instrument title + chart values, and the kapelka/skin indicator legend. Edits the draft; previews
// live through the appearance controls in ctx. Imports its own domain deps directly.
import { INDICATORS_DEFAULT } from '../../chart/pane.js';
import { inlineRow, labeled } from '../sd-controls.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, section, row, checkRow, colorPicker, textPicker, opacitySlider } = ctx;
  const s = draft.statusLine;
  section('INSTRUMENT');
  content.appendChild(checkRow(s, 'Title', 'title'));
  content.appendChild(checkRow(s, 'Chart values', 'chartValues'));
  // Text: our rich colour picker with a TEXT SIZE section (no bold/italic) -- replaces the swatch + size dropdown.
  content.appendChild(row('Text', textPicker(s, 'color', 'fontSize')));
  content.appendChild(row('Background', colorPicker(s, 'bgColor')));

  // MARKET STATUS: the trading-hours dot at the far right of the status line + its per-state colours.
  section('MARKET STATUS');
  content.appendChild(checkRow(s, 'Market status', 'marketStatus'));
  const mc = s.marketColors || (s.marketColors = { open: '#26a69a', maintenance: '#f0b90b', closed: '#ef5350' });
  content.appendChild(inlineRow(
    labeled('Open', colorPicker(mc, 'open')),
    labeled('Maintenance', colorPicker(mc, 'maintenance')),
    labeled('Closed', colorPicker(mc, 'closed')),
  ));

  // INDICATORS: kapelka/skin legend display — which parts show + the underlay box opacity. The box
  // color follows the chart background, so only on/off + opacity are configurable here.
  const ind = draft.indicators || (draft.indicators = structuredClone(INDICATORS_DEFAULT));
  section('INDICATORS');
  content.appendChild(checkRow(ind, 'Titles', 'title'));
  content.appendChild(checkRow(ind, 'Values', 'values'));
  content.appendChild(checkRow(ind, 'Background', 'bg', opacitySlider(ind, 'bgOpacity')));
}
