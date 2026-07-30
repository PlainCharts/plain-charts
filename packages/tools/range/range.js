// @ts-check
// Measurement tools — one 2-point box that reports how far you dragged. Three variants
// share the same draw helper:
//   priceRange      — price delta + %            (vertical measure)
//   dateRange       — bar count + duration       (horizontal measure)
//   priceTimeRange  — both                        (date + price range)
// Neutral styling: one Line colour (boundaries + connector arrow + value
// pill) plus an optional translucent Background fill.

// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, … are ambiently typed in tools-global.d.ts.)

/** @type {Record<string, string>} */
const STAT_NAMES = {
  price: 'Price range',
  percent: 'Percent change',
  pips: 'Change in pips',
  bars: 'Bars range',
  time: 'Date/time range',
};

// The three variants (makeRange is a hoisted function declaration, defined below).
Tools.register(makeRange({ id: 'priceRange', glyph: '↕', price: true, time: false }));
Tools.register(makeRange({ id: 'dateRange', glyph: '↔', price: false, time: true }));
Tools.register(makeRange({ id: 'priceTimeRange', glyph: '⤢', price: true, time: true }));

// ---------------------------------------------------------------- factory + helpers
// build one measurement tool with the given price/time flags
/** @param {{ id:string, name:string, glyph:string, price:boolean, time:boolean, description?:string, icon?:string }} cfg */
function makeRange({ id, name, glyph, price, time, description, icon }) {
  // which stats this variant can report (price axis vs time axis), and the default set
  /** @type {string[]} */
  const keys = [];
  if (price) keys.push('price', 'percent', 'pips');
  if (time) keys.push('bars', 'time');
  const statsOptions = keys.map((k) => ({ key: k, name: STAT_NAMES[k] }));
  const statsDefault = price && time ? ['price', 'bars', 'time'] : price ? ['price'] : ['bars', 'time'];

  return {
    id,
    name,
    glyph,
    description,
    icon,
    kind: 'draw',
    points: 2,
    defaultStyle: {
      color: '#787b86',
      width: 1,
      lineStyle: 'solid',
      fillOn: true,
      fill: 'rgba(41,98,255,0.12)',
      stats: statsDefault,
      labelColor: '#ffffff',
      labelSize: 12,
      labelBold: false,
      labelItalic: false,
      labelBgOn: false,
      labelBg: '#1e222d',
      measureMethod: 'standard',
    },
    settings: {
      style: [
        {
          name: 'Measure method',
          controls: [
            {
              key: 'measureMethod',
              type: 'select',
              options: [
                { key: 'standard', name: 'Standard (label + arrow)' },
                { key: 'conventional', name: 'Conventional (centred value)' },
              ],
            },
          ],
        },
        { name: 'Stats', controls: [{ key: 'stats', type: 'multiselect', options: statsOptions }] },
        {
          fields: [
            { name: 'Line', key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' },
            { name: 'Background', toggle: 'fillOn', toggleDefault: true, key: 'fill', type: 'color' },
          ],
        },
        {
          fields: [
            {
              name: 'Label',
              key: 'labelColor',
              type: 'color',
              size: 'labelSize',
              bold: 'labelBold',
              italic: 'labelItalic',
            },
            { name: 'Background', toggle: 'labelBgOn', key: 'labelBg', type: 'color' },
          ],
        },
      ],
      // free text typed onto the measurement (centred on the connector)
      text: {
        defaults: { vAlign: 'middle', hAlign: 'center' },
        vAlign: [
          { key: 'top', name: 'Top' },
          { key: 'middle', name: 'Middle' },
          { key: 'bottom', name: 'Bottom' },
        ],
        hAlign: [
          { key: 'left', name: 'Left' },
          { key: 'center', name: 'Center' },
          { key: 'right', name: 'Right' },
        ],
      },
    },

    // Declarative: the measured region's fill, boundary lines, the centre connector + arrow (breaking
    // around the user's label), and the stats pill — all computed in screen space and emitted as marks
    // (absolute-screen vertices). The editable label itself is rendered by the generic drawText.
    /** @param {ToolDrawing} d @param {ToolView} view */
    marks(d, view) {
      const P = d.points || [];
      if (P.length < 2) return [];
      // range carries many bespoke style fields (stats/labelBg/measureMethod/fill/…) that the shared
      // ToolStyle types as `unknown`; treat the bag as any so those reads stay legible.
      const s = /** @type {any} */ (d.style || {});
      const P1 = P[0],
        P2 = P[1];
      const x1 = view.timeToX(P1.time),
        y1 = view.priceToY(P1.price);
      const x2 = view.timeToX(P2.time),
        y2 = view.priceToY(P2.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
      const xm = (x1 + x2) / 2,
        ym = (y1 + y2) / 2,
        color = s.color || '#787b86',
        bw = s.width || 1;
      /** @param {number} x @param {number} y */
      const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
      /** @type {any[]} */
      const out = [];

      if (s.fillOn !== false) {
        const xa = Math.min(x1, x2),
          xb = Math.max(x1, x2),
          ya = Math.min(y1, y2),
          yb = Math.max(y1, y2);
        out.push({
          closed: true,
          fill: s.fill || 'rgba(41,98,255,0.12)',
          path: [sv(xa, ya), sv(xb, ya), sv(xb, yb), sv(xa, yb)],
        });
      }
      // boundary lines (dashed per lineStyle): vertical for time ends, horizontal for price ends
      const bdash = Tools.dash(s.lineStyle);
      /** @param {any} a @param {any} b */
      const bline = (a, b) => ({ path: [a, b], stroke: color, width: bw, dash: bdash });
      if (time) {
        out.push(bline(sv(x1, y1), sv(x1, y2)));
        out.push(bline(sv(x2, y1), sv(x2, y2)));
      }
      if (price) {
        out.push(bline(sv(x1, y1), sv(x2, y1)));
        out.push(bline(sv(x1, y2), sv(x2, y2)));
      }

      // ---- measured values (shown as the label / centred value) ----
      const dec = view.priceDecimals != null ? view.priceDecimals : 2;
      // a pip is the 2nd-to-last digit on a fractional-pip feed (5-dec FX, 3-dec JPY): 10^(dec-1),
      // NOT 10^dec (that counts pipettes -- e.g. a 0.00046 move is 4.6 pips, not 46).
      const dP = P2.price - P1.price,
        pct = P1.price ? (P2.price / P1.price - 1) * 100 : 0,
        pips = dP * Math.pow(10, Math.max(0, dec - 1));
      const times = (view.bars || []).map((b) => b.time);
      const bars = times.length >= 2 ? Math.round(fracIndex(times, P2.time) - fracIndex(times, P1.time)) : 0;
      /** @param {string} k */
      const has = (k) => Array.isArray(s.stats) && s.stats.includes(k);
      const priceSeg = [
        has('price') && dP.toFixed(dec),
        has('percent') && `(${pct.toFixed(2)}%)`,
        has('pips') && `${pips.toFixed(1)} pip`,
      ]
        .filter(Boolean)
        .join(' ');
      const timeSeg = [has('bars') && `${bars} bars`, has('time') && dur(P2.time - P1.time)].filter(Boolean).join(', ');
      const lines = [priceSeg, timeSeg].filter(Boolean);
      const fsize = parseInt(s.labelSize, 10) || 12;

      const G = 6;
      /** @param {any} a @param {any} b */
      const conn = (a, b) => ({ path: [a, b], stroke: color, width: bw }); // solid connector

      // Conventional (AutoCAD-style) dimension: arrowheads at BOTH ends of the connector, and the measured
      // value centred ON the line (breaking it) instead of the single end-arrow + separate label/pill. The
      // value takes the place of the free-text label, so this method carries no user text.
      if (s.measureMethod === 'conventional') {
        // a measuring tool goes A -> B: show the ABSOLUTE distance (no +/- sign, no reference direction).
        const aPriceSeg = [
          has('price') && Math.abs(dP).toFixed(dec),
          has('percent') && `(${Math.abs(pct).toFixed(2)}%)`,
          has('pips') && `${Math.abs(pips).toFixed(1)} pip`,
        ]
          .filter(Boolean)
          .join(' ');
        const aTimeSeg = [has('bars') && `${Math.abs(bars)} bars`, has('time') && dur(Math.abs(P2.time - P1.time))]
          .filter(Boolean)
          .join(', ');
        const valStr = [aPriceSeg, aTimeSeg].filter(Boolean).join('   ');
        const mc = measureCtx();
        mc.font = (s.labelItalic ? 'italic ' : '') + (s.labelBold ? 'bold ' : '') + fsize + 'px sans-serif';
        const tw = valStr ? mc.measureText(valStr).width : 0,
          th = fsize;
        // a price-only measure is a VERTICAL line: rotate the value to read ALONG it (AutoCAD-style).
        const rot = price && !time ? -Math.PI / 2 : 0;
        /** @param {any[]} path */
        const arrow = (path) => out.push({ path, stroke: color, width: bw });
        /** @param {number} cx @param {number} cy */
        const valMark = (cx, cy) => {
          if (!valStr) return;
          const hw = (rot ? th : tw) / 2 + 4,
            hh = (rot ? tw : th) / 2 + 3; // (rotated) text footprint half-extents
          if (s.labelBgOn)
            out.push({
              closed: true,
              fill: s.labelBg || '#1e222d',
              path: [sv(cx - hw, cy - hh), sv(cx + hw, cy - hh), sv(cx + hw, cy + hh), sv(cx - hw, cy + hh)],
            });
          out.push({
            text: valStr,
            at: sv(cx, cy),
            align: 'center',
            baseline: 'middle',
            color: s.labelColor || '#ffffff',
            size: fsize,
            bold: !!s.labelBold,
            italic: !!s.labelItalic,
            rotate: rot || undefined,
          });
        };
        // The dimension line sits at the DRAGGED-TO edge (P2), AutoCAD-style: the boundary/witness lines drawn
        // above run from the measured points out to it. The value is carried on the horizontal line if this
        // measures time, else on the vertical (price) line.
        if (time) {
          // horizontal dimension line at y2; value breaks it (centred on the span)
          const lo = Math.min(x1, x2),
            hi = Math.max(x1, x2),
            g0 = xm - tw / 2 - G,
            g1 = xm + tw / 2 + G;
          if (valStr && g1 > lo && g0 < hi) {
            if (g0 > lo) out.push(conn(sv(lo, y2), sv(g0, y2)));
            if (g1 < hi) out.push(conn(sv(g1, y2), sv(hi, y2)));
          } else out.push(conn(sv(lo, y2), sv(hi, y2)));
          arrow([sv(lo + 7, y2 - 4), sv(lo, y2), sv(lo + 7, y2 + 4)]);
          arrow([sv(hi - 7, y2 - 4), sv(hi, y2), sv(hi - 7, y2 + 4)]);
        }
        if (price) {
          // vertical dimension line at x2; when this measures price-only, the value breaks it
          const ext = rot ? tw : th,
            carries = !time; // value's extent along the line; price-only carries it
          const lo = Math.min(y1, y2),
            hi = Math.max(y1, y2),
            g0 = ym - ext / 2 - G,
            g1 = ym + ext / 2 + G;
          if (carries && valStr && g1 > lo && g0 < hi) {
            if (g0 > lo) out.push(conn(sv(x2, lo), sv(x2, g0)));
            if (g1 < hi) out.push(conn(sv(x2, g1), sv(x2, hi)));
          } else out.push(conn(sv(x2, lo), sv(x2, hi)));
          arrow([sv(x2 - 4, lo + 7), sv(x2, lo), sv(x2 + 4, lo + 7)]);
          arrow([sv(x2 - 4, hi - 7), sv(x2, hi), sv(x2 + 4, hi - 7)]);
        }
        valMark(time ? xm : x2, time ? y2 : ym);
        return out;
      }

      // ---- Standard method: single end-arrow + label/pill, connector breaking around the user's text ----
      // the user's label screen rect (mirrors generic drawText), so the connector breaks around it
      /** @type {{ left:number, right:number, top:number, bottom:number }|null} */
      let trect = null;
      if (d.text) {
        const ts = d.textStyle || {},
          tsize = ts.size || 14,
          tpad = 5,
          tha = ts.hAlign || 'center',
          tva = ts.vAlign || 'middle';
        const tl = String(d.text).split('\n'),
          tlh = tsize * 1.25;
        const mc = measureCtx();
        mc.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + tsize + 'px sans-serif';
        const tw = Math.max(...tl.map((l) => mc.measureText(l).width)),
          tH = tsize + (tl.length - 1) * tlh;
        const bx1 = Math.min(x1, x2),
          bx2 = Math.max(x1, x2),
          by1 = Math.min(y1, y2),
          by2 = Math.max(y1, y2);
        const ax = tha === 'left' ? bx1 + tpad : tha === 'right' ? bx2 - tpad : (bx1 + bx2) / 2;
        const left = tha === 'left' ? ax : tha === 'right' ? ax - tw : ax - tw / 2;
        const top = tva === 'top' ? by1 - tpad - tH : tva === 'bottom' ? by2 + tpad : (by1 + by2) / 2 - tH / 2;
        trect = { left, right: left + tw, top, bottom: top + tH };
      }

      if (time) {
        const gap = trect && ym >= trect.top - G && ym <= trect.bottom + G ? [trect.left - G, trect.right + G] : null;
        const lo = Math.min(x1, x2),
          hi = Math.max(x1, x2);
        if (gap && gap[1] > lo && gap[0] < hi) {
          if (gap[0] > lo) out.push(conn(sv(lo, ym), sv(gap[0], ym)));
          if (gap[1] < hi) out.push(conn(sv(gap[1], ym), sv(hi, ym)));
        } else out.push(conn(sv(lo, ym), sv(hi, ym)));
        const sx = Math.sign(x2 - x1) || 1;
        out.push({ path: [sv(x2 - 6 * sx, ym - 4), sv(x2, ym), sv(x2 - 6 * sx, ym + 4)], stroke: color, width: bw });
      }
      if (price) {
        const gap = trect && xm >= trect.left - G && xm <= trect.right + G ? [trect.top - G, trect.bottom + G] : null;
        const lo = Math.min(y1, y2),
          hi = Math.max(y1, y2);
        if (gap && gap[1] > lo && gap[0] < hi) {
          if (gap[0] > lo) out.push(conn(sv(xm, lo), sv(xm, gap[0])));
          if (gap[1] < hi) out.push(conn(sv(xm, gap[1]), sv(xm, hi)));
        } else out.push(conn(sv(xm, lo), sv(xm, hi)));
        const sy = Math.sign(y2 - y1) || 1;
        out.push({ path: [sv(xm - 4, y2 - 6 * sy), sv(xm, y2), sv(xm + 4, y2 - 6 * sy)], stroke: color, width: bw });
      }

      // value pill near the p2 end — checked stats on one/two lines
      if (lines.length) {
        const mc = measureCtx();
        mc.font = (s.labelItalic ? 'italic ' : '') + (s.labelBold ? 'bold ' : '') + fsize + 'px sans-serif';
        const padX = 8,
          lh = Math.round(fsize * 1.33),
          w = Math.max(40, ...lines.map((t) => mc.measureText(t).width + padX * 2)),
          h = lh * lines.length + 8;
        const ly = y2 >= y1 ? y2 + 8 : y2 - 8 - h;
        if (s.labelBgOn)
          out.push({
            closed: true,
            fill: s.labelBg || '#1e222d',
            path: [sv(xm - w / 2, ly), sv(xm + w / 2, ly), sv(xm + w / 2, ly + h), sv(xm - w / 2, ly + h)],
          });
        lines.forEach((t, i) =>
          out.push({
            text: t,
            at: sv(xm, ly + 4 + lh / 2 + i * lh),
            align: 'center',
            baseline: 'middle',
            color: s.labelColor || '#ffffff',
            size: fsize,
            bold: !!s.labelBold,
            italic: !!s.labelItalic,
          }),
        );
      }
      return out;
    },

    // The conventional method has no free-text label -- the measured value takes its place, centred on the
    // line -- so the engine suppresses the "+ Add text" placeholder, in-place editing and the Text tab for it.
    /** @param {ToolDrawing} [d] */
    textEnabled: (d) => !(d && d.style && d.style.measureMethod === 'conventional'),

    /** @param {ToolScreenPoint[]} pts @param {number} x @param {number} y @param {number} tol */
    hitTest(pts, x, y, tol) {
      if (pts.length < 2) return null;
      for (let i = 0; i < pts.length; i++)
        if (Tools.geom.dist(x, y, pts[i].x, pts[i].y) <= tol + 3) return { part: 'point', index: i };
      if (Tools.geom.pointInRect(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y)) return { part: 'body' };
      return null;
    },
  };
}

// fractional logical index of a time against the bar-time array (interp/extrapolated),
// mirroring engine geometry — lets us count bars even past the last candle.
/** @param {number[]} times @param {number} t */
function fracIndex(times, t) {
  const n = times.length;
  if (n < 2) return 0;
  if (t <= times[0]) {
    const s = times[1] - times[0];
    return s > 0 ? (t - times[0]) / s : 0;
  }
  if (t >= times[n - 1]) {
    const s = times[n - 1] - times[n - 2];
    return n - 1 + (s > 0 ? (t - times[n - 1]) / s : 0);
  }
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m;
  }
  const s = times[hi] - times[lo];
  return lo + (s > 0 ? (t - times[lo]) / s : 0);
}

// seconds -> "1D 12h" (top two non-zero units, signed)
/** @param {number} sec */
function dur(sec) {
  const sign = sec < 0 ? '-' : '';
  let abs = Math.abs(Math.round(sec));
  /** @type {[string, number][]} */
  const units = [
    ['Y', 31536000],
    ['M', 2592000],
    ['W', 604800],
    ['D', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  /** @type {string[]} */
  const parts = [];
  for (const [label, size] of units) {
    const v = Math.floor(abs / size);
    if (v > 0) {
      parts.push(v + label);
      abs -= v * size;
    }
    if (parts.length === 2) break;
  }
  if (!parts.length) parts.push('0s');
  return sign + parts.join(' ');
}

/** @type {CanvasRenderingContext2D|null} */
let _mctx = null; // offscreen ctx to measure the label + pill text
const measureCtx = () =>
  _mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d')));

// Loaded via dynamic import() (an ES module at runtime); the empty export marks it a module for the
// checker too, giving it its own scope (no clash with sibling globals). No-op.
export {};
