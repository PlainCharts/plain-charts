// @ts-check
// Settings -> Instrument section. How the instrument itself renders on the chart -- candle body,
// borders and wick colors. Edits the draft; previews live through the appearance controls in ctx.

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, section, visColorRow } = ctx;
  const cd = draft.candles;
  section('CANDLES');
  content.appendChild(visColorRow(cd, 'Body', 'bodyVisible', 'upColor', 'downColor'));
  content.appendChild(visColorRow(cd, 'Borders', 'borderVisible', 'borderUpColor', 'borderDownColor'));
  content.appendChild(visColorRow(cd, 'Wick', 'wickVisible', 'wickUpColor', 'wickDownColor'));
}
