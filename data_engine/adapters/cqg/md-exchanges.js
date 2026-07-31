// @ts-check
// CQG market-data exchange catalog -- the full universe of exchanges a CQG account can be entitled to,
// grouped exactly as CQG's fee schedule groups them (Exchange Group -> Exchange). Static reference data:
// the symbol tree targets an EXCHANGE, and a CQG account's market-data subscription selects which of these
// the user actually receives. Depth (Top-of-Book vs Depth-of-Market) is a SEPARATE axis and is not modeled
// here -- the tree only needs to know which exchange it targets, not how deep.
//
// This is the FULL list. A user's selection acts as a FILTER over it (get-full-then-filter), never a
// prefilter. Nothing consumes it yet; it is the foundation the symbol dialog will build on.
//
// NOTE: `code` values are our own stable identifiers. They get reconciled with CQG's real exchange codes
// when symbol resolution is wired (later) -- at this stage nothing reads them, so readable slugs are fine.

/** @typedef {{ code: string, name: string }} MdExchange */
/** @typedef {{ group: string, exchanges: MdExchange[] }} MdExchangeGroup */

/** @type {MdExchangeGroup[]} */
export const MD_EXCHANGES = [
  {
    group: 'CME Market Data',
    exchanges: [
      { code: 'CME', name: 'CME / Globex' },
      { code: 'CBOT', name: 'CBOT / Globex' },
      { code: 'NYMEX', name: 'NYMEX / Globex' },
      { code: 'COMEX', name: 'COMEX / Globex' },
    ],
  },
  {
    group: 'ICE Market Data',
    exchanges: [
      { code: 'ICE_US', name: 'ICE Futures US' },
      { code: 'ICE_EU_COMM', name: 'ICE Futures Europe - Commodities' },
      { code: 'ICE_EU_FIN', name: 'ICE Futures Europe - Financials' },
    ],
  },
  {
    group: 'CFE / CBOE Data',
    exchanges: [{ code: 'CFE', name: 'CBOE Futures Exchange (VIX)' }],
  },
  {
    group: 'Foreign Exchanges (Non-US)',
    exchanges: [
      { code: 'EUREX', name: 'Eurex' },
      { code: 'OSE', name: 'Osaka - Japan (OSE)' },
      { code: 'HKEX', name: 'Hong Kong Futures Exchange (HKEX)' },
      { code: 'SGX', name: 'Singapore (SGX)' },
      { code: 'ASX', name: 'Australian Securities Exchange (ASX)' },
      { code: 'EURONEXT', name: 'Euronext (CAC-40)' },
    ],
  },
  {
    group: 'Cash Index Data',
    exchanges: [
      { code: 'IDX_SP', name: 'S&P 500 Cash Indexes' },
      { code: 'IDX_DJ', name: 'Dow Jones / NYSE Internals' },
      { code: 'IDX_NASDAQ', name: 'NASDAQ Global Indexes' },
    ],
  },
];

/** @type {string[]} every exchange code, flattened -- for membership checks / validating a saved selection */
export const MD_EXCHANGE_CODES = MD_EXCHANGES.flatMap((g) => g.exchanges.map((e) => e.code));
