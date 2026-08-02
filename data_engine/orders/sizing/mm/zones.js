// @ts-check
// Zone window -- a grid plus a sliding 2-band window that sits on top of the cascade ladder.
// Pure logic: no broker, no store, no DOM.
//
// The cascade ladder (cascade.js) handles risk INSIDE a band. This module decides which band is active and
// what MAX% it should use, by sliding a 2-band window over a fixed price grid.
//
// Fixed reference points (never move):
//   origin       initial account balance -- the grid reference
//   hardFloor    origin - maxDd -- self-imposed max drawdown
//
// Grid -- only ABOVE the origin: origin, origin+increment, origin+2*increment, ...
//
// Two roles ride the grid as a 2-band window:
//   BASE = [L, L+increment)          ladder, baseMaxPct
//   SHOT = [L+increment, L+2*incr)   ladder, shotMaxPct
//   L = base bottom, starts at the origin.
//   slide UP   when balance reaches the shot top (L + 2*increment) -> L += increment
//   slide DOWN when balance falls below the base bottom (L)        -> L -= increment
//   L never goes below the origin.
//
// The window follows the account BOTH ways, so L is path-dependent and is recomputed by replaying the balance
// history (stateless, like the cascade).
//
// Below the origin there is no grid:
//   hardFloor .. origin   FLOOR  -> MIN only (ladder frozen)
//   below hardFloor       STOP   -> max DD hit, no trading

export class ZoneManager {
  static STOP = 'STOP';
  static FLOOR = 'FLOOR';
  static BASE = 'BASE';
  static SHOT = 'SHOT';

  /**
   * @param {number} origin initial account balance -- the grid reference
   * @param {number} increment grid step above the origin
   * @param {number} maxDd self-imposed max drawdown; hardFloor = origin - maxDd
   * @param {number} [baseMaxPct] ladder ceiling in the BASE band
   * @param {number} [shotMaxPct] ladder ceiling in the SHOT band
   */
  constructor(origin, increment, maxDd, baseMaxPct = 1.0, shotMaxPct = 1.5) {
    this.origin = origin;
    this.increment = increment;
    this.maxDd = maxDd;
    this.hardFloor = origin - maxDd;
    this.baseMaxPct = baseMaxPct;
    this.shotMaxPct = shotMaxPct;
    this.L = origin; // base bottom of the active window
  }

  /** Slide the window so the balance sits inside [L, L+2*increment). L rests at the origin while in/under the
   *  floor zone. @param {number} balance */
  update(balance) {
    if (this.increment <= 0) return;
    while (balance >= this.L + 2 * this.increment) this.L += this.increment;
    while (this.L > this.origin && balance < this.L) this.L -= this.increment;
  }

  /** @param {number} balance @returns {string} */
  zone(balance) {
    if (balance < this.hardFloor) return ZoneManager.STOP;
    if (balance < this.origin) return ZoneManager.FLOOR;
    if (balance < this.L + this.increment) return ZoneManager.BASE;
    return ZoneManager.SHOT;
  }

  /** Ladder ceiling for the current zone. FLOOR uses the base ceiling but the ladder is frozen at MIN there.
   *  @param {number} balance */
  activeMaxPct(balance) {
    return this.zone(balance) === ZoneManager.SHOT ? this.shotMaxPct : this.baseMaxPct;
  }

  /** True in FLOOR - ladder held at MIN until back above the origin. @param {number} balance */
  frozen(balance) {
    return this.zone(balance) === ZoneManager.FLOOR;
  }

  /** False below the hard floor - max DD hit, stop trading. @param {number} balance */
  tradable(balance) {
    return this.zone(balance) !== ZoneManager.STOP;
  }

  lines() {
    return {
      hardFloor: this.hardFloor,
      origin: this.origin,
      baseBottom: this.L,
      shotBottom: this.L + this.increment,
      shotTop: this.L + 2 * this.increment,
    };
  }

  toDict() {
    return {
      origin: this.origin,
      increment: this.increment,
      maxDd: this.maxDd,
      baseMaxPct: this.baseMaxPct,
      shotMaxPct: this.shotMaxPct,
      L: this.L,
    };
  }

  /** @param {Record<string, any>} d */
  static fromDict(d) {
    const z = new ZoneManager(
      d.origin ?? 0.0,
      d.increment ?? 0.0,
      d.maxDd ?? 0.0,
      d.baseMaxPct ?? 1.0,
      d.shotMaxPct ?? 1.5,
    );
    z.L = d.L ?? z.origin;
    return z;
  }
}
