// @ts-check
// Example studies the library ships to demonstrate the study capability on its example page.
// They are a gallery, NOT a catalog a host must use — a consumer brings its own studies and just
// uses the library's StudyHost + channels to render them. Importing this file registers the set.
//
//   import { StudyHost, Studies } from 'kapelka/studies';
//   import 'kapelka/studies/modules';      // registers the example studies (sma, rsi, …)
import './sma.js';
import './rsi.js';
import './bollinger.js';
import './volume_delta.js';   // intrabar — lights up when the host supplies a sub-bar provider
import './volume_delta_candle.js'; // the candle variant, on the bottom overlay band
import './volume_profile.js'; // horizontal (hbar) volume-at-price distribution
import './lollipop.js';       // ships its OWN render primitive (custom-series plug-in seam)
import './line_types.js';     // demo: simple / stepped / curved line types on one series
import './marks_demo.js';     // demo: open shapes channel — inline marks + catalog sugar + cross-pane
import './marks_advanced.js'; // demo: the ether at the limit — curve/ring/arrow/bracket/hatch, all as marks
import './shape_lib_demo.js'; // demo: named, reusable shapes — a DATA template + a CODE recipe, placed by params
