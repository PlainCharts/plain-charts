// @ts-check
// Settings -> Canvas section (Tier 3 of the chart-dialog de-monolith). Chart background, grid,
// nav/pane buttons, margins, zoom caps, candle width and crosshair. Edits the draft; previews
// live through the appearance controls in ctx. strokeSwatch (crosshair) is imported directly.
import { strokeSwatch } from '../../ui/colorpicker.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, preview, section, row, inlineRow, labeled, unit,
          colorPicker, checkControl, selectControl, numberControl } = ctx;
  const c = draft.canvas;
  section('CHART');
  content.appendChild(row('Background', colorPicker(c, 'background')));

  section('GRID');
  content.appendChild(row('Lines',
    selectControl(c, 'gridMode', [['both', 'Vert and horz'], ['vert', 'Vert only'], ['horz', 'Horz only'], ['none', 'None']]),
    colorPicker(c, 'gridColor')));
  content.appendChild(inlineRow(
    labeled('Style:', selectControl(c, 'gridStyle', [[0, 'Solid'], [4, 'Sparse dotted'], [3, 'Large dashed']], true))));
  section('BUTTONS');
  content.appendChild(row('Navigation',
    selectControl(c, 'navButtons', [['hover', 'Visible on mouse over'], ['always', 'Always visible'], ['never', 'Always invisible']])));
  content.appendChild(row('Pane',
    selectControl(c, 'paneButtons', [['hover', 'Visible on mouse over'], ['always', 'Always visible'], ['never', 'Always invisible']])));

  section('MARGINS');
  content.appendChild(row('Top', numberControl(c, 'marginTop', 0, 25), unit('%')));      // cap top/bottom at 25%
  content.appendChild(row('Bottom', numberControl(c, 'marginBottom', 0, 25), unit('%')));
  content.appendChild(row('Right', numberControl(c, 'marginRight', 0, 100), unit('bars')));

  section('ZOOM');
  // Horizontal max zoom out = most bars on screen before the chart stops zooming out (over-compression).
  content.appendChild(row('Max zoom out (horizontal)',
    numberControl(c, 'maxZoom', 50, 5000, 'Most bars on screen (lower = stops horizontal over-compression sooner)'), unit('bars')));
  // Vertical max zoom out = the visible price span may not exceed N x the visible data high-low
  // (a ratio, so it works for any instrument). Stops the chart squashing into a flat line.
  content.appendChild(row('Max zoom out (vertical)',
    numberControl(c, 'maxVZoom', 2, 100, 'Price range cap = N x the visible high-low (lower = stops vertical over-compression sooner)'), unit('x range')));
  // Candle width = body width as % of each bar's slot (CANDLEW; default 70% = 0.7).
  content.appendChild(row('Candle width',
    selectControl(c, 'candleWidthPct', [[40, '40%'], [50, '50%'], [60, '60%'], [70, '70%'], [80, '80%'], [90, '90%'], [100, '100%']], true)));

  section('CROSSHAIR');
  // one stroke swatch = colour + thickness + line style (replaces the old color + Thickness +
  // Style trio). The picker speaks 'solid|dotted|dashed'; the crosshair stores the engine's numeric style.
  const CROSS_LS = { solid: 0, dotted: 1, dashed: 2 };
  content.appendChild(row('Line', strokeSwatch({
    color: { get: () => c.crosshairColor, set: (/** @type {string} */ v) => { c.crosshairColor = v; preview(); } },
    width: { get: () => c.crosshairWidth, set: (/** @type {number} */ v) => { c.crosshairWidth = v; preview(); } },
    lineStyle: { get: () => c.crosshairStyle, set: (/** @type {'solid'|'dotted'|'dashed'} */ v) => { c.crosshairStyle = (CROSS_LS[v] != null ? CROSS_LS[v] : 0); preview(); } },
  })));
  content.appendChild(inlineRow(
    checkControl(c, 'crosshairTimeLabel', 'Time label'),
    checkControl(c, 'crosshairPriceLabel', 'Price label')));
  content.appendChild(row('Label color', colorPicker(c, 'crosshairLabelBg')));
}
