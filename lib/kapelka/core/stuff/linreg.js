// @ts-check
/**
 * Simple linear regression
 *
 * Author's `@param` says `Array.<number>` but `data` is immediately reassigned
 * to an `Array.<[number, number]>` (indexed pairs), so it is typed `any` to let
 * the in-body reshape type-check without altering the author's code.
 *
 * NOTE: the author also shadows the `len` parameter with an inner `var len`
 * (`var i = 0, len = data.length`); typing `len` as `any` avoids the
 * redeclaration-type conflict without touching the code.
 *
 * @param {any} data
 * @param {any} len
 * @param {number} offset
 * @return {number}
 */
export default function regression(data, len, offset) {

    // the author's reshape is intentionally dynamic: [value...] -> [index, value] pairs for the regression
    data = data.slice(0, len).reverse().map((/** @type {number} */ x, /** @type {number} */ i) => [i, x])

    var sum_x = 0,
        sum_y = 0,
        sum_xy = 0,
        sum_xx = 0,
        count = 0,
        m, b

    // calculate sums
    for (var i = 0, len = data.length; i < len; i++) {
        if (!data[i]) return NaN
        var point = data[i]
        sum_x += point[0]
        sum_y += point[1]
        sum_xx += point[0] * point[0]
        sum_xy += point[0] * point[1]
        count++
    }

    // calculate slope (m) and y-intercept (b) for f(x) = m * x + b
    m = (count * sum_xy - sum_x * sum_y) / (count * sum_xx - sum_x * sum_x)
    b = (sum_y / count) - (m * sum_x) / count

    return m * (data.length - 1 - offset) + b

}
