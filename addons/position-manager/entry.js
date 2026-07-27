// @ts-check
// order-ticket ENTRY -- MARKET order placement. placeMarket() is the only entry action (Buy/Sell, the position
// dialog's partial/add, the watcher). The addon sends MARKET orders only; the Limit/Stop order-type logic was
// removed. Routes through the worker seam (ot.exec). Status goes to the small line under Buy/Sell (simpleSay).

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */
/** @typedef {import('/data_engine/index.js').OrderSide} OrderSide */

/**
 * @param {Kernel} ot
 * @param {{ simpleSay: (m: string) => void }} deps
 */
export function createEntry(ot, { simpleSay }) {
  const { cfg, exec, t } = ot;
  const ctx = () => ({ broker: cfg.broker, symbol: cfg.symbol });

  // place a MARKET order of qty on the given side (Buy/Sell, partial-close, add). Builds the semantic command and
  // routes it through the worker seam (ot.exec).
  /** @param {OrderSide} side @param {number|string} qty */
  const placeMarket = (side, qty) => {
    qty = Math.abs(Number(qty) || 1);
    simpleSay(side.toUpperCase() + ' ' + qty + ' ' + cfg.symbol + ' ' + t('MARKET…'));
    exec({ type: 'place', orderType: 'market', ctx: ctx(), side, qty })
      .then((r) => simpleSay(r && r.error ? t('error:') + ' ' + r.error : side.toUpperCase() + ' ' + t('market sent')));
  };

  return { placeMarket };
}
