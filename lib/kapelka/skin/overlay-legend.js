// @ts-check
// On-chart overlay legend: a top-left list of the chart OVERLAYS (SMA, Bollinger…), each row =
// name + live values + hover-revealed controls (hide / settings / remove). Sub-pane studies have
// their own per-pane legend (legend.js); this is the price-pane list.
//
// Collapsible (default): collapsed it's a small count chip (▾ N); click to expand to the row list,
// with a ▴ to collapse back. Pass { overlayCollapsible: false } to createSkin for an always-open
// list. The open/closed state lives on the skin so it survives re-renders.
import { effectiveStyle, fmtVal } from '../studies/channels.js';
import { studyLabel } from './legend.js';

/** @param {any} skin  the skin hub (chart/host/container + overlay open/collapse state) */
export function attachOverlayLegend(skin) {
  const { host, chart, container } = skin;
  if (!container) return;

  const collapsible = skin.overlayCollapsible !== false;
  if (skin.overlayOpen == null) skin.overlayOpen = false;

  const box = document.createElement('div');
  box.className = 'skin-ovl';
  box.style.top = (skin.overlayTop != null ? skin.overlayTop : 8) + 'px';
  box.style.left = '8px';
  container.appendChild(box);
  skin._offs.push(() => {
    try {
      box.remove();
    } catch (_) {}
  });

  /**
   * @param {string} txt
   * @param {string} title
   * @param {() => void} fn
   * @param {boolean} [always]
   */
  const icon = (txt, title, fn, always) => {
    const s = document.createElement('span');
    s.className = 'skin-ovl-ico' + (always ? ' skin-always' : '');
    s.textContent = txt;
    s.title = title;
    s.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return s;
  };

  // Rebuilding the DOM drops the CSS :hover state until the next mouse event -- with live data the
  // 'computed' stream fires constantly, so a naive full rebuild makes the hover-revealed controls
  // flicker under the cursor. Rebuild only when the STRUCTURE changes (overlay list, hidden/error,
  // colors, open state); value ticks and crosshair moves update the value spans in place.
  let lastSig = '';
  /** @type {{ span: HTMLElement, a: any, key: string }[]} */
  let slots = [];

  // plotMeta is REPLACED with fresh objects on every compute -- look the current one up by key.
  /** @param {Map<any, any>|null} seriesData */
  const updateValues = (seriesData) => {
    for (const s of slots) {
      const pm = (s.a.plotMeta || []).find((/** @type {any} */ p) => p.key === s.key);
      if (!pm) continue;
      const series = s.a.plots.get(s.key);
      let v = seriesData && series ? (seriesData.get(series) || {}).value : null;
      if (v == null) v = pm.last;
      s.span.textContent = fmtVal(v, pm.precision);
    }
  };

  /** @param {any[]} overlays */
  const structureSig = (overlays) => {
    const o = skin.legendOpts || {};
    if (!overlays.length) return 'empty';
    if (collapsible && !skin.overlayOpen) return 'chip:' + overlays.length;
    return (
      overlays
        .map((/** @type {any} */ a) => {
          const plots = (a.plotMeta || [])
            .map((/** @type {any} */ pm) => {
              const eff = effectiveStyle(a.style, pm);
              return (
                pm.key +
                ':' +
                (pm.legend === false ? 'x' : '') +
                (eff.visible === false ? 'x' : '') +
                eff.color +
                ':' +
                pm.precision
              );
            })
            .join(',');
          return (
            studyLabel(a, { inputs: o.inputs !== false }) +
            '|' +
            (a.hidden ? 1 : 0) +
            '|' +
            (a.error || '') +
            '|' +
            plots
          );
        })
        .join(';') +
      '#' +
      (o.title === false ? 't' : '') +
      (o.values === false ? 'v' : '')
    );
  };

  /** @param {Map<any, any>|null} seriesData */
  const render = (seriesData) => {
    const overlays = host.attached.filter((/** @type {any} */ a) => a.overlay);
    const sig = structureSig(overlays);
    if (sig === lastSig) {
      updateValues(seriesData);
      return;
    }
    lastSig = sig;
    slots = [];
    box.innerHTML = '';
    if (!overlays.length) {
      box.style.display = 'none';
      skin.overlayOpen = false;
      return;
    }
    box.style.display = '';

    // collapsed -> a count chip
    if (collapsible && !skin.overlayOpen) {
      const chip = document.createElement('div');
      chip.className = 'skin-ovl-chip';
      const tw = document.createElement('span');
      tw.className = 'skin-ovl-tw';
      tw.textContent = '▾';
      const ct = document.createElement('span');
      ct.className = 'skin-ovl-count';
      ct.textContent = String(overlays.length);
      chip.append(tw, ct);
      chip.title = overlays.length + ' indicator' + (overlays.length > 1 ? 's' : '') + ' on this chart';
      chip.onclick = (e) => {
        e.stopPropagation();
        skin.overlayOpen = true;
        render(null);
      };
      box.appendChild(chip);
      return;
    }

    // expanded -> one row per overlay
    const o = skin.legendOpts || {};
    overlays.forEach((/** @type {any} */ a) => {
      const row = document.createElement('div');
      row.className = 'skin-ovl-row' + (a.hidden ? ' skin-dim' : '');
      if (o.title !== false) {
        const name = document.createElement('span');
        name.className = 'skin-ovl-name';
        name.textContent = studyLabel(a, { inputs: o.inputs !== false });
        name.onclick = () => {
          if (skin.openSettings) skin.openSettings(a);
        };
        row.appendChild(name);
      }
      if (a.error) {
        const warn = icon('⚠', a.error, () => {}, true);
        warn.style.color = '#e0a030';
        row.appendChild(warn);
      }
      if (o.values !== false)
        (a.plotMeta || []).forEach((/** @type {any} */ pm) => {
          if (pm.legend === false) return;
          const eff = effectiveStyle(a.style, pm);
          if (eff.visible === false) return;
          const series = a.plots.get(pm.key);
          let v = seriesData && series ? (seriesData.get(series) || {}).value : null;
          if (v == null) v = pm.last;
          const sp = document.createElement('span');
          sp.className = 'skin-ovl-v';
          sp.style.color = eff.color;
          sp.textContent = fmtVal(v, pm.precision);
          slots.push({ span: sp, a, key: pm.key });
          row.appendChild(sp);
        });
      // controls (hover-revealed; the crossed-eye stays visible while hidden)
      const eye = icon(
        a.hidden ? '◌' : '◉',
        a.hidden ? 'Show' : 'Hide',
        () => {
          host.toggleHidden(host.attached.indexOf(a));
          render(null);
        },
        a.hidden,
      );
      const gear = icon('⚙', 'Settings', () => {
        if (skin.openSettings) skin.openSettings(a);
      });
      const rm = icon('✕', 'Remove', () => host.remove(host.attached.indexOf(a)));
      row.append(eye, gear, rm);
      box.appendChild(row);
    });

    // collapse affordance back to the chip
    if (collapsible) {
      const col = document.createElement('div');
      col.className = 'skin-ovl-collapse';
      col.textContent = '▴';
      col.title = 'Collapse';
      col.onclick = (e) => {
        e.stopPropagation();
        skin.overlayOpen = false;
        render(null);
      };
      box.appendChild(col);
    }
  };

  host.on('added', () => render(null));
  host.on('computed', () => render(null));
  host.on('removed', () => render(null));
  skin._refreshers.push(() => render(null)); // re-render on host visibility changes (dim hidden rows)
  if (chart.onCursorMove) {
    const cb = (/** @type {any} */ param) => render(param && param.time != null ? param.seriesData : null);
    chart.onCursorMove(cb);
    skin._offs.push(() => {
      try {
        chart.offCursorMove(cb);
      } catch (_) {}
    });
  }
  render(null);
}
