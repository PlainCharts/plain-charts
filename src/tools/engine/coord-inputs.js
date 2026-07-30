// @ts-check
// Segmented, keyboard-driven date/time inputs + the timezone-aware conversions between a
// stored anchor time (epoch SECONDS) and wall-clock parts, in the chart's DISPLAY timezone.
// Extracted verbatim from settings-dialog.js so the drawing Coordinates tab and the bottom-bar
// quick-coordinates editor (panels/quick-coords.js) share one implementation.
import { getOffsetMin } from '../../workspace/timezone.js';

/** Broken-out wall-clock parts of a stored anchor time, in the chart's display timezone. */
/** @typedef {{ y: number, mo: number, d: number, h: number, mi: number, s: number }} TimeParts */
/** Date-only parts (year / 0-based month / day). */
/** @typedef {{ y: number, mo: number, d: number }} DateParts */
/** Time-only parts (24h hour / minute / second). */
/** @typedef {{ h: number, mi: number, s: number }} HmsParts */

/**
 * @param {string} tag @param {string | null} [cls] @param {string} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

// Anchor time (epoch SECONDS) <-> separate DATE and TIME text fields, typed by keyboard
// (no picker), in the CHART's display timezone -- the same wall clock the axis shows. The
// axis renders UTC + getOffsetMin(), so we shift by the offset and read/write UTC fields
// (keeps the browser's own local timezone from double-applying). Date and time are edited
// independently: changing one keeps the other component of the stored anchor.
// break a stored time into chart-tz wall-clock parts; and put parts back together.
// Exported so the bottom-bar quick-coordinates editor reuses the exact same conversion.
/** @param {number} timeSec @param {number} [offsetMin] display offset (min east of UTC); defaults to the global @returns {TimeParts} */
export function partsOf(timeSec, offsetMin = getOffsetMin()) {
  const d = new Date(timeSec * 1000 + offsetMin * 60000);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}
/** @param {TimeParts} p @param {number} [offsetMin] display offset (min east of UTC); defaults to the global @returns {number} */
export function timeFromParts(p, offsetMin = getOffsetMin()) {
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - offsetMin * 60000) / 1000);
}
// DATE field: ISO YYYY-MM-DD (unambiguous + fast to type). Accepts - . / separators.
/** @param {{ y: number, mo: number, d: number }} p @returns {string} */
export function fmtDateField(p) {
  return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d);
}
/** @param {string} str @returns {DateParts | null} */
export function parseDateField(str) {
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec((str || '').trim());
  if (!m) return null;
  const mo = +m[2] - 1,
    d = +m[3];
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return { y: +m[1], mo, d };
}
// Segmented TIME input: HH : MM : SS (+ AM/PM when the app is on 12h), each segment a
// two-digit field that AUTO-ADVANCES as you type -- finish the hours and focus jumps to
// minutes, then seconds, exactly like a native time field but honouring the app's 24h/12h
// setting (native type=time follows the OS locale, which is what wrongly showed AM/PM).
// Arrow up/down nudges a segment; ':'/space/Right jump forward; Backspace on empty jumps
// back; Enter commits. Returns { el, set(parts) }; onCommit(h,mi,s) fires on every edit.
/** @param {string} v @param {number} lo @param {number} hi @returns {number} */
const clampInt = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
};
/**
 * @param {boolean} h24
 * @param {(parts: HmsParts) => void} onCommit
 * @param {{ seconds?: boolean }} [opts]
 * @returns {{ el: HTMLElement, set: (p: HmsParts) => void }}
 */
export function segTime(h24, onCommit, opts) {
  const seconds = !opts || opts.seconds !== false; // opt out of the SS segment (HH:MM only)
  const box = el('div', 'seg-time set-coord-txt');
  const mk = () => {
    const i = /** @type {HTMLInputElement} */ (el('input', 'seg'));
    i.type = 'text';
    i.inputMode = 'numeric';
    i.maxLength = 2;
    i.spellcheck = false;
    return i;
  };
  const hh = mk(),
    mm = mk(),
    ss = seconds ? mk() : null;
  box.append(hh, el('span', 'seg-sep', ':'), mm);
  if (ss) box.append(el('span', 'seg-sep', ':'), ss);
  /** @type {HTMLInputElement | null} */
  let ap = null;
  if (!h24) {
    ap = /** @type {HTMLInputElement} */ (el('input', 'seg seg-ap'));
    ap.type = 'text';
    ap.maxLength = 2;
    ap.spellcheck = false;
    box.append(el('span', 'seg-sep', ' '), ap);
  }

  const nums = ss ? [hh, mm, ss] : [hh, mm];
  /** @param {HTMLInputElement} seg */
  const hiOf = (seg) => (seg === hh ? (h24 ? 23 : 12) : 59);
  /** @param {HTMLInputElement} seg */
  const loOf = (seg) => (seg === hh && !h24 ? 1 : 0);
  /** @param {HTMLInputElement} seg @returns {HTMLInputElement | null} */
  const nextOf = (seg) => (seg === hh ? mm : seg === mm ? ss || ap || null : seg === ss ? ap || null : null);
  /** @param {HTMLInputElement} seg @returns {HTMLInputElement | null} */
  const prevOf = (seg) => (seg === ss ? mm : seg === mm ? hh : seg === ap ? ss || mm : null);

  const read = () => {
    let h = clampInt(hh.value, loOf(hh), hiOf(hh));
    const mi = clampInt(mm.value, 0, 59),
      s = ss ? clampInt(ss.value, 0, 59) : 0;
    if (!h24) {
      const apEl = /** @type {HTMLInputElement} */ (ap);
      const pm = (apEl.value || 'AM').toUpperCase().charAt(0) === 'P';
      h = (h % 12) + (pm ? 12 : 0);
    }
    return { h, mi, s };
  };
  /** @param {HmsParts} p */
  const set = (p) => {
    let disp = p.h;
    if (!h24) {
      if (ap) ap.value = p.h < 12 ? 'AM' : 'PM';
      disp = p.h % 12 === 0 ? 12 : p.h % 12;
    }
    hh.value = pad2(disp);
    mm.value = pad2(p.mi);
    if (ss) ss.value = pad2(p.s);
  };
  const commit = () => onCommit(read());

  nums.forEach((seg) => {
    seg.addEventListener('focus', () => seg.select());
    seg.addEventListener('input', () => {
      seg.value = seg.value.replace(/\D/g, '').slice(0, 2);
      const v = seg.value,
        hi = hiOf(seg);
      // advance when the segment is full, or when a single digit can't be the tens of any valid value
      if (v.length === 2) {
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      } else if (v.length === 1 && +v > Math.floor(hi / 10)) {
        seg.value = pad2(+v);
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      }
    });
    seg.addEventListener('keydown', (e) => {
      const atStart = seg.selectionStart === 0 && seg.selectionEnd === 0;
      const atEnd = seg.selectionStart === seg.value.length && seg.selectionEnd === seg.value.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = clampInt(seg.value, loOf(seg), hiOf(seg));
        const lo = loOf(seg),
          hi = hiOf(seg),
          span = hi - lo + 1;
        const nv = lo + ((((cur - lo + (e.key === 'ArrowUp' ? 1 : -1)) % span) + span) % span);
        seg.value = pad2(nv);
        commit();
      } else if (e.key === ':' || e.key === ' ') {
        e.preventDefault();
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      } else if (e.key === 'ArrowRight' && atEnd) {
        const n = nextOf(seg);
        if (n) {
          e.preventDefault();
          n.focus();
          n.select && n.select();
        }
      } else if (e.key === 'ArrowLeft' && atStart) {
        const p = prevOf(seg);
        if (p) {
          e.preventDefault();
          p.focus();
          p.select && p.select();
        }
      } else if (e.key === 'Backspace' && seg.value === '') {
        const p = prevOf(seg);
        if (p) {
          e.preventDefault();
          p.focus();
        }
      } else if (e.key === 'Enter') seg.blur();
    });
    seg.addEventListener('blur', () => {
      if (seg.value !== '') seg.value = pad2(clampInt(seg.value, loOf(seg), hiOf(seg)));
      commit();
    });
  });

  if (ap) {
    ap.addEventListener('focus', () => /** @type {HTMLInputElement} */ (ap).select());
    ap.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || /^[aApP]$/.test(e.key)) {
        e.preventDefault();
        /** @type {HTMLInputElement} */ (ap).value = /^[pP]$/.test(e.key)
          ? 'PM'
          : /^[aA]$/.test(e.key)
            ? 'AM'
            : /** @type {HTMLInputElement} */ (ap).value.toUpperCase().charAt(0) === 'P'
              ? 'AM'
              : 'PM';
        commit();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const p = prevOf(/** @type {HTMLInputElement} */ (ap));
        if (p) {
          p.focus();
          p.select();
        }
      } else if (e.key === 'Enter') /** @type {HTMLInputElement} */ (ap).blur();
      else e.preventDefault(); // AM/PM segment is not free-typed
    });
    ap.addEventListener('blur', commit);
  }

  return { el: box, set };
}

// Segmented DATE input: MM / DD / YY (2-digit year), the same keyboard behaviour as segTime
// (auto-advance, arrow-nudge, '/' or '.'/'-'/space to jump, Backspace-on-empty to go back). Used by
// the compact bottom-bar quick-coordinates editor; the full Coordinates tab keeps the native picker.
// onCommit({ y, mo, d }) fires on every edit; set({ y, mo, d }) fills the fields. Year pivot: <70 -> 20xx.
/**
 * @param {(parts: DateParts) => void} onCommit
 * @returns {{ el: HTMLElement, set: (p: DateParts) => void }}
 */
export function segDate(onCommit) {
  const box = el('div', 'seg-time seg-date set-coord-txt');
  const mk = () => {
    const i = /** @type {HTMLInputElement} */ (el('input', 'seg'));
    i.type = 'text';
    i.inputMode = 'numeric';
    i.maxLength = 2;
    i.spellcheck = false;
    return i;
  };
  const MM = mk(),
    DD = mk(),
    YY = mk();
  box.append(MM, el('span', 'seg-sep', '/'), DD, el('span', 'seg-sep', '/'), YY);
  const segs = [MM, DD, YY];
  /** @param {HTMLInputElement} s */
  const hiOf = (s) => (s === MM ? 12 : s === DD ? 31 : 99);
  /** @param {HTMLInputElement} s */
  const loOf = (s) => (s === YY ? 0 : 1);
  /** @param {HTMLInputElement} s @returns {HTMLInputElement | null} */
  const nextOf = (s) => (s === MM ? DD : s === DD ? YY : null);
  /** @param {HTMLInputElement} s @returns {HTMLInputElement | null} */
  const prevOf = (s) => (s === YY ? DD : s === DD ? MM : null);
  const read = () => {
    const mo = clampInt(MM.value, 1, 12) - 1,
      d = clampInt(DD.value, 1, 31),
      yy = clampInt(YY.value, 0, 99);
    return { y: yy < 70 ? 2000 + yy : 1900 + yy, mo, d };
  };
  /** @param {DateParts} p */
  const set = (p) => {
    MM.value = pad2(p.mo + 1);
    DD.value = pad2(p.d);
    YY.value = pad2(((p.y % 100) + 100) % 100);
  };
  const commit = () => onCommit(read());
  segs.forEach((seg) => {
    seg.addEventListener('focus', () => seg.select());
    seg.addEventListener('input', () => {
      seg.value = seg.value.replace(/\D/g, '').slice(0, 2);
      const v = seg.value,
        hi = hiOf(seg);
      if (v.length === 2) {
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      } else if (v.length === 1 && +v > Math.floor(hi / 10)) {
        seg.value = pad2(+v);
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      }
    });
    seg.addEventListener('keydown', (e) => {
      const atStart = seg.selectionStart === 0 && seg.selectionEnd === 0;
      const atEnd = seg.selectionStart === seg.value.length && seg.selectionEnd === seg.value.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const lo = loOf(seg),
          hi = hiOf(seg),
          span = hi - lo + 1;
        const cur = clampInt(seg.value, lo, hi);
        const nv = lo + ((((cur - lo + (e.key === 'ArrowUp' ? 1 : -1)) % span) + span) % span);
        seg.value = pad2(nv);
        commit();
      } else if (e.key === '/' || e.key === '.' || e.key === '-' || e.key === ' ') {
        e.preventDefault();
        const n = nextOf(seg);
        if (n) {
          n.focus();
          n.select && n.select();
        }
      } else if (e.key === 'ArrowRight' && atEnd) {
        const n = nextOf(seg);
        if (n) {
          e.preventDefault();
          n.focus();
          n.select && n.select();
        }
      } else if (e.key === 'ArrowLeft' && atStart) {
        const p = prevOf(seg);
        if (p) {
          e.preventDefault();
          p.focus();
          p.select && p.select();
        }
      } else if (e.key === 'Backspace' && seg.value === '') {
        const p = prevOf(seg);
        if (p) {
          e.preventDefault();
          p.focus();
        }
      } else if (e.key === 'Enter') seg.blur();
    });
    seg.addEventListener('blur', () => {
      if (seg.value !== '') seg.value = pad2(clampInt(seg.value, loOf(seg), hiOf(seg)));
      commit();
    });
  });
  return { el: box, set };
}
