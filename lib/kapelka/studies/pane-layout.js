// @ts-check
// Sub-pane geometry for the StudyHost — pure functions over the engine's pane handles: locating a
// series' pane, the height modes (normal | max | collapsed) with their snap/restore state, keeping a
// collapsed pane alive as an empty bar, and re-deriving pane indices after a move. No host state and
// no lifecycle here: the host passes its chart handle + attachments in and keeps the public API.

// find the pane index a series lives in (-1 when not found / no panes)
/** @param {any} chart @param {any} series */
export function paneIndexOf(chart, series) {
  try {
    const ps = chart.panes();
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].getSeries().indexOf(series) !== -1) return i;
    }
  } catch (_) {}
  return -1;
}

// pane height mode: 'normal' | 'max' (squish others) | 'collapsed' (thin bar). State (snap /
// collapsedPx) is kept on the attachment `state` so it restores cleanly.
/** @param {any} chart @param {any} mainSeries @param {any} series @param {string} mode @param {Record<string, any>} state */
export function applyPaneMode(chart, mainSeries, series, mode, state) {
  let ps;
  try {
    ps = chart.panes();
  } catch (_) {
    return;
  }
  const idx = paneIndexOf(chart, series);
  if (idx < 0) return;
  const mainIdx = paneIndexOf(chart, mainSeries);
  const sf = (/** @type {any} */ p) => {
    try {
      return p.getStretchFactor();
    } catch (_) {
      try {
        return p.getHeight();
      } catch (_2) {
        return 1;
      }
    }
  };
  const px = (/** @type {any} */ p) => {
    try {
      return p.getHeight() || 0;
    } catch (_) {
      return 0;
    }
  };
  const set = (/** @type {any} */ p, /** @type {number} */ f) => {
    try {
      p.setStretchFactor(Math.max(0.0001, f));
    } catch (_) {}
  };
  const absorb = mainIdx >= 0 && mainIdx !== idx ? mainIdx : idx === 0 ? 1 : 0;
  const COLLAPSED_H = 26;
  if (mode === 'max') {
    if (!state.snap) state.snap = ps.map(sf);
    ps.forEach((/** @type {any} */ p, /** @type {number} */ i) => set(p, i === idx ? 1 : 0.0001));
  } else if (mode === 'collapsed') {
    const h = ps.map(px);
    if (state.collapsedPx == null) state.collapsedPx = h[idx];
    const delta = h[idx] - COLLAPSED_H;
    ps.forEach((/** @type {any} */ p, /** @type {number} */ i) =>
      set(p, i === idx ? COLLAPSED_H : i === absorb ? h[i] + delta : h[i]),
    );
  } else if (state.snap) {
    state.snap.forEach((/** @type {number} */ f, /** @type {number} */ i) => {
      if (ps[i]) set(ps[i], f);
    });
    state.snap = null;
    state.collapsedPx = null;
  } else if (state.collapsedPx != null) {
    const h = ps.map(px),
      grow = Math.max(0, state.collapsedPx - h[idx]);
    ps.forEach((/** @type {any} */ p, /** @type {number} */ i) =>
      set(p, i === idx ? state.collapsedPx : i === absorb ? Math.max(COLLAPSED_H, h[i] - grow) : h[i]),
    );
    state.collapsedPx = null;
  } else {
    set(ps[idx], 0.3);
  }
}

// keep a collapsed (but not hidden) study's empty pane alive as a thin bar; `globallyHidden` is the
// host's indicators-off flag.
/** @param {any} chart @param {Record<string, any>} a @param {boolean} globallyHidden */
export function applyPreserve(chart, a, globallyHidden) {
  if (a.overlay) return;
  try {
    const ps = chart.panes();
    const series = a.plots.values().next().value;
    const idx = series ? paneIndexOf(chart, series) : a.paneIndex;
    const keep = !!a.collapsed && !a.hidden && !globallyHidden;
    if (ps[idx] && ps[idx].setPreserveEmptyPane) ps[idx].setPreserveEmptyPane(keep);
  } catch (_) {}
}

// re-derive each sub-pane study's paneIndex from where its series actually lives (after a move)
/** @param {any} chart @param {Record<string, any>[]} attached */
export function reindexPanes(chart, attached) {
  let ps;
  try {
    ps = chart.panes();
  } catch (_) {
    return;
  }
  attached.forEach((a) => {
    if (a.overlay) return;
    const series = a.plots.values().next().value;
    if (!series) return;
    for (let i = 0; i < ps.length; i++) {
      let list;
      try {
        list = ps[i].getSeries();
      } catch (_) {
        list = [];
      }
      if (list.indexOf(series) !== -1) {
        a.paneIndex = i;
        break;
      }
    }
  });
}
