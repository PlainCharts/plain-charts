// @ts-check
// CQG symbol-browser catalog (Layer 3, app-owned). Pure CQG: `symbol` is the CQG product code and
// `name` is CQG's own description -- both taken from the live CQG symbol universe. (Barchart was only a
// reference for WHICH instruments to include; none of its symbology lives here.) This drives the symbol
// dialog's left tree (group -> exchange -> instrument type) and its right-side symbol list. It grows
// sector by sector; it is NOT the CQG universe (that stays the resolver's job for pasted symbols).
//
//   symbol         CQG product code, shown in the list and set on the chart when picked
//   name           CQG description
//   group          exchange group -- top level of the tree (e.g. CME Group, CBOE)
//   exchange       the venue -- second level, and what the bottom-left filter checks
//   instrumentType the sector -- the clickable tree leaf (Indices, Energy, Metals, ...)

/** @typedef {{ symbol: string, name: string, group: string, exchange: string, instrumentType: string }} CatalogItem */

/** @type {CatalogItem[]} */
export const CQG_CATALOG = [
  { symbol: 'EP', name: 'E-Mini S&P 500', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'ENQ', name: 'E-mini NASDAQ-100', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'YM', name: 'E-mini Dow ($5)', group: 'CME Group', exchange: 'CBOT', instrumentType: 'Indices' },
  { symbol: 'RTY', name: 'E-mini Russell 2000', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'EMD', name: 'E-mini MidCap 400', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  { symbol: 'GD', name: 'S&P GSCI (Globex)', group: 'CME Group', exchange: 'CME', instrumentType: 'Indices' },
  {
    symbol: 'VX',
    name: 'CBOE Volatility Index (VX) Futures',
    group: 'CBOE',
    exchange: 'CFE',
    instrumentType: 'Indices',
  },
];
