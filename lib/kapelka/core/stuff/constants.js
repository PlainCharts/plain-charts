// @ts-check

const SECOND = 1000
const MINUTE = SECOND * 60
const MINUTE5 = MINUTE * 5
const MINUTE15 = MINUTE * 15
const MINUTE30 = MINUTE * 30
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const MONTH = WEEK * 4
const YEAR = DAY * 365

const MONTHMAP = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun","Jul", "Aug",
    "Sep", "Oct","Nov", "Dec"
]

// Grid time steps
const TIMESCALES = [
    YEAR * 10, YEAR * 5, YEAR * 3, YEAR * 2, YEAR,
    MONTH * 6, MONTH * 4, MONTH * 3, MONTH * 2, MONTH,
    DAY * 15, DAY * 10, DAY * 7, DAY * 5, DAY * 3, DAY * 2, DAY,
    HOUR * 12, HOUR * 6, HOUR * 3, HOUR * 1.5, HOUR,
    MINUTE30, MINUTE15, MINUTE * 10, MINUTE5, MINUTE * 2, MINUTE
]

// Grid $ steps
const $SCALES = [0.05, 0.1, 0.2, 0.25, 0.5, 0.8, 1, 2, 5]

/**
 * Chart layout / behaviour constants.
 * @typedef {Object} ChartConfigT
 * @property {number} SBMIN Minimal sidebar px
 * @property {number} SBMAX Max sidebar, px
 * @property {number} EXPAND %/100 of range
 * @property {number} CANDLEW %/100 of step
 * @property {number} GRIDX px, target horizontal spacing per time label
 * @property {number} MIN_LABEL_PX px, min gap before two time labels collide
 * @property {number} GRIDY px
 * @property {number} BOTBAR px
 * @property {number} PANHEIGHT px
 * @property {number} MIN_ZOOM candles
 * @property {number} MAX_ZOOM candles
 * @property {number} VOLSCALE %/100 of height
 */

/** @type {ChartConfigT} */
const ChartConfig = {
    SBMIN: 60,       // Minimal sidebar px
    SBMAX: Infinity, // Max sidebar, px
    EXPAND: 0.15,    // %/100 of range
    CANDLEW: 0.7,    // %/100 of step (candle body width vs bar step)
    GRIDX: 100,      // px  (target horizontal spacing per time label)
    MIN_LABEL_PX: 48, // px  (min gap before two time labels collide and one is dropped; app-overridable)
    GRIDY: 47,       // px
    BOTBAR: 28,      // px
    PANHEIGHT: 22,   // px
    MIN_ZOOM: 25,    // candles
    MAX_ZOOM: 500,   // candles (halved from the author's 1000: tighter over-compression limit)
    VOLSCALE: 0.15,  // %/100 of height
}

export default {
    MINUTE15: MINUTE15,
    HOUR: HOUR,
    DAY: DAY,
    WEEK: WEEK,
    MONTH: MONTH,
    YEAR: YEAR,
    MONTHMAP: MONTHMAP,
    TIMESCALES: TIMESCALES,
    $SCALES: $SCALES,
    ChartConfig: ChartConfig
}
