// @ts-check
// Session Marker. Marks up to six
// trading sessions per day (each a session-time string in a chosen UTC offset) over the last N
// trading days, drawing the session's price range as a Box, a full-height Band, or Top & Bottom
// lines, with optional labels (name / close / range in pips / ticks / points). The trading-day
// boundary is set by a Day Start time + timezone. Built on the study `shapes` channel (box / band /
// label + raw marks) -- the same machinery as the Time marker study. Profile presets are omitted.
//
// UI: one tab per section -- Quick (enable + name), Display (days / day-start / tick size), then
// S1..S6 (each session's full settings), so the panel stays condensed and manageable.

// ---- option lists ----
const VIZ =[{ key: 'Boxes', name: 'Boxes' }, { key: 'Bands', name: 'Bands' }, { key: 'Top & Bottom', name: 'T & B' }];
const STYLES = [{ key: 'solid', name: 'Solid' }, { key: 'dashed', name: 'Dashed' }, { key: 'dotted', name: 'Dotted' }];
const POS = [{ key: 'Above', name: 'Above' }, { key: 'Below', name: 'Below' }];
const ALIGN = [{ key: 'Center', name: 'Center' }, { key: 'Left', name: 'Left' }, { key: 'Right', name: 'Right' }];
const LAYOUT = [{ key: 'Layout 1', name: 'Layout 1' }, { key: 'Layout 2', name: 'Layout 2' }];

const SDEF = [
  { name: 'London Open',  session: '0100-0500', color: '#9c27b0', on: true },
  { name: 'New York',     session: '0700-1000', color: '#2962ff', on: true },
  { name: 'London Close', session: '1000-1200', color: '#ef5350', on: true },
  { name: 'CBDR',         session: '1400-2000', color: '#26a69a', on: true },
  { name: 'Asia',         session: '2000-0000', color: '#ff9800', on: true },
  { name: 'Custom',       session: '2030-0300', color: '#ffeb3b', on: false },
];

// ---- helpers ----
/** @param {string} col @param {number} a */
function withAlpha(col, a) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(col || '').trim());
  if (hex) { const n = parseInt(hex[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  return col || `rgba(120,120,120,${a})`;
}
/** @param {string|number} tz */
const tzOff = (tz) => { if (typeof tz === 'number') return tz * 3600; const m = /^UTC([+-]\d+)?$/.exec(String(tz || 'UTC').trim()); return m && m[1] ? parseInt(m[1], 10) * 3600 : 0; };
/** @param {string} s */
const parseSession = (s) => { const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(String(s || '').trim()); return m ? { start: (+m[1]) * 3600 + (+m[2]) * 60, end: (+m[3]) * 3600 + (+m[4]) * 60 } : null; };

// ---- inputs (Quick / Display / S1..S6) ----
/** @type {StudyInput[]} */
const inputs = [];
// Quick: each session's enable toggle, labeled with its name (the name is defined per session in the
// S-tabs) -- e.g. "Session 1: New York". One toggle per row.
SDEF.forEach((d, i) => {
  const n = i + 1;
  inputs.push(
    // `name` here is a dynamic-label callback (the panel calls it with the live params) -- wider than
    // StudyInput.name's declared `string`, so cast the callback for this one field.
    { key: `en${n}`, type: 'bool', default: d.on, tab: 'Quick',
      name: /** @type {any} */ ((/** @type {Record<string, any>} */ p) => p[`name${n}`] ? `Session ${n}: ${p[`name${n}`]}` : `Session ${n}`) },
  );
});
// Display
inputs.push(
  { key: 'daysToShow', type: 'number', name: 'Days to show', default: 3, min: 0, max: 60, tab: 'Display' },
  { key: 'dayStart', type: 'text', name: 'Day start time', default: '1700', placeholder: 'HHMM', tab: 'Display' },
  { key: 'dayStartTz', type: 'tz', name: 'Day start timezone', default: -4, tab: 'Display' },
  { key: 'tickSize', type: 'number', name: 'Tick size (0 = auto)', default: 0, min: 0, step: 0.0001, tab: 'Display' },
);
// S1..S6 -- one tab per session, condensed with inline groups + live conditionals (grey the bg swatch
// when Background is off; grey label options when Show labels is off; grey the Border stroke for Bands).
SDEF.forEach((d, i) => {
  const n = i + 1, tab = `S${n}`;
  const notBands = (/** @type {Record<string, any>} */ P) => P[`viz${n}`] !== 'Bands', labOn = `showlab${n}`;
  inputs.push(
    // Session name -- defined per session here; the Quick tab shows it in the toggle ("Session 1: New York")
    { key: `name${n}`, type: 'text', name: 'Session name', default: d.name, width: 150, tab, inline: `nm${n}` },
    // Row 1 -- Display | Border | Bkgnd [x] [swatch]. Border is a stroke swatch (colour + width +
    // style; bstyle/bwidth are hidden siblings), greyed for Bands (a band has no border line).
    { key: `viz${n}`, type: 'select', name: 'Display', options: VIZ, default: 'Top & Bottom', tab, inline: `col${n}` },
    { key: `border${n}`, type: 'color', name: 'Border', default: d.color, tab, inline: `col${n}`, enableWhen: notBands, stroke: { width: `bwidth${n}`, lineStyle: `bstyle${n}` } },
    { key: `showbg${n}`, type: 'bool', name: 'Bkgnd', default: true, tab, inline: `col${n}` },
    { key: `bg${n}`, type: 'color', name: '', noLabel: true, default: withAlpha(d.color, 0.15), tab, inline: `col${n}`, enableWhen: `showbg${n}` },
    { key: `bstyle${n}`, type: 'select', options: STYLES, default: 'solid', hidden: true },
    { key: `bwidth${n}`, type: 'number', default: 2, min: 1, max: 4, hidden: true },
    // Session [HHMM-HHMM]  TZ [-4]
    { key: `session${n}`, type: 'text', name: 'Session', default: d.session, placeholder: 'HHMM-HHMM', width: 84, tab, inline: `sess${n}` },
    { key: `tz${n}`, type: 'tz', name: 'TZ', default: -4, tab, inline: `sess${n}` },
    // Labels: [x] Show labels (master toggle, never greyed) + the Label text swatch (colour + size +
    // bold + italic; lsize/lbold/litalic hidden siblings). Label swatch greyed when labels are off.
    { key: labOn, type: 'bool', name: 'Show labels', default: true, tab, inline: `lbl${n}` },
    { key: `labelc${n}`, type: 'color', name: 'Label', default: d.color, tab, inline: `lbl${n}`, enableWhen: labOn, text: { size: `lsize${n}`, bold: `lbold${n}`, italic: `litalic${n}` } },
    { key: `lsize${n}`, type: 'number', default: 12, hidden: true },
    { key: `lbold${n}`, type: 'bool', default: false, hidden: true },
    { key: `litalic${n}`, type: 'bool', default: false, hidden: true },
    // which fields the label shows -- greyed when Show labels is off
    { key: `shname${n}`, type: 'bool', name: 'Name', default: false, tab, inline: `sh${n}`, enableWhen: labOn },
    { key: `shprice${n}`, type: 'bool', name: 'Price', default: false, tab, inline: `sh${n}`, enableWhen: labOn },
    { key: `shpips${n}`, type: 'bool', name: 'Pips', default: true, tab, inline: `sh${n}`, enableWhen: labOn },
    { key: `shpoints${n}`, type: 'bool', name: 'Points', default: false, tab, inline: `sh${n}`, enableWhen: labOn },
    // label layout options -- greyed when Show labels is off
    { key: `lpos${n}`, type: 'select', name: 'Position', options: POS, default: 'Above', tab, inline: `lp${n}`, enableWhen: labOn },
    { key: `lalign${n}`, type: 'select', name: 'Align', options: ALIGN, default: 'Center', tab, inline: `lp${n}`, enableWhen: labOn },
    { key: `llayout${n}`, type: 'select', name: 'Layout', options: LAYOUT, default: 'Layout 1', tab, inline: `lp${n}`, enableWhen: labOn },
  );
});

Studies.register({
  id: 'session_marker',
  overlay: true,
  inputs,
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {{ decimals?:number, tickSize?:number }} [ctx]
   */
  calc(bars, p, ctx) {
    /** @type {any[]} */   // heterogeneous host-render shapes (band/box/label + raw marks) on the study `shapes` channel
    const shapes = [];
    if (!bars || !bars.length) return { plots: [], shapes };
    const now = bars[bars.length - 1].time;   // UTC seconds

    // trading-day boundary: the day-start time in its tz, most recent at/before `now`; cutoff = N days back
    const dsOff = tzOff(p.dayStartTz);
    const dsVal = parseInt(p.dayStart || '1700', 10) || 0;
    const dsTOD = Math.floor(dsVal / 100) * 3600 + (dsVal % 100) * 60;
    let dayStart = Math.floor((now + dsOff) / 86400) * 86400 + dsTOD - dsOff;
    if (dayStart > now) dayStart -= 86400;
    const cutoff = dayStart - Math.max(0, p.daysToShow | 0) * 86400;

    const decimals = (ctx && ctx.decimals != null) ? ctx.decimals : 2;
    const mintick = p.tickSize > 0 ? p.tickSize : Math.pow(10, -decimals);

    for (let n = 1; n <= 6; n++) {
      if (!p[`en${n}`]) continue;
      const ses = parseSession(p[`session${n}`]); if (!ses) continue;
      const off = tzOff(p[`tz${n}`]);
      const viz = p[`viz${n}`] || 'Top & Bottom';
      const bcol = p[`border${n}`] || '#787b86', lcol = p[`labelc${n}`] || bcol;
      const showBg = p[`showbg${n}`] !== false, bg = p[`bg${n}`];
      const dash = p[`bstyle${n}`] || 'solid', bw = (p[`bwidth${n}`] | 0) || 2;
      /** @param {number} t */
      const inSes = (t) => { const x = ((t + off) % 86400 + 86400) % 86400; return ses.start <= ses.end ? (x >= ses.start && x < ses.end) : (x >= ses.start || x < ses.end); };

      /** @param {{ start:number, end:number, o:number, h:number, l:number, c:number }} r */
      const emit = (r) => {
        if (r.start < cutoff) return;   // only the last N trading days
        const from = r.start, to = r.end, hi = r.h, lo = r.l;
        if (viz === 'Bands') {
          shapes.push({ type: 'band', from, to, color: showBg ? bg : 'rgba(0,0,0,0)' });
        } else if (viz === 'Boxes') {
          shapes.push({ type: 'box', from, to, top: hi, bottom: lo, color: showBg ? bg : null, borderColor: bcol, borderWidth: bw, lineStyle: dash });
        } else {   // Top & Bottom: bg box (no border) + a line at the high and the low
          if (showBg) shapes.push({ type: 'box', from, to, top: hi, bottom: lo, color: bg, borderColor: null, borderWidth: 0 });
          shapes.push({ marks: [
            { stroke: bcol, width: bw, dash, path: [{ t: from, p: hi }, { t: to, p: hi }] },
            { stroke: bcol, width: bw, dash, path: [{ t: from, p: lo }, { t: to, p: lo }] },
          ] });
        }
        // label
        if (p[`showlab${n}`] === false) return;
        const range = hi - lo, cl = [];
        if (p[`shpips${n}`]) cl.push((range / mintick / 10).toFixed(1) + ' pip');
        if (p[`shpoints${n}`]) cl.push(range.toFixed(decimals) + ' pt');   // a point = 1.0 price unit, so just the price move (tick-size independent)
        const changeLine = cl.join('\n');
        const lines = [];
        const nm = p[`name${n}`] || '', priceStr = Number(r.c).toFixed(decimals);
        if ((p[`llayout${n}`] || 'Layout 1') === 'Layout 1') {
          if (p[`shname${n}`]) lines.push(nm);
          if (p[`shprice${n}`]) lines.push(priceStr);
          if (changeLine) lines.push(changeLine);
        } else {
          let first = p[`shname${n}`] ? nm : '';
          if (changeLine) first += (first ? ' ' : '') + changeLine.replace(/\n/g, ' ');
          if (first) lines.push(first);
          if (p[`shprice${n}`]) lines.push(priceStr);
        }
        const txt = lines.join('\n');
        if (!txt) return;
        const align = p[`lalign${n}`] || 'Center', pos = p[`lpos${n}`] || 'Above';
        const lx = align === 'Left' ? from : align === 'Right' ? to : Math.round((from + to) / 2);
        // lsize is now a numeric px (from the Label text swatch); tolerate the legacy 'Normal'/'Small'.
        const lsz = typeof p[`lsize${n}`] === 'number' ? p[`lsize${n}`] : (p[`lsize${n}`] === 'Small' ? 10 : 12);
        shapes.push({
          type: 'label', time: lx, price: pos === 'Above' ? hi : lo, text: txt, color: lcol,
          hAlign: align === 'Left' ? 'left' : align === 'Right' ? 'right' : 'center',
          vAlign: pos === 'Above' ? 'bottom' : 'top', size: lsz,
          bold: p[`lbold${n}`], italic: p[`litalic${n}`],
        });
      };

      // walk bars, collecting each contiguous in-session run into one session instance
      /** @type {{ start:number, end:number, o:number, h:number, l:number, c:number }|null} */
      let cur = null;
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i], t = b.time;
        if (inSes(t)) {
          if (!cur) cur = { start: t, end: t, o: b.open, h: b.high, l: b.low, c: b.close };
          else { cur.end = t; cur.c = b.close; if (b.high > cur.h) cur.h = b.high; if (b.low < cur.l) cur.l = b.low; }
        } else if (cur) { emit(cur); cur = null; }
      }
      if (cur) emit(cur);   // session still forming at the last bar (current session)
    }
    return { plots: [], shapes };
  },
});

// Loaded via dynamic import() (an ES module at runtime); the empty export gives this file its own
// module scope so its top-level const helpers don't collide with sibling study modules' globals.
export {};
