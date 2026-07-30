// @ts-check
// Shared helpers for studies — price source selection (close/open/hl2/…), the
// "Source" input every indicator needs.
export const SOURCES = [
  { key: 'close', name: 'Close' },
  { key: 'open', name: 'Open' },
  { key: 'high', name: 'High' },
  { key: 'low', name: 'Low' },
  { key: 'hl2', name: '(H+L)/2' },
  { key: 'hlc3', name: '(H+L+C)/3' },
  { key: 'ohlc4', name: '(O+H+L+C)/4' },
];

/** @param {import('./types.js').StudyBar} bar @param {string} source @returns {number} */
export function priceOf(bar, source) {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:
      return bar.close;
  }
}
