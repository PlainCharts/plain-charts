// @ts-check

import IndexedArray from './arrayslicer.js';
import Const from './constants.js';

/**
 * A single OHLCV row: `[time, ...values]`. Column 0 is the timestamp.
 * The remaining columns vary by overlay, so they are typed loosely.
 * @typedef {number[]} OHLCVRow
 */

export default {
  /**
   * @param {number} num
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
  },

  /**
   * @param {number} i
   * @returns {number | string}
   */
  add_zero(i) {
    if (i < 10) {
      i = /** @type {any} */ ('0' + i);
    }
    return i;
  },

  // Start of the day (zero millisecond)
  /**
   * @param {number | string | Date} t
   * @returns {number}
   */
  day_start(t) {
    let start = new Date(t);
    return start.setUTCHours(0, 0, 0, 0);
  },

  // Start of the month
  /**
   * @param {number | string | Date} t
   * @returns {number}
   */
  month_start(t) {
    let date = new Date(t);
    return Date.UTC(date.getFullYear(), date.getMonth(), 1);
  },

  // Start of the year
  /**
   * @param {number | string | Date} t
   * @returns {number}
   */
  year_start(t) {
    return Date.UTC(new Date(t).getFullYear());
  },

  /**
   * @param {number | string | Date} t
   * @returns {number | undefined}
   */
  get_year(t) {
    if (!t) return undefined;
    return new Date(t).getUTCFullYear();
  },

  /**
   * @param {number | string | Date} t
   * @returns {number | undefined}
   */
  get_month(t) {
    if (!t) return undefined;
    return new Date(t).getUTCMonth();
  },

  // Nearest in array
  /**
   * @param {number} x
   * @param {number[]} array
   * @returns {[number, number | null]}
   */
  nearest_a(x, array) {
    let dist = Infinity;
    let val = null;
    let index = -1;
    for (var i = 0; i < array.length; i++) {
      var xi = array[i];
      if (Math.abs(xi - x) < dist) {
        dist = Math.abs(xi - x);
        val = xi;
        index = i;
      }
    }
    return [index, val];
  },

  /**
   * @param {number} num
   * @param {number} [decimals=8]
   * @returns {number}
   */
  round(num, decimals = 8) {
    return parseFloat(num.toFixed(decimals));
  },

  // Strip? No, it's ugly floats in js
  /**
   * @param {number | string} number
   * @returns {number}
   */
  strip(number) {
    return parseFloat(parseFloat(/** @type {any} */ (number)).toPrecision(12));
  },

  // Detects candles interval
  /**
   * @param {OHLCVRow[]} ohlcv
   * @returns {number}
   */
  detect_interval(ohlcv) {
    let len = Math.min(ohlcv.length - 1, 99);
    let min = Infinity;
    ohlcv.slice(0, len).forEach((x, i) => {
      let d = ohlcv[i + 1][0] - x[0];
      if (d === d && d < min) min = d;
    });
    // This saves monthly chart from being awkward
    if (min >= Const.MONTH && min <= Const.DAY * 30) {
      return Const.DAY * 31;
    }
    return min;
  },

  // Fast filter. Really fast, like 10X
  /**
   * @param {OHLCVRow[]} arr
   * @param {number} t1
   * @param {number} t2
   * @returns {[OHLCVRow[], number | undefined]}
   */
  fast_filter(arr, t1, t2) {
    if (!arr.length) return [arr, undefined];
    try {
      let ia = new IndexedArray(arr, '0');
      let res = ia.getRange(t1, t2);
      let i0 = ia.valpos[t1].next;
      return [res, i0];
    } catch (e) {
      // Something wrong with fancy slice lib
      // Fast fix: fallback to filter
      return [arr.filter((x) => x[0] >= t1 && x[0] <= t2), 0];
    }
  },

  // Nearest indexes (left and right)
  /**
   * @param {OHLCVRow[]} arr
   * @param {number} t1
   * @returns {[number, number]}
   */
  fast_nearest(arr, t1) {
    let ia = new IndexedArray(arr, '0');
    ia.fetch(t1);
    return [/** @type {number} */ (ia.nextlow), /** @type {number} */ (ia.nexthigh)];
  },

  // Detect index shift between the main data sub
  // and the overlay's sub (for IB-mode)
  /**
   * @param {OHLCVRow[]} sub
   * @param {OHLCVRow[]} data
   * @returns {number}
   */
  index_shift(sub, data) {
    // Find the second timestamp (by value)
    if (!data.length) return 0;
    let first = data[0][0];
    let second;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] !== first) {
        second = data[i][0];
        break;
      }
    }

    for (var j = 0; j < sub.length; j++) {
      if (sub[j][0] === second) {
        return j - i;
      }
    }

    return 0;
  },
};
