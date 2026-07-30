// @ts-check
// Zoom In -- a chart ACTION tool (not a drawing). When active, drag a rectangle over the area you want to
// see; on release the chart fits that TIME range and PRICE range, then reverts to the cursor. It never
// creates a persisted drawing. The drag-rectangle + zoom action are handled in the tools interaction
// engine by kind: 'zoom' (src/tools/engine/interaction.js). Reset the price axis to auto-fit by
// double-clicking the price scale, as usual.
Tools.register({
  id: 'zoom',
  glyph: '⌕', // magnifier glyph
  kind: 'zoom',
});
