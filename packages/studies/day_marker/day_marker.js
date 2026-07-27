// @ts-check
// Day Marker -- vanilla port of the Algoryze "Day Marker" (Day/Week Separator) indicator, built brick
// by brick. FOUNDATION LAYER: the trading-day boundary engine + DAY and WEEK separators. Everything the
// full indicator layers on later (weekly/monthly H/L, opening prices, MTW highlighter, AWR table, day
// labels) hangs off this same boundary, so we nail it first.
//
// The boundary is a single Day/Week Start Time in a chosen UTC offset (DST-naive, like the original).
// A separator is a full-height vline at each trading-day start across the visible window, plus a
// forward projection of the next few weeks. The boundary whose calendar weekday equals the week-start
// day is re-styled as the WEEKLY line (it wins over the day line there -- one line, as in the original).
// Weekend opens carry no session, so they are skipped. Reuses the vline shape + future-projection
// machinery already proven in time_marker.
//
// UI tabs -- Display (the shared essentials every later feature reads), Separator (the Day / Week
// on-off toggles each with one stroke swatch, plus a Labels section: a pane-edge strip of day letters
// positioned within the session and pinned to the pane top or bottom), H/L (Daily high/low triangle
// markers + Weekly high/low lines spanning each week), and Open (daily opening-price line).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];   // index = day-of-week num (0=Sun)
const STYLES = [{ key: 'solid', name: 'Solid' }, { key: 'dashed', name: 'Dashed' }, { key: 'dotted', name: 'Dotted' }];
const HPOS = [{ key: 'Left', name: 'Left' }, { key: 'Center', name: 'Center' }, { key: 'Right', name: 'Right' }];
const VPOS = [{ key: 'Top', name: 'Top' }, { key: 'Bottom', name: 'Bottom' }];
// day letter by the OWNED trading weekday (the session's identity): Mon=1 .. Fri=5
const LETTERS = ['', 'M', 'T', 'W', 'T', 'F'];
const AWR_UNITS = [{ key: 'Pips', name: 'Pips' }, { key: 'Points', name: 'Points' }, { key: 'Ticks', name: 'Ticks' }];
const AWR_POS = ['Top Left', 'Top Center', 'Top Right', 'Middle Left', 'Middle Center', 'Middle Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'].map((s) => ({ key: s, name: s }));

/** @type {StudyInput[]} */
const inputs = [
  // --- Toggles: the FIRST tab -- feature-bearing quick switches (added one at a time). ---
  // Day / Week separators on/off. Their colour + width + style live in the Separator tab.
  { key: 'enableDay', type: 'bool', name: 'Day Separator', default: true, tab: 'Toggles' },
  { key: 'enableWeek', type: 'bool', name: 'Week Separator', default: true, tab: 'Toggles' },
  // Day-letter labels (M T W T F) on/off. Their look + position live in the Separator tab's Labels group.
  { key: 'enableLabels', type: 'bool', name: 'Day Labels', default: true, tab: 'Toggles' },
  // Daily / Weekly H/L levels on/off. Their settings (days/weeks, timezone, colours) live in the H/L tab.
  // "Whole Range" makes the H/L span the SAME window as the separators (the weeks/days chosen in Display),
  // overriding the H/L tab's own smaller day/week count -- so a 4-week chart fills all 4 weeks with H/L.
  { key: 'enableHL', type: 'bool', name: 'Daily H/L', default: true, tab: 'Toggles' },
  { key: 'hlWholeRange', type: 'bool', name: 'Daily H/L - Whole Range', default: false, tab: 'Toggles' },
  { key: 'enableWkHL', type: 'bool', name: 'Weekly H/L', default: true, tab: 'Toggles' },
  { key: 'wkWholeRange', type: 'bool', name: 'Weekly H/L - Whole Range', default: false, tab: 'Toggles' },
  // Hide Mitigated H/L: drop a daily/weekly high once a later bar trades above it (a low once one trades
  // below), leaving only levels price has not yet revisited.
  { key: 'hideMitigatedHL', type: 'bool', name: 'Hide Mitigated H/L', default: false, tab: 'Toggles' },
  // Weekly Range (AWR) panel on/off. Its settings (unit / weeks / position) live in the Range tab.
  { key: 'enableAWR', type: 'bool', name: 'Weekly Range (AWR)', default: false, tab: 'Toggles' },
  // Opening-price lines on/off. Their colour / style / "current only" settings live in the Open tab.
  { key: 'enableDailyOpen', type: 'bool', name: 'Daily Opening Price', default: false, tab: 'Toggles' },
  { key: 'enableWeeklyOpen', type: 'bool', name: 'Weekly Opening Price', default: false, tab: 'Toggles' },

  // --- Display: the essentials every later layer builds on ---
  { key: 'weeksToShow', type: 'number', name: 'Weeks to Show', default: 3, min: 1, max: 52, tab: 'Display' },
  { key: 'futureWeeksToShow', type: 'number', name: 'Future Weeks to Show', default: 1, min: 1, max: 12, tab: 'Display' },
  { key: 'timezone', type: 'tz', name: 'Timezone', default: -4, tab: 'Display' },
  { key: 'startTime', type: 'text', name: 'Day/Week Start Time', default: '1700', placeholder: 'HHMM', tab: 'Display' },
  { key: 'weekStartDay', type: 'select', name: 'Week Start Day', options: WEEKDAYS.map((d) => ({ key: d, name: d })), default: 'Monday', tab: 'Display' },

  // --- Separator: Day / Week line look. The on/off switches live in the Toggles tab; these swatches
  // (colour + width + style) grey out when their separator is off. ---
  { key: 'dayColor', type: 'color', name: 'Day', default: '#787b86', stroke: { width: 'dayWidth', lineStyle: 'dayStyle' }, enableWhen: 'enableDay', tab: 'Separator' },
  { key: 'dayStyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'dayWidth', type: 'number', default: 1, min: 1, max: 10, hidden: true },
  { key: 'weekColor', type: 'color', name: 'Week', default: '#2962ff', stroke: { width: 'weekWidth', lineStyle: 'weekStyle' }, enableWhen: 'enableWeek', tab: 'Separator' },
  { key: 'weekStyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'weekWidth', type: 'number', default: 2, min: 1, max: 10, hidden: true },

  // --- Labels section (same Separator tab): a strip of day letters (M T W T F) pinned to the pane's
  // top or bottom edge. The on/off switch lives in the Toggles tab ("Day Labels"); these settings (colour
  // + text styling, position, placement) grey out when it's off. ---
  { key: 'labelColor', type: 'color', name: 'Label', default: '#787b86', text: { size: 'labelSize', bold: 'labelBold', italic: 'labelItalic' }, enableWhen: 'enableLabels', tab: 'Separator', group: 'Labels' },
  { key: 'labelSize', type: 'number', default: 11, hidden: true },
  { key: 'labelBold', type: 'bool', default: false, hidden: true },
  { key: 'labelItalic', type: 'bool', default: false, hidden: true },
  { key: 'labelHPos', type: 'select', name: 'Position', options: HPOS, default: 'Center', enableWhen: 'enableLabels', tab: 'Separator', group: 'Labels' },
  { key: 'labelVPos', type: 'select', name: 'Placement', options: VPOS, default: 'Bottom', enableWhen: 'enableLabels', tab: 'Separator', group: 'Labels' },

  // --- H/L tab, Daily section. The on/off switch lives in the Toggles tab ("Daily H/L"); these settings
  // grey out when it's off. Its own timezone + day-start (independent of the separator boundary). ---
  { key: 'hlDaysToShow', type: 'number', name: 'Days', default: 3, min: 1, max: 60, width: 48, enableWhen: 'enableHL', tab: 'H/L', group: 'Daily', inline: 'hlDay' },
  { key: 'hlStartTime', type: 'text', name: 'Start', default: '1700', placeholder: 'HHMM', width: 56, enableWhen: 'enableHL', tab: 'H/L', group: 'Daily', inline: 'hlDay' },
  { key: 'hlTimezone', type: 'tz', name: 'TZ', default: -4, enableWhen: 'enableHL', tab: 'H/L', group: 'Daily', inline: 'hlDay' },
  { key: 'hlHighColor', type: 'color', name: 'High', default: '#26a69a', enableWhen: 'enableHL', tab: 'H/L', group: 'Daily', inline: 'hlColors' },
  { key: 'hlLowColor', type: 'color', name: 'Low', default: '#ef5350', enableWhen: 'enableHL', tab: 'H/L', group: 'Daily', inline: 'hlColors' },

  // --- H/L tab, Weekly section. Horizontal high/low lines spanning each completed week. Uses the
  // Display boundary (timezone + start time + week-start day) -- the same weeks the weekly separators
  // mark. High swatch carries the shared line width + style; Low shares them. ---
  { key: 'wkWeeksToShow', type: 'number', name: 'Weeks', default: 3, min: 1, max: 52, width: 56, enableWhen: 'enableWkHL', tab: 'H/L', group: 'Weekly' },
  { key: 'wkHighColor', type: 'color', name: 'High', default: '#26a69a', stroke: { width: 'wkWidth', lineStyle: 'wkStyle' }, enableWhen: 'enableWkHL', tab: 'H/L', group: 'Weekly', inline: 'wkColors' },
  { key: 'wkLowColor', type: 'color', name: 'Low', default: '#ef5350', enableWhen: 'enableWkHL', tab: 'H/L', group: 'Weekly', inline: 'wkColors' },
  { key: 'wkStyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'wkWidth', type: 'number', default: 1, min: 1, max: 10, hidden: true },

  // --- Open tab. Daily opening price: a horizontal line at each day's OPEN price (the open of the
  // day-start bar), spanning the day, on the Display boundary (Day/Week Start Time + timezone). One
  // consolidated stroke swatch (colour + width + style). ---
  // The on/off switches live in the Toggles tab; the Open tab holds only the look (colour + width + style)
  // and the "current only" overrides. Colours first (Daily then Weekly), then the overrides. Each row
  // greys out when its line is off.
  { key: 'dailyOpenColor', type: 'color', name: 'Daily', default: '#ffffff', stroke: { width: 'dailyOpenWidth', lineStyle: 'dailyOpenStyle' }, enableWhen: 'enableDailyOpen', tab: 'Open' },
  { key: 'dailyOpenStyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'dailyOpenWidth', type: 'number', default: 1, min: 1, max: 10, hidden: true },
  { key: 'weeklyOpenColor', type: 'color', name: 'Weekly', default: '#2962ff', stroke: { width: 'weeklyOpenWidth', lineStyle: 'weeklyOpenStyle' }, enableWhen: 'enableWeeklyOpen', tab: 'Open' },
  { key: 'weeklyOpenStyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'weeklyOpenWidth', type: 'number', default: 1, min: 1, max: 10, hidden: true },
  // Overrides: show ONLY the current (forming) day's / week's open line, not every one in the window.
  { key: 'dailyOpenCurrentOnly', type: 'bool', name: 'Current day only', default: false, enableWhen: 'enableDailyOpen', tab: 'Open' },
  { key: 'weeklyOpenCurrentOnly', type: 'bool', name: 'Current week only', default: false, enableWhen: 'enableWeeklyOpen', tab: 'Open' },

  // --- Range tab. Weekly Range (AWR) settings: a corner-pinned table of the last N COMPLETED weeks'
  // ranges (week high - low) plus their average, in the chosen unit. Screen-anchored (stays put on
  // pan/zoom). The on/off switch lives in the Toggles tab; these grey out when it's off.
  { key: 'awrUnit', type: 'select', name: 'Unit', options: AWR_UNITS, default: 'Points', enableWhen: 'enableAWR', tab: 'Range' },
  { key: 'awrWeeks', type: 'number', name: 'Weeks to Average', default: 5, min: 1, max: 52, enableWhen: 'enableAWR', tab: 'Range' },
  { key: 'awrTablePos', type: 'select', name: 'Table Position', options: AWR_POS, default: 'Top Right', enableWhen: 'enableAWR', tab: 'Range' },
];

// The AWR table as viewport-anchored marks. Pinned to a pane corner (vpx/vp fractions + pixel offsets),
// so it never moves with the chart. `cells` = [[dateStr, valueStr], ...] oldest->newest; avgStr appended
// as the final "AWR" row. Returns a marks array (one shape).
/**
 * @param {string} pos  corner + placement, e.g. 'Top Right'
 * @param {[string, string][]} cells  [dateStr, valueStr] rows, oldest->newest
 * @param {string} avgStr  the average, rendered in the final AWR row
 * @returns {any[]}  viewport-anchored host-render marks (one shape's worth)
 */
function awrTableMarks(pos, cells, avgStr) {
  const ROW_H = 16, COL0 = 92, COL1 = 58, PAD = 8, MARGIN = 8;
  const W = COL0 + COL1, rows = cells.length + 2, H = rows * ROW_H;   // header + data rows + AWR
  const [vert, horiz] = String(pos || 'Top Right').split(' ');
  const BX = horiz === 'Left' ? 0 : horiz === 'Center' ? 0.5 : 1;
  const BY = vert === 'Middle' ? 0.5 : vert === 'Bottom' ? 1 : 0;
  const baseDx = horiz === 'Left' ? MARGIN : horiz === 'Center' ? -W / 2 : -(W + MARGIN);
  const baseDy = vert === 'Middle' ? -H / 2 : vert === 'Bottom' ? -(H + MARGIN) : MARGIN;
  /** @param {number} lx @param {number} ly */
  const at = (lx, ly) => ({ vpx: BX, vp: BY, dx: baseDx + lx, dy: baseDy + ly });
  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {string} fill @param {string|null} stroke */
  const rect = (x0, y0, x1, y1, fill, stroke) => ({ closed: true, fill, stroke, width: stroke ? 1 : 0, path: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)] });

  const PANEL = 'rgba(255,255,255,0.92)', BORDER = 'rgba(128,128,128,0.7)', BAND = 'rgba(120,123,134,0.9)';
  const INK = '#131722', HEAD = '#ffffff';
  /** @type {any[]} */
  const marks = [];
  marks.push(rect(0, 0, W, H, PANEL, BORDER));               // panel
  marks.push(rect(0, 0, W, ROW_H, BAND, null));              // header band
  marks.push(rect(0, H - ROW_H, W, H, BAND, null));          // AWR band
  /** @param {number} col @param {number} r @param {string} txt @param {string} color @param {boolean} [bold] */
  const cell = (col, r, txt, color, bold) => {
    const rightAlign = col === 1;
    const lx = rightAlign ? W - PAD : PAD;
    marks.push({ text: txt, at: at(lx, r * ROW_H + ROW_H / 2), color, align: rightAlign ? 'right' : 'left', baseline: 'middle', size: 11, bold: !!bold });
  };
  cell(0, 0, 'Week', HEAD, true); cell(1, 0, 'Range', HEAD, true);
  cells.forEach(([d, v], i) => { cell(0, i + 1, d, INK); cell(1, i + 1, v, INK); });   // d,v: [string,string] from the typed cells param
  cell(0, rows - 1, 'AWR', HEAD, true); cell(1, rows - 1, avgStr, HEAD, true);
  return marks;
}

// --- helpers ---
/** @param {string|number} tz */
const tzOff = (tz) => { if (typeof tz === 'number') return tz * 3600; const m = /^UTC([+-]\d+)?$/.exec(String(tz || 'UTC').trim()); return m && m[1] ? parseInt(m[1], 10) * 3600 : 0; };
/** @param {string} s */
const parseTOD = (s) => { const m = /^(\d{2})(\d{2})$/.exec(String(s || '1700').trim()); return m ? (+m[1]) * 3600 + (+m[2]) * 60 : 17 * 3600; };
/** @param {string} name */
const weekdayNum = (name) => { const i = WEEKDAYS.indexOf(name); return i < 0 ? 1 : i; };   // Sunday=0 .. Friday=5

Studies.register({
  id: 'day_marker',
  name: 'Day Marker',
  description: 'Vertical lines marking each new day, session, and time boundary.',
  overlay: true,
  inputs,
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {{ tickSize?:number }} [ctx]
   */
  calc(bars, p, ctx) {
    /** @type {any[]} */   // heterogeneous host-render shapes (vline/label/triangle/line + raw marks) on the `shapes` channel
    const shapes = [];
    const dayOn = !!p.enableDay, weekOn = !!p.enableWeek, labelsOn = !!p.enableLabels, hlOn = !!p.enableHL;
    if (!bars || !bars.length || (!dayOn && !weekOn && !labelsOn && !hlOn)) return { plots: [], shapes };

    const now = bars[bars.length - 1].time;   // UTC seconds
    const off = tzOff(p.timezone);
    const tod = parseTOD(p.startTime);
    // An "evening" start (>= 12:00, e.g. futures 17:00) OPENS the next calendar day's trading session,
    // so the Fri-evening / Sat opens fall on the weekend and are skipped. A "morning" start (e.g. forex
    // 00:00) opens the same calendar day, so Sat/Sun opens are the ones skipped.
    const eveningStart = tod >= 12 * 3600;

    const dayStroke = { color: p.dayColor || '#787b86', width: (p.dayWidth | 0) || 1, lineStyle: p.dayStyle || 'solid' };
    const weekStroke = { color: p.weekColor || '#2962ff', width: (p.weekWidth | 0) || 2, lineStyle: p.weekStyle || 'solid' };

    // most recent day-start boundary at/before the last bar
    let b0 = Math.floor((now + off) / 86400) * 86400 + tod - off;
    while (b0 > now) b0 -= 86400;

    // the trading weekday a boundary OPENS (0=Sun..6=Sat); skip it if that day is Sat/Sun (no session)
    /** @param {number} ts */
    const ownsWeekday = (ts) => { const wd = new Date((ts + off) * 1000).getUTCDay(); return eveningStart ? (wd + 1) % 7 : wd; };
    /** @param {number} ts */
    const isTrading = (ts) => { const d = ownsWeekday(ts); return d !== 0 && d !== 6; };
    // the next drawn separator after ts -- the right edge of ts's day cell (Friday spans Thu->Sun opens)
    /** @param {number} ts */
    const nextBoundary = (ts) => { let n = ts + 86400, g = 0; while (g++ < 10 && !isTrading(n)) n += 86400; return n; };

    // The week-start boundary is re-styled as WEEKLY, exactly as the original: it is the same day-start
    // boundary whose CALENDAR weekday (in tz, at the boundary instant) equals the week-start day. Weekly
    // wins over daily there (one line). Elsewhere the day line draws (when enabled).
    const targetWd = weekdayNum(p.weekStartDay);   // Sunday=0 .. Friday=5
    /** @param {number} ts @returns {'week'|'day'|null} */
    const kindOf = (ts) => {
      const calWd = new Date((ts + off) * 1000).getUTCDay();   // 0=Sun..6=Sat
      if (weekOn && calWd === targetWd) return 'week';
      return dayOn ? 'day' : null;
    };

    // the trading-day window: Pine daysToShow = (weeksToShow-1)*5 + daysInCurrentWeek, +1 for current.
    // Both separators AND labels span this same window (labels ignore the separator toggles).
    const weeks = Math.max(1, p.weeksToShow | 0);
    const nowWd = new Date((now + off) * 1000).getUTCDay();
    const daysInWeek = (nowWd - targetWd + 7) % 7;
    const dayWindow = Math.max(1, (weeks - 1) * 5 + daysInWeek + 1);
    const fwdWeeks = Math.max(0, p.futureWeeksToShow | 0);

    /** @param {number} ts @param {'week'|'day'} kind */
    const emit = (ts, kind) => { const s = kind === 'week' ? weekStroke : dayStroke; shapes.push({ type: 'vline', time: ts, color: s.color, width: s.width, lineStyle: s.lineStyle }); };

    // label placement. Horizontal: Left anchors to THIS boundary line, Right to the NEXT boundary line,
    // each held the same LM pixels off the line (consistent margin, not flush); Center = time-midpoint
    // of the day cell. Vertical: pinned to the pane edge via vp (0 = top, 1 = bottom), a few px off.
    const LM = 5;   // horizontal margin from the separator line, in px
    const hpos = p.labelHPos || 'Center';
    const lAlign = hpos === 'Left' ? 'left' : hpos === 'Right' ? 'right' : 'center';
    const lDx = hpos === 'Left' ? LM : hpos === 'Right' ? -LM : 0;
    const atBottom = (p.labelVPos || 'Bottom') !== 'Top';
    const lVp = atBottom ? 1 : 0, lDy = atBottom ? -4 : 4, lBase = atBottom ? 'bottom' : 'top';
    const lColor = p.labelColor || '#787b86', lSize = p.labelSize || 11;
    /** @param {number} start @param {number} end */
    const emitLabel = (start, end) => {
      const ch = LETTERS[ownsWeekday(start)]; if (!ch) return;
      const atT = hpos === 'Left' ? start : hpos === 'Right' ? end : (start + end) / 2;
      shapes.push({ marks: [{ text: ch, at: { t: atT, vp: lVp, dx: lDx, dy: lDy }, color: lColor, align: lAlign, baseline: lBase, size: lSize, bold: !!p.labelBold, italic: !!p.labelItalic }] });
    };

    // backward pass over the trading-day window: one boundary = one trading day. Draw its separator
    // (day/week, when enabled) and its letter label (when enabled). Count only real trading days.
    let kept = 0, ts = b0, guard = 0, leftEdge = b0;   // leftEdge = oldest drawn boundary (left edge of the window)
    while (kept < dayWindow && guard++ < 1200) {
      if (isTrading(ts)) {
        const k = kindOf(ts);
        if (k) emit(ts, k);
        if (labelsOn) emitLabel(ts, nextBoundary(ts));
        leftEdge = ts;   // decreasing ts, so the last kept boundary is the oldest -> the window's left edge
        kept++;
      }
      ts -= 86400;
    }
    // forward projection: draw the full projected weeks -- every day line plus each week line, AND the
    // day labels (JS has no future-label limitation the original had). A week is only a week when it is
    // FRAMED by both boundaries, so the (fwdWeeks+1)-th week line -- the CLOSING boundary that ends the
    // last future week -- IS drawn, then we stop (no label, no days beyond it). The trading-day cap is
    // the backstop for the weekly-off / labels-only case, where there is no week line to stop on. The
    // host extends the time scale so these future boundaries are reachable.
    const fwdCap = fwdWeeks * 5 + 7;
    let wkSeen = 0, fdays = 0; ts = b0 + 86400; guard = 0;
    while ((dayOn || weekOn || labelsOn) && guard++ < 1200) {
      if (isTrading(ts)) {
        const k = kindOf(ts);
        if (k === 'week' && ++wkSeen > fwdWeeks) {   // the closing boundary of the last future week --
          if (weekOn) emit(ts, 'week');              // draw it so the week is FRAMED (start AND end), then stop
          break;
        }
        if (k) emit(ts, k);
        if (labelsOn) emitLabel(ts, nextBoundary(ts));
        if (++fdays >= fwdCap) break;
      }
      ts += 86400;
    }

    // ---- Daily Highs & Lows ----------------------------------------------------------------------
    // Mark each COMPLETED trading day's extreme bars: a downward triangle above the day's high bar, an
    // upward triangle below the day's low bar. Uses its OWN timezone + day-start (separate from the
    // separator boundary). We recompute from full bar history each pass, so a "completed" day is simply
    // any day group that is not the still-forming last one -- no live-timing / Friday-early-finalize
    // logic needed. Generic fixed-size triangles for now (colour only).
    // Mitigation (Hide Mitigated H/L): a level is "mitigated" once a LATER bar trades through it -- a high
    // taken out from above, a low from below. Suffix arrays give the max high / min low over all bars AFTER
    // an index, so a level formed by a group ending at endIdx is mitigated when sufHi[endIdx+1] >= its high
    // (or sufLo[endIdx+1] <= its low). When the toggle is off, sufHi/sufLo stay null and nothing is hidden.
    const hideM = !!p.hideMitigatedHL;
    /** @type {number[]|null} */
    let sufHi = null;
    /** @type {number[]|null} */
    let sufLo = null;
    if (hideM) {
      const n = bars.length; sufHi = new Array(n + 1); sufLo = new Array(n + 1);
      sufHi[n] = -Infinity; sufLo[n] = Infinity;
      for (let i = n - 1; i >= 0; i--) { sufHi[i] = Math.max(bars[i].high, sufHi[i + 1]); sufLo[i] = Math.min(bars[i].low, sufLo[i + 1]); }
    }
    // sufHi/sufLo are non-null whenever hideM is true (the `hideM &&` short-circuits before the index), so cast past the null.
    /** @param {number} level @param {number} endIdx */
    const hiMitigated = (level, endIdx) => hideM && /** @type {number[]} */ (sufHi)[endIdx + 1] >= level;   // a later bar traded above
    /** @param {number} level @param {number} endIdx */
    const loMitigated = (level, endIdx) => hideM && /** @type {number[]} */ (sufLo)[endIdx + 1] <= level;   // a later bar traded below

    if (hlOn) {
      const hlOff = tzOff(p.hlTimezone), hlTod = parseTOD(p.hlStartTime), hlEvening = hlTod >= 12 * 3600;
      /** @param {number} dayStart */
      const hlOwns = (dayStart) => { const wd = new Date((dayStart + hlOff) * 1000).getUTCDay(); return hlEvening ? (wd + 1) % 7 : wd; };
      /** @param {number} t */
      const dayKey = (t) => Math.floor((t + hlOff - hlTod) / 86400);   // bars sharing a key are one trading day

      // group consecutive bars into trading days, tracking the high bar, the low bar, and the last bar index
      /** @type {{ key:number, dayStart:number, hi:number, hiT:number, lo:number, loT:number, endIdx:number }[]} */
      const groups = [];
      /** @type {{ key:number, dayStart:number, hi:number, hiT:number, lo:number, loT:number, endIdx:number }|null} */
      let g = null;
      for (let bi = 0; bi < bars.length; bi++) {
        const b = bars[bi], k = dayKey(b.time);
        if (!g || g.key !== k) { if (g) groups.push(g); g = { key: k, dayStart: k * 86400 + hlTod - hlOff, hi: b.high, hiT: b.time, lo: b.low, loT: b.time, endIdx: bi }; }
        else { g.endIdx = bi; if (b.high > g.hi) { g.hi = b.high; g.hiT = b.time; } if (b.low < g.lo) { g.lo = b.low; g.loT = b.time; } }
      }
      if (g) groups.push(g);

      // completed trading days only (drop the still-forming last group); skip weekend opens (no session)
      const done = groups.slice(0, -1).filter((x) => { const d = hlOwns(x.dayStart); return d !== 0 && d !== 6; });
      // "Whole Range" fills the visible separator window instead of the H/L tab's own Days count: take every
      // completed day, then clip each triangle to the oldest drawn separator (leftEdge) so none spills past
      // the left edge of the range the user set. Else: the last N days from the H/L tab.
      const hlLeft = p.hlWholeRange ? leftEdge : -Infinity;
      const show = p.hlWholeRange
        ? done.filter((x) => bars[x.endIdx].time >= hlLeft)
        : done.slice(-Math.max(1, p.hlDaysToShow | 0));
      const hiCol = p.hlHighColor || '#26a69a', loCol = p.hlLowColor || '#ef5350';
      const G = 3, TH = 9, TW = 6;   // gap off the bar / triangle height / half-width, in px
      for (const x of show) {
        if (x.hiT >= hlLeft && !hiMitigated(x.hi, x.endIdx)) shapes.push({ marks: [{ closed: true, fill: hiCol, path: [   // triangle-down, above the high
          { t: x.hiT, p: x.hi, dx: -TW, dy: -(G + TH) }, { t: x.hiT, p: x.hi, dx: TW, dy: -(G + TH) }, { t: x.hiT, p: x.hi, dx: 0, dy: -G },
        ] }] });
        if (x.loT >= hlLeft && !loMitigated(x.lo, x.endIdx)) shapes.push({ marks: [{ closed: true, fill: loCol, path: [   // triangle-up, below the low
          { t: x.loT, p: x.lo, dx: -TW, dy: (G + TH) }, { t: x.loT, p: x.lo, dx: TW, dy: (G + TH) }, { t: x.loT, p: x.lo, dx: 0, dy: G },
        ] }] });
      }
    }

    // ---- Weekly Highs & Lows ---------------------------------------------------------------------
    // A horizontal line at each COMPLETED week's high and low, spanning the week's bars. Weeks use the
    // Display boundary (off / tod / targetWd) -- the same weeks the weekly separators mark. Week key is
    // arithmetic (no Date): dayIdx buckets bars by the day-start; a week rolls at the week-start weekday.
    if (p.enableWkHL) {
      /** @param {number} t */
      const weekKey = (t) => Math.floor((Math.floor((t + off - tod) / 86400) - targetWd + 4) / 7);
      /** @type {{ key:number, hi:number, lo:number, firstT:number, lastT:number, endIdx:number }[]} */
      const wks = [];
      /** @type {{ key:number, hi:number, lo:number, firstT:number, lastT:number, endIdx:number }|null} */
      let cur = null;
      for (let bi = 0; bi < bars.length; bi++) {
        const b = bars[bi], k = weekKey(b.time);
        if (!cur || cur.key !== k) { if (cur) wks.push(cur); cur = { key: k, hi: b.high, lo: b.low, firstT: b.time, lastT: b.time, endIdx: bi }; }
        else { cur.endIdx = bi; if (b.high > cur.hi) cur.hi = b.high; if (b.low < cur.lo) cur.lo = b.low; cur.lastT = b.time; }
      }
      if (cur) wks.push(cur);
      const wkW = (p.wkWidth | 0) || 1, wkS = p.wkStyle || 'solid';
      const wkHi = p.wkHighColor || '#26a69a', wkLo = p.wkLowColor || '#ef5350';
      // draw completed weeks (exclude the still-forming last one), last N. Each line spans from the
      // week's first bar to the NEXT week's first bar -- i.e. right up to the weekly boundary, so it
      // meets the separator with no gap (as in the original: wkStartBarIdx -> next week's open bar).
      const completed = wks.length - 1;
      // "Whole Range" fills the visible separator week span instead of the H/L tab's Weeks count: walk every
      // completed week but skip any that STARTS before the oldest drawn separator (leftEdge), so only weeks
      // actually framed by the range draw a line -- no extra week spilling off the left edge. Else: last N.
      const start = p.wkWholeRange ? 0 : Math.max(0, completed - Math.max(1, p.wkWeeksToShow | 0));
      for (let i = start; i < completed; i++) {
        const w = wks[i], rightT = wks[i + 1].firstT;
        if (p.wkWholeRange && w.firstT < leftEdge) continue;   // week begins before the visible window -> skip
        if (!hiMitigated(w.hi, w.endIdx)) shapes.push({ marks: [{ stroke: wkHi, width: wkW, dash: wkS, path: [{ t: w.firstT, p: w.hi }, { t: rightT, p: w.hi }] }] });
        if (!loMitigated(w.lo, w.endIdx)) shapes.push({ marks: [{ stroke: wkLo, width: wkW, dash: wkS, path: [{ t: w.firstT, p: w.lo }, { t: rightT, p: w.lo }] }] });
      }
    }

    // ---- Daily Opening Price ---------------------------------------------------------------------
    // A horizontal line at each day's OPEN (the open of the day-start bar), spanning the day. Uses the
    // Display boundary (off / tod). Each line runs from the day's first bar to the NEXT day's first bar
    // -- so a Friday line extends across the collapsed weekend to the next session, as in the original.
    if (p.enableDailyOpen) {
      /** @param {number} t */
      const doKey = (t) => Math.floor((t + off - tod) / 86400);   // bars sharing a key are one trading day
      /** @type {Map<number, { key:number, open:number, firstT:number }>} */
      const dm = new Map();
      for (const b of bars) { const k = doKey(b.time); if (!dm.has(k)) dm.set(k, { key: k, open: b.open, firstT: b.time }); }
      const arr = [...dm.values()];   // insertion order == ascending (bars are sorted)
      const doCol = p.dailyOpenColor || '#ffffff', doW = (p.dailyOpenWidth | 0) || 1, doS = p.dailyOpenStyle || 'solid';
      let drawn = 0;
      const dLimit = p.dailyOpenCurrentOnly ? 1 : dayWindow;   // "Current day only" -> just the forming day
      for (let i = arr.length - 1; i >= 0 && drawn < dLimit; i--) {
        const d = arr[i], boundary = d.key * 86400 + tod - off;
        if (!isTrading(boundary)) continue;   // skip weekend day-starts (no session)
        const rightT = (i + 1 < arr.length) ? arr[i + 1].firstT : nextBoundary(boundary);   // next day, or projected for the live day
        shapes.push({ marks: [{ stroke: doCol, width: doW, dash: doS, path: [{ t: d.firstT, p: d.open }, { t: rightT, p: d.open }] }] });
        drawn++;
      }
    }

    // ---- Weekly Opening Price --------------------------------------------------------------------
    // A horizontal line at each week's OPEN (the open of the week-start bar), spanning the week. Weeks use
    // the SAME key as Weekly H/L + the weekly separators (off / tod / targetWd). Each line runs from the
    // week's first bar to the NEXT week's first bar; the current (forming) week projects one week ahead to
    // its next boundary (which lands on the projected future grid).
    if (p.enableWeeklyOpen) {
      /** @param {number} t */
      const woKey = (t) => Math.floor((Math.floor((t + off - tod) / 86400) - targetWd + 4) / 7);
      /** @type {Map<number, { key:number, open:number, firstT:number }>} */
      const wm = new Map();
      for (const b of bars) { const k = woKey(b.time); if (!wm.has(k)) wm.set(k, { key: k, open: b.open, firstT: b.time }); }
      const arr = [...wm.values()];   // insertion order == ascending (bars are sorted)
      const woCol = p.weeklyOpenColor || '#2962ff', woW = (p.weeklyOpenWidth | 0) || 1, woS = p.weeklyOpenStyle || 'solid';
      let drawn = 0;
      const wLimit = p.weeklyOpenCurrentOnly ? 1 : weeks;   // "Current week only" -> just the forming week
      for (let i = arr.length - 1; i >= 0 && drawn < wLimit; i--) {
        const w = arr[i];
        const boundary = Math.floor((w.firstT + off - tod) / 86400) * 86400 + tod - off;   // this week's start boundary
        const rightT = (i + 1 < arr.length) ? arr[i + 1].firstT : boundary + 7 * 86400;     // next week, or projected 1 week ahead
        shapes.push({ marks: [{ stroke: woCol, width: woW, dash: woS, path: [{ t: w.firstT, p: w.open }, { t: rightT, p: w.open }] }] });
        drawn++;
      }
    }

    // ---- Weekly Range (AWR) table ----------------------------------------------------------------
    // Group bars into weeks (same week key), take each COMPLETED week's range (high - low), keep the last
    // N, and render a corner-pinned table of each week's date span + range, plus the average. Units: Points
    // = raw price; Ticks = range / tickSize; Pips = range / tickSize / 10 (ticks/pips need the instrument
    // tick size from ctx; without it they fall back to raw). Mirrors the Pine AWR table.
    if (p.enableAWR) {
      /** @param {number} t */
      const awrKey = (t) => Math.floor((Math.floor((t + off - tod) / 86400) - targetWd + 4) / 7);
      /** @type {Map<number, { key:number, hi:number, lo:number, firstT:number }>} */
      const wm = new Map();
      for (const b of bars) {
        const k = awrKey(b.time); let g = wm.get(k);
        if (!g) wm.set(k, { key: k, hi: b.high, lo: b.low, firstT: b.time });
        else { if (b.high > g.hi) g.hi = b.high; if (b.low < g.lo) g.lo = b.low; }
      }
      const done = [...wm.values()].slice(0, -1);                 // drop the still-forming week
      const rows = done.slice(-Math.max(1, p.awrWeeks | 0));      // last N completed weeks
      if (rows.length) {
        const tick = ctx && ctx.tickSize ? ctx.tickSize : null;
        const unit = p.awrUnit || 'Points';
        /** @param {number} r */
        const conv = (r) => (unit === 'Points' || !tick) ? r : unit === 'Ticks' ? r / tick : r / tick / 10;
        /** @param {number} v */
        const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
        const fridayOff = 5 - targetWd;                            // week-start day -> that week's Friday
        /** @param {number} tsec */
        const md = (tsec) => { const d = new Date((tsec + off) * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
        const cells = rows.map((w) => {
          const bnd = Math.floor((w.firstT + off - tod) / 86400) * 86400 + tod - off;   // week-start boundary
          return /** @type {[string, string]} */ ([md(bnd) + '-' + md(bnd + fridayOff * 86400), fmt(conv(w.hi - w.lo))]);
        });
        const avg = rows.reduce((a, w) => a + (w.hi - w.lo), 0) / rows.length;
        shapes.push({ marks: awrTableMarks(p.awrTablePos, cells, fmt(conv(avg))) });
      }
    }

    return { plots: [], shapes };
  },
});

// Loaded via dynamic import() (an ES module at runtime); the empty export gives this file its own
// module scope so its top-level const helpers don't collide with sibling study modules' globals.
export {};
