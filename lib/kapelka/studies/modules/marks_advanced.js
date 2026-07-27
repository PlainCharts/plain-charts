// @ts-check
// Ether at the limit (advanced marks). Every annotation below is composed from `path` + `text` only —
// there is NO "curve", "circle", "arrow", "bracket", or "hatch" type anywhere in the library. The study
// COMPUTES the vertices as data, so it draws forms the engine has never heard of. Before the open shapes
// channel each of these would have required editing the engine to bless a new shape type; here it's just
// geometry a study author writes. Overlay study: it annotates the price chart directly.
import { Studies } from '../registry.js';

Studies.register({
  id: 'marks_advanced',
  name: 'Ether (advanced marks)',
  overlay: true,
  inputs: [],
  /** @param {import('../types.js').StudyBar[]} bars */
  calc(bars) {
    const N = bars.length;
    if (N < 60) return { plots: [] };

    // a faint SMA so the overlay study is well-formed (legend + a plot); the marks are the show.
    const len = 20, sma = /** @type {{ time: number, value: number }[]} */ ([]); let sum = 0;
    for (let i = 0; i < N; i++) { sum += bars[i].close; if (i >= len) sum -= bars[i - len].close; if (i >= len - 1) sma.push({ time: bars[i].time, value: sum / len }); }

    const R = Math.min(N, 110), start = N - R;
    let hiV = -Infinity, loV = Infinity, hiI = start, loI = start;
    for (let i = start; i < N; i++) { if (bars[i].high > hiV) { hiV = bars[i].high; hiI = i; } if (bars[i].low < loV) { loV = bars[i].low; loI = i; } }
    const hiT = bars[hiI].time, loT = bars[loI].time;
    const lastT = bars[N - 1].time, lastC = bars[N - 1].close;
    /** @type {import('../primitives/marks.js').Mark[]} */
    const m = [];

    // 1) CURVE — a quadratic bezier from swing low to swing high, sampled as a 48-point polyline.
    //    The engine has no curves; the author makes one out of data.
    {
      const x0 = loT, y0 = loV, x2 = hiT, y2 = hiV;
      const cx = (x0 + x2) / 2, cy = Math.max(hiV, loV) + (hiV - loV) * 0.55;
      /** @type {import('../primitives/marks.js').Vertex[]} */
      const pts = [];
      for (let k = 0; k <= 48; k++) { const t = k / 48, mt = 1 - t;
        pts.push({ t: mt * mt * x0 + 2 * mt * t * cx + t * t * x2, p: mt * mt * y0 + 2 * mt * t * cy + t * t * y2 }); }
      m.push({ path: pts, stroke: '#e0a030', width: 2, dash: 'dashed' });
    }

    // 2) RING — 40 points on a circle of FIXED PIXEL radius around the last price (no "circle" type,
    //    and it stays the same size at any zoom because the radius is in pixels).
    {
      const r = 20, pts = /** @type {import('../primitives/marks.js').Vertex[]} */ ([]);
      for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push({ t: lastT, p: lastC, dx: r * Math.cos(a), dy: r * Math.sin(a) }); }
      m.push({ path: pts, closed: true, stroke: '#4dd0e1', width: 1.5, fill: 'rgba(77,208,225,0.10)' });
    }

    // 3) ARROW — a data-anchored shaft to the swing high with a pixel-sized arrowhead oriented along it.
    {
      const dx = 48, dy = 46;                                  // tail offset from the tip, in pixels
      m.push({ path: [{ t: hiT, p: hiV, dx, dy }, { t: hiT, p: hiV }], stroke: '#ef5350', width: 2 });
      const L = Math.hypot(dx, dy), ux = -dx / L, uy = -dy / L, px = -uy, py = ux, hl = 13, hw = 5.5;
      m.push({ closed: true, fill: '#ef5350', path: [
        { t: hiT, p: hiV },
        { t: hiT, p: hiV, dx: -ux * hl + px * hw, dy: -uy * hl + py * hw },
        { t: hiT, p: hiV, dx: -ux * hl - px * hw, dy: -uy * hl - py * hw },
      ] });
      m.push({ text: 'swing high', at: { t: hiT, p: hiV, dx: 52, dy: 50 }, color: '#ef5350', size: 11 });
    }

    // 4) MEASURED MOVE — a bracket pinned near the right edge (viewport-x) spanning low..high, with
    //    pixel ticks and a ROTATED percent label. A real annotation tool, composed.
    {
      const pct = (((hiV - loV) / loV) * 100).toFixed(2) + '%';
      m.push({ path: [{ vpx: 1, p: hiV, dx: -40 }, { vpx: 1, p: loV, dx: -40 }], stroke: '#9598a1', width: 1 });
      m.push({ path: [{ vpx: 1, p: hiV, dx: -48 }, { vpx: 1, p: hiV, dx: -32 }], stroke: '#9598a1', width: 1 });
      m.push({ path: [{ vpx: 1, p: loV, dx: -48 }, { vpx: 1, p: loV, dx: -32 }], stroke: '#9598a1', width: 1 });
      m.push({ text: pct, at: { vpx: 1, p: (hiV + loV) / 2, dx: -52 }, color: '#cfd3da', size: 12, align: 'center', baseline: 'bottom', rotate: -Math.PI / 2 });
    }

    // 5) HATCHED ZONE — a dashed box over a consolidation region, filled with a diagonal hatch PATTERN
    //    built from ~17 line marks. There is no "hatch" or "pattern" type; the author draws the lines.
    {
      const zA = start + Math.floor(R * 0.12), zB = start + Math.floor(R * 0.34);
      let zTop = -Infinity, zBot = Infinity;
      for (let i = zA; i <= zB; i++) { if (bars[i].high > zTop) zTop = bars[i].high; if (bars[i].low < zBot) zBot = bars[i].low; }
      const zF = bars[zA].time, zT = bars[zB].time, span = zT - zF;
      m.push({ closed: true, dash: 'dashed', stroke: 'rgba(150,152,161,0.7)', width: 1,
        path: [{ t: zF, p: zTop }, { t: zT, p: zTop }, { t: zT, p: zBot }, { t: zF, p: zBot }] });
      const M = 17;
      for (let k = 0; k <= M; k++) { const u = k / M, ub = Math.max(0, Math.min(1, u - 0.3));
        m.push({ path: [{ t: zF + u * span, p: zTop }, { t: zF + ub * span, p: zBot }], stroke: 'rgba(150,152,161,0.20)', width: 1 }); }
      m.push({ text: 'consolidation', at: { t: zF, p: zTop, dx: 4, dy: -14 }, color: 'rgba(150,152,161,0.9)', size: 11 });
    }

    return {
      plots: [{ key: 'sma', name: 'SMA 20', type: 'line', color: 'rgba(120,123,134,0.5)', lineWidth: 1, data: sma }],
      shapes: [{ marks: m }],
    };
  },
});
