// @ts-check
// Shared helper for building a NEW drawing's start-style (used by the create + measure gestures).
// Kept in its own module so both mixins can import it without cycling through interaction.js.

// Build the start-style for a NEW drawing: last-used appearance (tool-defaults) over the
// built-in defaultStyle, but with the tool's IDENTITY keys forced back from defaultStyle.
// Identity keys (e.g. `extend` for the trend-line family: none/right/both) define WHICH tool
// this is, not its appearance -- persisting them would let a ray contaminate the plain
// trendline default. Like geometry, they never come from the saved appearance.
/**
 * @param {{ defaultStyle: Record<string, any>, identityStyle?: string[] }} tool
 * @param {Record<string, any>|undefined|null} savedStyle
 * @returns {Record<string, any>}
 */
export function mergeToolStyle(tool, savedStyle) {
  const style = { ...tool.defaultStyle, ...savedStyle };
  const identity = tool.identityStyle;
  if (identity) for (const k of identity) style[k] = tool.defaultStyle[k];
  return style;
}
