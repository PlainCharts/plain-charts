// @ts-check
// Market-status dot + info popup for a Pane: the coloured session dot in the status line (green open /
// amber maintenance / red closed, read from the shared market-hours model) and the click-through popup
// (status + countdown + session progress bar + open/close times). Split out of pane.js as a prototype
// mixin -- these methods run with `this` bound to the Pane instance. The dot ELEMENT and its refresh
// timer are built in controls.js (addControls); these methods colour, toggle, and render it.

// The methods below run with `this` bound to the Pane instance. The Pane wraps the vendored kapelka
// chart engine and the market-hours model, both `any` at this boundary.
/** @type {Record<string, any> & ThisType<any>} */
export const marketDotMethods = {
  // Market-status dot in the status line: green open / amber maintenance / red closed, read from the
  // trading-session model at the broker's current time. Hidden on board panes, when toggled off, or
  // before the hours have loaded. Refreshed on a light timer + whenever the session data arrives.
  /** @param {any} [slOverride] */
  updateMarketDot(slOverride) {
    const el = this.mktDotEl;
    if (!el) return;
    const sl = slOverride || this.settings.statusLine || {}; // slOverride = the live settings-preview draft
    if (this.board || sl.marketStatus === false || !this.marketHours) {
      el.style.display = 'none';
      this._hideMarketPopup();
      return;
    }
    const now = (this.api() && this.api().serverNow && this.api().serverNow()) || Date.now();
    const st = this.marketHours.stateAt(now);
    if (st.state === 'unknown') {
      el.style.display = 'none';
      this._hideMarketPopup();
      return;
    }
    const C = sl.marketColors || {};
    el.style.display = 'inline-block';
    el.style.background =
      st.state === 'open'
        ? C.open || '#26a69a'
        : st.state === 'maintenance'
          ? C.maintenance || '#f0b90b'
          : C.closed || '#ef5350';
    el.title = st.state === 'open' ? 'Market open' : st.state === 'maintenance' ? 'Maintenance hours' : 'Market closed';
    if (this._mktPopup) this._renderMarketPopup(); // keep an open popup's countdown ticking
  },

  // Click the dot -> a small market-hours info popup below the status line (status + countdown +
  // session progress bar + open/close). Toggles; closes on an outside click.
  _toggleMarketPopup() {
    if (this._mktPopup) {
      this._hideMarketPopup();
      return;
    }
    if (!this.marketHours || !this.mktDotEl || this.marketHours.stateAt(Date.now()).state === 'unknown') return;
    const pop = document.createElement('div');
    pop.className = 'mkt-popup';
    // Follow the CHART theme (not the app): background + text colour + font from the canvas/price-scale
    // settings, so it reads on a light chart even when the app is dark. Border/track are theme-neutral grey.
    const cv = this.settings.canvas || {};
    const bg = cv.background || '#1e222d';
    const tx = cv.scaleTextColor || '#dddddd';
    const ff = cv.scaleFontFamily || 'system-ui, sans-serif';
    pop.style.cssText =
      'position:absolute;z-index:60;min-width:214px;max-width:270px;padding:10px 12px;border-radius:6px;font-family:' +
      ff +
      ';font-size:13px;line-height:1.35;color:' +
      tx +
      ';background:' +
      bg +
      ';border:1px solid rgba(128,128,128,.35);box-shadow:0 6px 22px rgba(0,0,0,.35)';
    this.el.appendChild(pop);
    this._mktPopup = pop;
    this._renderMarketPopup();
    const sr = /** @type {HTMLElement} */ (this.statusEl).getBoundingClientRect(),
      pr = this.el.getBoundingClientRect();
    pop.style.left = Math.max(6, sr.left - pr.left) + 'px';
    pop.style.top = sr.bottom - pr.top + 6 + 'px';
    this._mktPopupOff = (/** @type {PointerEvent} */ e) => {
      if (this._mktPopup && !this._mktPopup.contains(e.target) && e.target !== this.mktDotEl) this._hideMarketPopup();
    };
    setTimeout(
      () => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (this._mktPopupOff)),
      0,
    ); // skip the opening click
  },
  _hideMarketPopup() {
    if (this._mktPopupOff) {
      document.removeEventListener('pointerdown', this._mktPopupOff);
      this._mktPopupOff = null;
    }
    if (this._mktPopup) {
      this._mktPopup.remove();
      this._mktPopup = null;
    }
  },
  _renderMarketPopup() {
    const pop = this._mktPopup;
    if (!pop || !this.marketHours) return;
    const now = (this.api() && this.api().serverNow && this.api().serverNow()) || Date.now();
    const st = this.marketHours.stateAt(now);
    const sl = this.settings.statusLine || {},
      C = sl.marketColors || {};
    const shift = this.tzOffset() * 60000; // display-offset the absolute UTC times (this pane's tz)
    /** @param {number} ms */
    const D = (ms) => new Date(ms + shift);
    /** @param {number} ms */
    const hm = (ms) => {
      const d = D(ms);
      return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    };
    /** @param {number} ms */
    const dow = (ms) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][D(ms).getUTCDay()];
    /** @param {number} ms */
    const dur = (ms) => {
      let m = Math.round(Math.max(0, ms) / 60000);
      const dd = Math.floor(m / 1440);
      m -= dd * 1440;
      const h = Math.floor(m / 60),
        mm = m % 60;
      return dd ? dd + 'd ' + h + 'h' : h ? h + 'h ' + mm + 'm' : mm + 'm';
    };
    const color =
      st.state === 'open'
        ? C.open || '#26a69a'
        : st.state === 'maintenance'
          ? C.maintenance || '#f0b90b'
          : C.closed || '#ef5350';
    const head =
      st.state === 'open' ? 'Market open' : st.state === 'maintenance' ? 'Maintenance hours' : 'Market closed';
    let sub,
      bar = '',
      row = ''; // sub is set in every branch below; bar/row keep '' when not open
    if (st.state === 'open') {
      sub = 'Market is open. Closes in ' + dur(st.msToClose) + '.';
      const pct = Math.max(0, Math.min(100, (st.progress || 0) * 100));
      bar =
        '<div style="height:6px;border-radius:3px;background:rgba(128,128,128,.25);margin:8px 0 5px;overflow:hidden"><div style="height:100%;width:' +
        pct.toFixed(1) +
        '%;background:' +
        color +
        '"></div></div>';
      row =
        '<div style="display:flex;justify-content:space-between;opacity:.7;font-size:11px"><span>' +
        dow(st.session.open) +
        '</span><span>' +
        hm(st.session.open) +
        ' – ' +
        hm(st.session.close) +
        '</span></div>';
    } else if (st.nextOpen != null) {
      sub =
        (st.state === 'maintenance' ? 'Maintenance break. ' : 'Market closed. ') +
        'Opens ' +
        dow(st.nextOpen) +
        ' ' +
        hm(st.nextOpen) +
        ' (in ' +
        dur(st.msToOpen) +
        ').';
    } else {
      sub = 'Market closed.';
    }
    const offH = this.tzOffset() / 60;
    pop.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;font-weight:600;margin-bottom:3px"><span style="width:9px;height:9px;border-radius:50%;background:' +
      color +
      '"></span>' +
      head +
      '</div>' +
      '<div style="opacity:.85;font-size:12px">' +
      sub +
      '</div>' +
      bar +
      row +
      '<div style="opacity:.45;font-size:11px;margin-top:8px">Times shown in UTC' +
      (offH >= 0 ? '+' : '') +
      offH +
      '</div>';
  },
};
