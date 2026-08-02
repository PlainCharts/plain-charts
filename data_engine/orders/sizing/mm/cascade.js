// @ts-check
// Cascade ladder -- the Defensive Recovery risk model (the MIN/MID/MAX rung inside a zone).
// Pure logic: no broker, no store, no DOM.
//
// Three risk levels, derived from a single top percent by halving:
//   MAX (e.g. 2.0%)  start here on a fresh account
//   MID (MAX / 2)
//   MIN (MAX / 4)    floor
//
// Risk per trade ($) is always derived live: level_pct% x current_balance.
//
// Every loss cuts risk one level (MIN is the floor). To climb one level you must accumulate half the nominal
// risk of the level you are climbing into:
//   gate into level T = 1/2 x T_pct% x balance
// Wins accumulate; overflow carries to the next gate; only excess at MAX is discarded.
//
// Breakeven band: a result inside +/- be_threshold dollars is breakeven -- no climb, no drop. Only a result
// above the band is a win; only below it a loss.
//
// Base override: base = initial account balance. While current balance is below base the trader is locked at
// MIN and cannot climb. Crossing back above base re-arms the upper levels.

export class CascadeMM {
  static MIN = 0;
  static MID = 1;
  static MAX = 2;
  /** level index -> name */
  static LEVEL_NAMES = ['MIN', 'MID', 'MAX'];

  /**
   * @param {number} [maxPct] top risk percent; MID and MIN are derived (max/2, max/4)
   * @param {number} [base] initial account balance (static); below it -> locked at MIN
   * @param {number} [beThreshold] dollar dead zone around zero (breakeven band)
   */
  constructor(maxPct = 2.0, base = 0.0, beThreshold = 25.0) {
    // Halving cascade: the user sets only the top risk. MID and MIN are derived so every loss halves risk.
    this.maxPct = maxPct;
    this.midPct = maxPct / 2.0;
    this.minPct = maxPct / 4.0;
    this.base = base; // initial account balance (static)
    this.beThreshold = beThreshold; // dollar dead zone around zero

    this.currentLevel = CascadeMM.MAX; // fresh account starts at full risk
    this.progress = 0.0; // $ accumulated since last loss
  }

  /** @param {number} level @returns {number} */
  _pctForLevel(level) {
    return [this.minPct, this.midPct, this.maxPct][level];
  }

  /** Dollar progress needed to climb into the given level. @param {number} level @param {number} balance */
  gateInto(level, balance) {
    return 0.5 * (this._pctForLevel(level) / 100.0) * balance;
  }

  /** @returns {string} */
  get levelName() {
    return CascadeMM.LEVEL_NAMES[this.currentLevel];
  }

  /** Effective risk percent for the next trade (honours base override). @param {number|null} [balance] */
  currentPct(balance = null) {
    if (balance !== null && balance < this.base) return this.minPct;
    return this._pctForLevel(this.currentLevel);
  }

  /** Dollar amount to risk on the next trade. @param {number} currentBalance */
  riskUsd(currentBalance) {
    return (this.currentPct(currentBalance) / 100.0) * currentBalance;
  }

  /**
   * Record a completed trade and update level/progress.
   * @param {number} netProfit realized $ result of the trade
   * @param {number} currentBalance account balance after the trade closed
   */
  recordTrade(netProfit, currentBalance) {
    let climbed = false;
    let dropped = false;

    // Base override: while underwater the trader is locked at MIN -- no climbing is possible.
    if (currentBalance < this.base) {
      dropped = this.currentLevel > CascadeMM.MIN;
      this.currentLevel = CascadeMM.MIN;
      this.progress = 0.0;
      return this.toDict(false, dropped);
    }

    if (netProfit > this.beThreshold) {
      // WIN. Progress only exists above base. On a trade that crosses up from below base, only the portion
      // above base counts -- the part that merely restored the account to base is not climb progress.
      const preBalance = currentBalance - netProfit;
      const credit = preBalance < this.base ? currentBalance - this.base : netProfit;
      this.progress += credit;
      while (this.currentLevel < CascadeMM.MAX) {
        const gate = this.gateInto(this.currentLevel + 1, currentBalance);
        if (this.progress >= gate) {
          this.progress -= gate;
          this.currentLevel += 1;
          climbed = true;
        } else {
          break;
        }
      }
      if (this.currentLevel === CascadeMM.MAX) {
        this.progress = 0.0; // nothing above to carry to
      }
    } else if (netProfit < -this.beThreshold) {
      // LOSS
      if (this.currentLevel > CascadeMM.MIN) {
        this.currentLevel -= 1;
        dropped = true;
      }
      this.progress = 0.0;
    }
    // else: breakeven band -> no change

    return this.toDict(climbed, dropped);
  }

  /** Reset to a fresh-account state. */
  reset() {
    this.currentLevel = CascadeMM.MAX;
    this.progress = 0.0;
  }

  /** @param {boolean} [climbed] @param {boolean} [dropped] */
  toDict(climbed = false, dropped = false) {
    return {
      maxPct: this.maxPct,
      midPct: this.midPct,
      minPct: this.minPct,
      base: this.base,
      beThreshold: this.beThreshold,
      currentLevel: this.currentLevel,
      levelName: this.levelName,
      progress: this.progress,
      climbed,
      dropped,
    };
  }

  /** @param {Record<string, any>} d */
  static fromDict(d) {
    const mm = new CascadeMM(d.maxPct ?? 2.0, d.base ?? 0.0, d.beThreshold ?? 25.0);
    mm.currentLevel = d.currentLevel ?? CascadeMM.MAX;
    mm.progress = d.progress ?? 0.0;
    return mm;
  }
}
