// @ts-check
// Where a study's pane sits: its index + the pixel offset of its top (sum of pane heights above).
/**
 * @param {any} chart  the engine/chart hub the skin reads (a boundary -> any)
 * @param {any} series
 * @returns {{ idx: number, top: number }}
 */
export function paneGeom(chart, series) {
  let idx = -1, top = 0;
  try {
    const ps = chart.panes();
    for (let i = 0; i < ps.length; i++) { if (series && ps[i].getSeries().indexOf(series) !== -1) { idx = i; break; } }
    for (let i = 0; i < idx && i < ps.length; i++) top += ps[i].getHeight();
  } catch (_) {}
  return { idx, top };
}

/** @param {any} chart @returns {number} */
export function scaleWidth(chart) {
  try { return chart.priceAxis('right').width(); } catch (_) { return 0; }
}

// Should a study's sub-pane chrome (legend / controls) be shown? Hidden when the study is
// per-study hidden or when the host reports indicators globally hidden. Collapsed does NOT hide
// (you still need the legend/controls to expand). _isHidden is a host hook (default: never).
/** @param {any} host  the host hub (boundary -> any) @param {any} a  the attached study @returns {boolean} */
export function chromeVisible(host, a) {
  return !a.hidden && !(host._isHidden && host._isHidden());
}
