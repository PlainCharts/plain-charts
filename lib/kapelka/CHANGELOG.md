# Changelog (draft)

<!-- NOTE TO CLAUDE / FUTURE ME: Put EVERY changelog entry HERE, in this root file only.
     NEVER touch the docs-site changelog (docs/web/src/pages/docs/changelog.md) — the author
     curates and publishes that one by hand. New work goes under [Unreleased] below. -->

Working log for the engine. Ongoing changes land here first; curated entries are later
folded into the published changelog on the website (`docs/web` → /docs/changelog) — by the
author, by hand. Do not edit that page.

## [Unreleased]

### Fixed
- Price-line tag chips (the `Bid`/`Ask` badges poking out of the price scale) no longer ghost or stack on
  fast quote updates. The chip was painted on the data sheet (gridCv), cleared only on a full redraw; a
  quote tick repaints via the objects tier, which never clears that sheet, so each tick stamped a new chip
  and left the previous one at the old price -- the "triple tag". The chip now paints on the objects sheet
  (objCv) with the price line it belongs to, cleared every objects frame right before the tag pass, so it
  tracks the line in lockstep. The price box stays on the sidebar canvas.

### Added
- Branded coordinate types: `Price`, `TimeX` (time-or-index x value), `XPx`, `YPx` in
  `core/types.js` -- strict nominal brands on the GridLayout/ScaleView mapper signatures
  (t2screen/screen2t/$2screen/screen2$), with `_gridAt`/`_gridOf` returning typed grids instead of
  `any`. The checker now separates price/time/pixel spaces between typed values; reach grows
  automatically as `any` boundaries shrink. Produce a brand with a cast at the conversion source.
- Primitive autoscale votes: an attached primitive may implement `autoscaleInfo()` ->
  `{ priceRange: { minValue, maxValue } } | null` and a price line may set `autoscale: true`; both
  extend the pane's auto-range as if they were data, BEFORE a study `scale` fn shapes/locks it (a
  pinned oscillator stays pinned) and never against a manually dragged scale. Opt-in: nothing votes
  by default, so behavior is unchanged until a feature adopts it.
- Hit-test arbitration: a primitive hit may carry `hitTestPriority` (point 2 > line 1 > range 0) and
  `distance` (px from cursor). Resolution is priority desc, then distance asc, then zOrder desc --
  overlapping objects resolve deterministically. Hits without the fields behave exactly as before.

### Changed
- Anchored objects paint on their own sheet: each pane's stack is now three canvases -- data
  (gridlines, candles, series, markers), objects (price lines + primitives: drawings, alert/order
  lines), crosshair. The scheduler gains an objects-only tier between full and cursor-only: a price
  line move (addLevel configure) or a primitive's repaint request (drag preview, hover pill)
  repaints just the objects sheet + axes + cross -- dragging a line no longer repaints every candle
  per move. Full paints repaint all three sheets, so objects stay glued through pan/zoom/ticks.
  A paneView sent to back ('bottom' zOrder) paints on the DATA sheet; the requesting primitive is
  checked and falls back to a full paint only when its own bottom view has content -- a bottom view
  can report `isEmpty()` (the study-marks primitive does; a view that can't is assumed non-empty).
- The crosshair paints on its own overlay canvas per pane (created above the grid canvas,
  pointer-events none), and a cursor-only repaint path joins the scheduler: a pointer move or a
  programmatic cross (setCursor / cross-pane sync / setCursorSnapX) now repaints just the cross
  layers + the axis bars (price/time bubbles) -- the grid canvases (candles, series, drawings,
  separators) keep their last paint. Before, every crosshair move re-cleared and re-painted every
  overlay on every pane; in a split layout one mouse move fully repainted all charts. Pan/zoom/data
  still take the full path; the separator hover highlight (drawn on the grid canvas) forces a full
  paint only on a hover-state flip. Snapping is untouched -- the cursor updater still computes the
  bar-snapped x; only the paint target changed. `snapshot()` (the raw grid canvas) no longer bakes
  in the crosshair.
- `Series.feed` no longer re-sorts input that already arrives in order: one O(n) ascending pass detects it and
  the O(n log n) sort runs only as a fallback. Equal timestamps keep input order on both paths (Array.sort is
  stable), so behavior is identical — the app always feeds sorted history, making the sort pure waste on the
  hot path. Pairs with the app's incremental tick feed, which routes live ticks through the existing `feedBar`
  fast path instead of `feed`.

### Added

- RSI joins the series studies: converted from whole-array `calc` to the streaming `step` contract (Wilder's
  running averages as checkpointable state), byte-identical to before. This adds a `scale` channel to the step
  contract — a study can lock its pane range (RSI to 0–100) via a `scale()` method, computed once like `shapes`
  / `fills`, so oscillators stream without their pane drifting.
- Streaming study compute: a step study now advances ONE bar per live tick instead of re-traversing all bars.
  The worker keeps each study's state resident at the last closed bar (a checkpoint) and, on a tick, restores
  it and re-steps only the forming bar -- O(1) per tick, not O(bars). On a bar close it commits the closed bar
  into the checkpoint and steps the new forming bar. The host sends a single candle in (update-forming-bar /
  append-bar, classified from the previous bars -- anything ambiguous falls back to a full set-bars) and gets a
  single point out (fed by time: replace the last row or append), so a tick touches the last point only -- no
  metas, panes, scales, shapes, or primitives rebuilt. State is snapshotted generically (plain values deep-
  copied, pure closures kept by reference), so a study just keeps its accumulators in plain fields; `ma_ribbon`'s
  MA runners moved from closures to plain state for this. Line-to-line `fills` stream too (VWAP, Bollinger): the
  band's last point is re-paired from the streamed tail, so the shaded region follows the tick without a rebuild.
  This draws a strict line: a study is SERIES (streams) when every output resolves to a per-bar point -- plot
  values, per-point segments/wicks/lines, line-to-line fills, static level lines; it is GEOMETRY (always full)
  when it emits a multi-bar shape with no single last bar (a box over an OB/OS run, a session strip, a viewport
  surface -- FVG, %R Terrain, the Day/Session/Time markers, %R Trend Exhaustion). Full recompute remains the
  path on symbol change, backfill, and settings. Verified byte-identical to a full recompute at every forming
  and close tick -- series, intrabar, and fill studies -- driving the real worker end to end.

### Fixed

- Resident sub-bar merge in the study worker duplicated the forming sub-bar. Its tail-append fast path pushed
  an incoming batch without deduping, so a live feed re-sending the forming minute every tick (sometimes
  repeated within one batch) piled same-time rows up without bound. The last chart bar's bucket is open-ended,
  so the pile inflated only that bar -- an intrabar study (e.g. Up/Down Volume + Absorption) drew one giant
  forming bar worth millions that pinned the pane scale and flattened every real bar to the zero line. The
  merge now keys by time every call (deduped, incoming wins), matching the host's own `mergeBars` exactly, so
  the worker's resident sub-bars stay identical to the host cache. Latent since the resident redesign; surfaced
  once intrabar studies began reading the resident sub-bars directly.

### Changed

- Study worker now OWNS its data resident instead of receiving a full snapshot per study. The host uploads
  bars once and streams small mutations (set-bars, append-intrabar); an exec carries meta only, and the
  worker derives calcBars and buckets intrabar from its own resident state. Stacking intrabar studies no
  longer clones the sub-bar payload per study every tick -- measured ~2.8 MB/message down to ~460 bytes,
  and a pane that pegged a core at 98% with 4 intrabar studies now carries many times that load in the low
  double digits. Behavior-preserving: studies still receive the same calc(bars, params, ctx).
- Study compute moves toward one shared read window: the worker builds a single column-array window
  (time/open/high/low/close/volume) once per data change; a study exposing `step(i, shared)` reads it as a
  pure consumer, while unconverted studies keep running whole-array `calc` over the resident bars.
- The step contract gains three capabilities so series studies with richer output convert cleanly: a `fills()`
  channel (a shaded band naming two plot keys, computed once), `init(params, ctx, shared)` so a study can do
  a window-wide precompute (e.g. a "recent days" cutoff read off the last bar), and a sparse `openInterest`
  column on the shared window. Two study forms now coexist by design — per-bar `step` for series studies and
  whole-array `calc` for geometry/viewport studies (boxes, session markers, animated terrain); both are pure
  consumers of the worker's resident pool, so `calc` is a first-class form, not a compatibility shim.

### Removed

- Per-study `maxBars` cap and the universal higher-timeframe (`__tf`) study control. Both fought the single
  shared-window model, and `maxBars` was a band-aid for the old snapshot recompute that no longer exists.
  Studies now compute over the full loaded bars. Removed from the host, worker, four bundled studies, and the
  study settings UI; re-introduce on top of the shared model later if wanted.

### Added

- `setPaused(bool)` -- a paint gate. While paused, feeds and updates still apply to the data model (reads
  stay current) but no paint runs; resuming replays one catch-up paint if anything changed. Lets the host
  stop an off-screen chart (e.g. a split pane hidden behind a maximized sibling) from burning render CPU
  for zero visual output. Mirrors the existing `conflate` semantics (data immediate, cadence bounded).
- `setCursorSnapX(fn|number|null)` pins the cursor's VERTICAL line to a screen x (the horizontal price line still
  tracks the mouse y), for snapping the crosshair onto a grabbed time-anchored object instead of letting it wander
  in the whitespace. Pass a getter for a live value that tracks pan, a fixed number, or null to release. Applied in
  the active-cursor path after the whitespace override.
- Universal study Timeframe (higher-TF compute). Any study can be computed on a coarser timeframe than the
  chart without declaring anything: the host reads a reserved `__tf` param (target seconds) and, when it
  exceeds the chart's own bar step, aggregates the chart bars up (`aggregateBars`, clock-bucketed OHLCV) and
  runs `calc` on the coarser series -- on both the worker and inline paths. Line-ish plots are step-hold
  forward-filled back onto chart bars with no lookahead (`forwardFillPlots`: a value appears only once its
  HTF bar has closed); time-anchored shapes need no remap. `ctx.timeframe` exposes the active TF (seconds) or
  null. Rolls up from chart bars (higher TF only); the host deals only in seconds and owns no timeframe
  vocabulary, so calendar/session alignment for daily+ is the caller's concern (the app offers intraday TFs
  for now). Not combined with lower-TF `intrabar` (skipped while a higher TF is active). Helpers in
  `studies/channels.js`.

- Studies can run their `calc` OFF the render thread. A host that sets `opts.worker` + `opts.studyUrl(id)`
  routes each eligible study's pure `calc(bars, params, ctx)` to a background Web Worker (a `StudyWorker`
  transport + a generic `worker.js` runtime). The worker is a plain engine capability -- it hardcodes no
  study: it dynamic-imports each study by URL (the study self-registers via the shared `Studies` surface,
  exactly as on the main thread), runs its calc, and posts the pure render channels back for the main thread
  to draw. One worker per host, spawned lazily and terminated when no worker study remains (and on host
  teardown). Eligible = enabled + not `worker:false` + not a `requestFrames` frame-clock study; a
  per-attachment seq drops a stale result a newer recompute superseded. NO inline fallback -- a worker
  failure surfaces as a study error, never a silent inline re-compute that would mask a broken worker.
  Pattern adapted from trading-vue-js's Web Worker script engine (author C451).

- Studies can cap how many recent bars `calc` runs over via a `maxBars` param (a user setting the study
  exposes). The host windows the input to the last N bars -- and the bucketed intrabar with it -- so a
  heavy per-bar study doesn't loop over the whole loaded history every tick on a deep, cache-seeded chart.
  `0` / unset = no cap; range/marker studies simply don't expose the input.

- Studies receive the instrument tick size via `ctx.tickSize` — the min price increment (e.g. `0.25` for
  ES), for tick- and pip-aware studies. It is deliberately separate from `ctx.decimals`, since the tick
  is not `10^-decimals` (ES prints 2 decimals but ticks in `0.25`). `null` when unknown; fed through the
  host `opts.tickSize` / an overridable `_tickSize()` accessor.

- Future whitespace / gapless future axis (index-based mode) — `buildLayout` accepts a `future` array of
  whitespace rows `[t, null, null, null, null, null]`, fed via a new `chart.setFutureWhitespace(times)`
  API. They're appended to the indexed stream, so `i2t`/`t2i` resolve future indices by lookup instead of
  linear-extrapolating real clock time. The future now collapses weekend/session gaps exactly like the
  past (which has no bars there), matching Lightweight-Charts, which indexes app-supplied whitespace the
  same way. Whitespace rows paint no candle and are excluded from the price auto-scale (`null` values are
  skipped in the range scan); the real-bar array is untouched, so last-price / legend reads are unaffected.

- Tick-size price formatting — a series `priceFormat.minMove` (with `precision`) now snaps every price
  the engine prints to the instrument's tick grid: the crosshair price label, price-axis ticks, the
  last-value tag and price-line tags. `minMove` was previously accepted but ignored (prices were only
  fixed to `precision` decimals), so a value between ticks could show off-grid. Applies per price scale —
  the main price scale quantizes; study and percentage/indexed scales are unaffected.

- Shift + wheel scrolls the time window left/right without zooming — a native engine navigation gesture
  in the wheel handler (gated by `handleScroll`, not `handleScale`). Wheel down = forward, ~5% of the
  visible window per notch; the range shift matches touch/drag pan (whitespace allowed). Previously this
  lived only in the app as a capture-phase wheel interceptor.

### Changed

- The studies subsystem no longer imports the `Chart` shell (`index.js`) for series-type tags. `studies/channels.js`
  and `studies/host.js` now import `Line`/`Columns`/`Area`/`Baseline`/`Segments`/`HBars` from the `core/enums.js`
  leaf where they are defined, instead of the re-export off the 728-line shell. Removes the only upward dependency
  edge from studies onto the shell (a stable-dependencies fix: studies depended on the most volatile module purely
  for constants). No behaviour change; same enum objects, different source path.

- De-monolithed the `Chart` shell (`index.js`) by lifting two cohesive clusters into their own modules,
  no behaviour change. `core/time-axis.js` holds the time/index/zoom/range logic: the layout-unit <->
  time/logical coordinate transforms, fit-to-data + append auto-scroll, the zoom-bound clamps the native
  input drives (`_maxZoom`/`_minZoom`/`_maxVZoom`/`_visibleHiLo`/`_visibleCount`/`_clampZoom`/`_clampVZoom`),
  `_emitRange`, and the public `timeAxis()` API object. `core/panes.js` holds the pane lifecycle + layout
  geometry + pane-ops surface (`_offcharts`, `_ensurePanes`/`_makePane`/`_destroyPane`, `_sizeLayers`/
  `_place`, `_resetPanes`, `panes()`/`removePane`/`_movePane`/`addPane`). Each entry takes the chart
  reference `c`; the `Chart` keeps thin delegators so its own render loop and external callers (input.js /
  series.js / events.js) reach them unchanged. Bodies moved verbatim (`this` -> `c` only). 977 -> 727 lines
  in `index.js`; four now-dead imports dropped. Verified live by driving the engine directly (multi-pane
  build, full timeAxis API, min/max zoom clamps hitting the exact MIN_ZOOM/MAX_ZOOM bounds, removePane).
- Split `grid_maker.js` (the per-pane grid-geometry builder) by responsibility into three modules with no
  behaviour change. The x-axis time-tick family (`grid_x` + `time_step`/`insert_line`/`extend_left`/
  `extend_right`) moved verbatim to `core/components/js/grid-x.js`; the y-axis price-tick family (`grid_y`/
  `grid_y_pct`/`grid_y_log` + the `dollar_*`/`search_start_*`/`log_rounder`/`calc_precision` helpers) moved
  verbatim to `grid-y.js`. `grid_maker.js` stays the orchestrator (range/sidebar/precision/positions + the
  `create()` sequence) and hands both families a shared context `G` (the same mutable `self` output bag plus
  the pane's params), so every tick they compute still lands on the object it returns. 737 -> 286 lines in
  the core file. Verified live (linear/grid + time axis render and recompute on zoom; no errors).
- Renamed the engine `dubhe` -> `kapelka`: the `package.json` name, the repository + homepage URLs, the
  GitHub repo (`ether-strannik/kapelka`), the demo/example titles and code comments. The public API is
  unchanged. (Consumers importing by a package alias should update `dubhe` -> `kapelka`.) Historical
  entries below keep the old name -- they record what happened at the time.
- Skin CSS is now brand-agnostic: every `dubhe-*` class and `--dubhe-*` CSS variable is renamed to `skin-*`
  / `--skin-*` (and the injected `<style>` id `dubhe-skin-styles` -> `skin-styles`). The namespace now
  describes the layer, not the library, so renaming the repo never touches CSS again. BREAKING for any
  consumer that styled the old `.dubhe-*` classes or set `--dubhe-*` theme vars -- switch them to `skin-*`.
- Intrabar (lower-timeframe) data now follows a push model, the LWC way. History is fetched ONCE over a
  bounded window -- the last N main bars (default 750, `opts.intrabarMaxBars`), not the whole loaded
  history -- and live updates arrive via a streaming subscription (`opts.subscribeIntrabar` /
  `dropIntrabar`), not a re-download on a timer. An idle chart makes ZERO intrabar requests; the forming
  bar's sub-bars are pushed per tick. Previously the layer pulled the entire loaded history up front (tens
  of thousands of sub-bars) and re-fetched the tail every ~3s.

### Removed

- Slimmed the render-input surrogate (`_comp`) of its last Vue-reactivity shims. The main comp's `$emit`
  (a no-op ever since the interaction half of the render classes was removed) is gone, and its `$set`
  (`(o,k,v) => o[k]=v`) is inlined at its one caller -- `CursorUpdater` now writes `cursor.values[grid.id]`
  directly. The dead `$props.y_transform` field (unread once the sidebar/grid drag code went) is dropped.
  The `Comp` / `CompProps` typedefs are updated to match. The live overlay-shader path (`price.js` ->
  the separate `_ov` surrogate's `$emit`) is untouched. Verified live: the cursor still populates
  `cursor.values` for every pane and the chart renders unchanged.
- Dead Vue/Hammer-era interaction code purged from the render classes now that native input lives entirely
  in the engine shell (`core/components/input.js`). `Grid` loses its event half (`listeners`, the
  `gesture*`/`mouse*`/`touch2mouse`/`sim_mousedown`/`click` handlers, `emit_cursor_coord`, `pan_fade`,
  `calc_offset`, `new_layer`/`del_layer`/`show_hide_layer`, `mousezoom`/`mousedrag`/`pinchzoom`/
  `trackpad_scroll`, `change_range`, `propagate`, `destroy`) — it is now purely the pane background painter
  (grid lines, shader pass, overlay z-stack, crosshair). `Sidebar` loses `calc_zoom`/`calc_range`/
  `rezoom_range` (transcribed into the shell's wheel/drag path) plus its empty `mouse*`/`listeners`/
  `destroy` stubs; `Botbar` loses its empty `mouse*` stubs. All were unreachable: `$emit` is a no-op in the
  vanilla surrogate and nothing external called them (grep-proven).
- Deleted the unused drawing primitives `pin.js`, `line.js`, `ray.js`, `seg.js` (the app draws through its
  own `src/tools` engine) and `stuff/frame.js` (`FrameAnimation`, only referenced by the removed `pan_fade`).
- Pruned now-orphaned helpers from `stuff/utils.js` (`get_day`, `overwrite`, `copy_layout`, `get_num_id`,
  `fast_filter_i`, `now`, `pause`, `smart_wheel`, `get_deltaX`/`get_deltaY`, `apply_opacity`, `parse_tf`,
  `measureText`, `uuid`/`uuid2`, `warn`, `is_scr_props_upd`, `delayed_exec`, `format_name`, `xmode`,
  `default_prevented`, `is_mobile`) and from `stuff/constants.js` the unused Vue-era `ChartConfig` keys
  (toolbar/legend-button/scroll-wheel/zoom-mode fields), `MAP_UNIT`, `IB_TF_WARN`, and time constants no
  longer referenced. ~1240 lines removed overall; no public API or behaviour change.

### Fixed

- Overlay-legend hover controls no longer flicker. The legend rebuilt its whole DOM on every crosshair
  move and every study recompute (constant with live data), and a rebuilt element loses its CSS `:hover`
  state until the next mouse event -- so the hover-revealed icons (hide / settings / remove) blinked under
  the cursor and could not be clicked reliably. The render is now incremental: the DOM is rebuilt only
  when the STRUCTURE changes (overlay list, hidden/error state, colors, collapse state, label); value
  ticks and crosshair moves update the value spans in place. Verified via a CDP mutation probe: 40
  synthetic crosshair moves caused 100 DOM mutations before, 0 after.

- Hidden / collapsed studies no longer compute or hold data. `recompute` early-returns for any study that
  is not shown (per-study eye toggle, collapsed pane, or the global indicators toggle), and its intrabar
  subscription is dropped (`_reconcileIntrabar`) -- a hidden study on a deep chart previously kept running
  its full `calc` and streaming sub-bars every tick, invisibly. Un-hiding recomputes once and re-subscribes
  (`refreshVisibility`).

- Shared candle-series markers are no longer wiped by a study recompute. An overlay-shape study with no
  plot series of its own borrows the main candle series for `setMarkers`; that series' markers are shared
  with the trade-execution overlay, so a `setMarkers([])` on every recompute erased the trade marks (they
  flashed, then vanished). The borrowed main series is now touched only when the study actually has
  markers; a study's own plot series it still sets/clears freely.

- Off-range price-axis labels now hide instead of stacking at the edge. A price line's tag (and the
  last-value tag) is dropped once its price scrolls out of the visible range, rather than being clamped
  back into view by the label declutter (`drawAxisViews`/`stackTags`). Matches Lightweight-Charts, which
  draws at the true coordinate and lets the canvas clip off-screen labels away.
