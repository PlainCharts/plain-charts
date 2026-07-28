// @ts-check
// Settings -> Scales section (Tier 3 of the chart-dialog de-monolith). Time scale, price scale,
// plus button, price/bid/ask lines + labels, spread meter and bar-close countdown. Mixes draft
// (canvas colors/fonts) with live pane.settings (via the live controls in ctx). Imports its own deps.
import { PRICE_SCALE_MODES } from '../../chart/scale-modes.js';
import { PLUS_ACTIONS } from '../plus-actions.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, section, row, inlineRow, labeled, unit, helpDot,
          colorPicker, textPicker, selectControl,
          liveCheck, lineStroke, liveColor, liveText, liveNum, liveSelect, dateFmtHelp } = ctx;
  const c = draft.canvas;
  section('TIME SCALE');
  content.appendChild(liveCheck('Show time scale', 'timeScale'));
  content.appendChild(liveCheck('Day of week on labels', 'tsDayOfWeek'));
  content.appendChild(liveCheck('Day of week on time scale', 'tsDowAxis'));
  content.appendChild(row('Date format',
    liveText('tsDateFmt', '%b %-d'), dateFmtHelp()));
  content.appendChild(row('Time hours format',
    liveSelect('tsHours24', [[true, '24-hours'], [false, '12-hours']], (v) => v === 'true')));
  // min px between two time-axis labels before one is dropped (engine MIN_LABEL_PX). Lower = denser
  // labels (e.g. gap-adjacent boundaries stay closer together); higher = more breathing room.
  content.appendChild(row('Label spacing',
    liveNum('tsLabelGap', '48'), unit('px')));

  section('PRICE SCALE');
  content.appendChild(liveCheck('Show price scale', 'priceScale'));
  content.appendChild(row('Placement',
    liveSelect('scaleLeft', [[false, 'Right'], [true, 'Left']], (v) => v === 'true')));
  content.appendChild(row('Price scale mode',
    liveSelect('priceScaleMode', PRICE_SCALE_MODES.map(([label, v]) => [v, label]), (v) => parseInt(v, 10))));
  content.appendChild(liveCheck('Invert scale', 'invertScale'));

  // Text / font / border colour apply to BOTH the price and time scale, so they are their own section
  // rather than living under PRICE SCALE.
  section('SCALE STYLE');
  content.appendChild(row('Text', textPicker(c, 'scaleTextColor', 'scaleFontSize')));
  content.appendChild(row('Font', selectControl(c, 'scaleFontFamily', [
    ['', 'Default'],
    ['Helvetica, Arial, sans-serif', 'Sans-serif'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['"Courier New", monospace', 'Monospace'],
    ['"Trebuchet MS", system-ui, sans-serif', 'Trebuchet'],
  ])));
  content.appendChild(row('Borders', colorPicker(c, 'scaleLineColor')));
  section('PLUS BUTTON');
  content.appendChild(liveCheck('Plus button', 'plusButton',
    helpDot('Hover the chart to show a + at the price scale. Left-click runs the default action; right-click opens the menu.')));
  content.appendChild(row('Plus default action',
    liveSelect('plusDefaultAction', PLUS_ACTIONS.map((a) => [a.id, a.name]))));

  section('LINES');
  content.appendChild(liveCheck('Price line', 'priceLine', lineStroke('priceLine')));
  content.appendChild(liveCheck('Bid line', 'bidLine', lineStroke('bidLine')));
  content.appendChild(liveCheck('Ask line', 'askLine', lineStroke('askLine')));

  section('LABELS');
  content.appendChild(liveCheck('Symbol last price label', 'lastPriceLabel'));
  content.appendChild(liveCheck('Bid label', 'bidLabel'));
  content.appendChild(liveCheck('Ask label', 'askLabel'));
  content.appendChild(liveCheck('Bid/Ask tags', 'priceTags'));
  content.appendChild(liveCheck('No overlapping labels', 'noOverlapLabels'));

  section('OTHER');
  content.appendChild(liveCheck('Spread meter', 'spreadMeter'));
  content.appendChild(inlineRow(
    labeled('Color', liveColor('spreadColor')),
    labeled('Max', liveNum('spreadMax', '0')),
    labeled('Max color', liveColor('spreadMaxColor'))));
  content.appendChild(liveCheck('Countdown to bar close', 'countdown'));
  content.appendChild(inlineRow(
    labeled('Font', liveColor('countdownColor')),
    labeled('Background', liveColor('countdownBg'))));
}
