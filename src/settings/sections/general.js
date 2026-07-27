// @ts-check
// Settings -> App -> General: the everyday app-preference knobs gathered into one section instead of three tiny
// ones. Pure COMPOSITION -- it renders the three existing domain sections in order, each of which owns its own
// controls and subsection headers:
//   Tabs       -> ON STARTUP + TAB TITLE (what the chart tabs show, session restore)
//   Layout     -> DEFAULT LAYOUT FOR NEW TABS + DEFAULT CHART TEMPLATE
//   App time   -> TIME (in-app date/clock/timezone display -- the one every app surface formats through)
//   Vocabulary -> VOCABULARY (wording packs)
// Each keeps its own module and other exports; nothing here reaches into a domain.
import * as tabs from './tabs.js';
import * as layout from './layout.js';
import * as appTime from './app-time.js';
import * as vocab from './vocab.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  tabs.render(ctx);     // ON STARTUP + TAB TITLE
  layout.render(ctx);   // DEFAULT LAYOUT FOR NEW TABS + DEFAULT CHART TEMPLATE
  appTime.render(ctx);  // TIME (in-app date/clock/timezone)
  vocab.render(ctx);    // VOCABULARY
}
