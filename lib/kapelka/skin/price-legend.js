// @ts-check
// On-chart price legend: the top-left "symbol · timeframe · source  O H L C" readout for the MAIN
// series (the top-left ticker line). It shows the hovered bar's OHLC, falling back to the
// last bar when idle, and updates on crosshair move + host recompute.
//
// symbol / timeframe / source are PRODUCT metadata the consumer supplies (kapelka only has bars) — pass
// them via createSkin({ priceLegend: { symbol, timeframe, source } }) or update live with
// skin.setPriceLegend({ symbol }). With no metadata it still shows the OHLC. Purely additive: events
// in, DOM out — the host never depends on it.
/** @param {any} skin  the skin hub (chart/host/container + priceLegend metadata) */
export function attachPriceLegend(skin) {
  const { host, chart, container } = skin;
  if (!container) return;

  const box = document.createElement('div');
  box.className = 'skin-price';
  box.style.top = '6px'; box.style.left = '8px';
  container.appendChild(box);
  skin._offs.push(() => { try { box.remove(); } catch (_) {} });

  const mainSeries = () => { try { return host._mainSeries ? host._mainSeries() : null; } catch (_) { return null; } };
  const lastBar = () => { const b = host.bars || []; return b.length ? b[b.length - 1] : null; };

  /** @param {Map<any, any>|null} seriesData */
  const render = (seriesData) => {
    const meta = skin.priceLegend || {};
    const s = mainSeries();
    const bar = ((seriesData && s) ? seriesData.get(s) : null) || lastBar();
    /** @param {any} v */
    const fmt = (v) => {
      if (v == null) return '—';
      try { return (s && s.formatPrice) ? s.formatPrice().format(v) : String(v); } catch (_) { return String(v); }
    };
    box.innerHTML = '';
    // title: symbol · timeframe · source (each optional; joined only from what's provided)
    const title = [meta.symbol, meta.timeframe, meta.source].filter(Boolean).join('  ·  ');
    if (title) {
      const t = document.createElement('span'); t.className = 'skin-price-title'; t.textContent = title;
      box.appendChild(t);
    }
    if (bar) {
      const vals = document.createElement('span'); vals.className = 'skin-price-vals';
      /**
       * @param {string} k
       * @param {any} v
       */
      const cell = (k, v) => { const sp = document.createElement('span'); sp.className = 'skin-price-v'; sp.textContent = k + ' ' + fmt(v); return sp; };
      vals.append(cell('O', bar.open), cell('H', bar.high), cell('L', bar.low), cell('C', bar.close));
      box.appendChild(vals);
    }
    box.style.display = (title || bar) ? '' : 'none';
  };

  // live metadata update (e.g. the app switched symbol/timeframe)
  skin.setPriceLegend = (/** @type {any} */ patch) => { skin.priceLegend = { ...(skin.priceLegend || {}), ...(patch || {}) }; render(null); };

  host.on('computed', () => render(null));   // last-bar OHLC follows recompute
  skin._refreshers.push(() => render(null));
  if (chart.onCursorMove) {
    const cb = (/** @type {any} */ param) => render(param && param.time != null ? param.seriesData : null);
    chart.onCursorMove(cb);
    skin._offs.push(() => { try { chart.offCursorMove(cb); } catch (_) {} });
  }
  render(null);
}
