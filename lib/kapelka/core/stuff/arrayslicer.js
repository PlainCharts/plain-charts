// @ts-check
// Vendored, zero-dep replacement for the `arrayslicer` npm package (IndexedArray).
// Binary search over a numeric column. Implements only what stuff/utils.js uses:
//   new IndexedArray(arr, "0") · getRange(t1,t2) · valpos[t1].next · fetch(t) + nextlow/nexthigh
// arr is row-arrays sorted ascending by column `field` (e.g. ohlcv sorted by time at col 0).

/**
 * A data row: numeric array (e.g. ohlcv `[t, o, h, l, c, v]`), sorted ascending by column `f`.
 * @typedef {number[]} Row
 */

export default class IndexedArray {
  /**
   * @param {Row[] | undefined} arr - row-arrays sorted ascending by column `field`
   * @param {string} field - numeric column index (parsed via parseInt)
   */
  constructor(arr, field) {
    this.arr = arr || [];
    this.f = parseInt(field, 10) || 0;
    /** @type {Object<number, { next: number }>} */
    this.valpos = {};
  }
  // first index i with arr[i][f] >= t
  /**
   * @param {number} t
   * @return {number}
   */
  _lower(t) {
    let lo = 0,
      hi = this.arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.arr[m][this.f] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }
  // first index i with arr[i][f] > t
  /**
   * @param {number} t
   * @return {number}
   */
  _upper(t) {
    let lo = 0,
      hi = this.arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.arr[m][this.f] <= t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }
  /**
   * @param {number} t1
   * @param {number} t2
   * @return {Row[]}
   */
  getRange(t1, t2) {
    const lo = this._lower(t1),
      hi = this._upper(t2);
    this.valpos[t1] = { next: lo }; // utils.fast_filter reads valpos[t1].next
    return this.arr.slice(lo, hi);
  }
  /**
   * @param {number} t
   * @return {this}
   */
  fetch(t) {
    const hi = this._lower(t);
    this.nexthigh = hi;
    this.nextlow = hi > 0 ? hi - 1 : 0;
    return this;
  }
}
