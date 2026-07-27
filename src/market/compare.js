// @ts-check
// Compare symbols: the top-strip ⊕ button opens the symbol search; the picked
// (broker, symbol) is added to the ACTIVE pane as a candle series in a sub-pane
// below, on the same timeframe. Removal is via the small chip on the pane. Kept
// deliberately simple — one comparison per pane, "New pane" placement only.
import { openSymbolSearch } from './symbol-search.js';
import { getActivePane } from '../chart/layout.js';
import { $ } from '../dom.js';

export function initCompare() {
  const btn = $('btnCompare');
  if (!btn) return;
  btn.onclick = () => {
    const p = getActivePane();
    if (!p) return;
    openSymbolSearch((brokerId, symbol) => p.addCompare(brokerId, symbol));
  };
}
