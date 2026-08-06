// @ts-check
// Entry point: load settings, then init the UI modules. Broker protocols load
// their own wire schema lazily on connect (adapters live in the adapters/ folder).
import { loadSettings, getSetting } from './settings/settings.js';
import { loadVocab, localizeDom } from './i18n/i18n.js';
import { loadAccounts, listAccounts, lastUsed } from './connect/accounts.js';
import { loadMarketHoursStore } from './market/market-hours-store.js';
import { initTimeframes } from './workspace/timeframes.js';
import { initLayout, getActivePane } from './chart/layout.js';
import { bus } from './bus.js';
import { initSavedLayouts, loadLayouts } from './workspace/saved-layouts.js';
import { initChartSettings } from './settings/chart-settings.js';
import { initOptimizationSync } from './settings/sections/optimization.js'; // live cross-window apply of the Optimization knobs
import { initChartDialog } from './settings/chart-dialog.js';
import { initThemeModes } from './settings/theme-modes.js';
import { initChartType } from './settings/chart-type.js';
import { initShiftEnd, initAutoScroll } from './settings/shift-end.js';
import { initBottomBar } from './panels/bottombar.js';
import { loadTemplates } from './settings/templates.js';
import { loadTimezone } from './workspace/timezone.js';
import { loadThemes } from './settings/theme.js';
import { loadChartThemes } from './settings/chart-theme.js';
import { loadTabs, initTabs, getActiveWorkspace } from './workspace/tabs.js';
import { initWorkspaceManager } from './workspace/workspace-manager.js';
import { initBoardSync } from './workspace/study-board-sync.js';
import './workspace/study-board.js'; // TEMP: exposes window.testStudyBoard() for the chart-less board spike
import './assistant/confirm-ui.js'; // approve/deny assistant-placed orders in the focused UI window (execute.confirm)
import './assistant/cmd-ui.js'; // run assistant workspace commands (add study, set symbol/tf) against live panes
import './perf/sampler.js'; // publish this window's live perf sample (Performance Monitor addon reads it)
import './primitives/global.js'; // expose window.Primitives (custom render-primitive authoring) before any study/pack loads
import './studies/global.js'; // expose window.Studies (authoring API) before any study loads
import { loadLibrary } from './studies/library-store.js';
import { loadUserStudies } from './studies/user-loader.js';
import { initStudies } from './studies/ui.js';
import { initStudyTemplates } from './studies/templates-ui.js';
import { loadStudyTemplates } from './studies/templates.js';
import { loadStudyDefaults } from './studies/defaults-store.js';
import './tools/global.js'; // expose window.Tools before any tool loads
import { loadUserTools } from './tools/user-loader.js';
import { loadToolbar } from './tools/toolbar-store.js';
import { loadToolTemplates } from './tools/tool-templates.js';
import { loadToolDefaults } from './tools/tool-defaults.js';
import { loadGlobal as loadSyncedDrawings } from './tools/engine/sync-store.js';
import { initToolbar } from './tools/toolbar.js';
import { initObjects } from './panels/objects.js';
import { initWatchlist } from './panels/watchlist.js';
import { initAlertsPanel } from './alerts/alerts-panel.js';
import { initAlertToasts } from './alerts/toast.js';
import { initAlertDrawingSync } from './alerts/alert-drawing-sync.js';
import { initUndo } from './edit/undo.js';
import { initHotkeys } from './edit/hotkeys.js';
import { initClipboard } from './edit/clipboard.js';
import { initCompare } from './market/compare.js';
import { initToolController } from './tools/controller.js';
import { initConnectDialog } from './connect/connect-dialog.js';
import { initConnStatusChips } from './connect/status-chips.js';
import { initBrokerAlerts } from './connect/broker-alert.js';
import { initAddons } from './panels/addons.js';
import { loadColors } from './ui/colors-store.js';
import { loadPalettes } from './ui/palettes-store.js';
import { broker } from '../data_engine/index.js';
import { upgradeIcons } from './ui/icon.js';
import { log } from './dom.js';

// surface any uncaught error to the Console (Journal) instead of failing silently
window.addEventListener('error', (e) => log('Error: ' + (e.message || e.error), true));
window.addEventListener('unhandledrejection', (e) =>
  log('Error: ' + ((e.reason && e.reason.message) || e.reason), true),
);

// Live vocabulary switch: re-localize the static markup the moment the active pack changes, so a
// pack switch no longer needs a reload. Dynamic surfaces (Trade Desk, watchlist, object tree, alerts,
// addons) re-render themselves off the same 'vocab:changed' event, each where its render is in scope.
bus.on('vocab:changed', () => localizeDom(document));

async function start() {
  try {
    await loadSettings();
    await loadVocab(); // active vocabulary pack -> t() resolves words before any UI renders
    localizeDom(document); // apply the pack to the static HTML top-strip (data-i18n* attributes)
    await loadAccounts();
    await loadMarketHoursStore(); // persisted session open-rules -> panes read them instead of re-fetching
    await loadLayouts();
    await loadTemplates();
    loadTimezone();
    await loadThemes();
    await loadChartThemes(); // sharable chart-style presets (candles + canvas colours)
    await loadLibrary(); // user's indicator favorites + categories
    await loadUserStudies(); // user-authored indicators (before panes restore them)
    await loadUserTools(); // tools (seeded defaults + user-authored), before panes restore drawings
    await loadToolbar(); // user's toolbar layout
    await loadToolTemplates(); // per-tool style/text presets (for the settings dialog)
    await loadStudyTemplates(); // saved indicator-template library
    await loadStudyDefaults(); // per-study saved default settings (applied when a study is added)
    await loadToolDefaults(); // per-tool last-used appearance (applied to new drawings)
    await loadColors(); // recent colours (shared by all pickers)
    await loadPalettes(); // user colour palettes (shared by all pickers)
    await loadSyncedDrawings(); // globally-synced drawings (before panes restore)

    initTimeframes(); // toolbar TF strip + dropdown

    // workspace tabs own the live layout; seed the first tab from old settings
    await loadTabs({
      layout: getSetting('layout') || '1',
      panes: getSetting('panes') || [{ symbol: '' }],
      sync: {
        syncSymbol: getSetting('syncSymbol') !== false,
        syncInterval: getSetting('syncInterval') === true,
        syncCrosshair: getSetting('syncCrosshair') === true,
      },
    });
    initLayout(getActiveWorkspace()); // pane grid built from the active tab
    initTabs(); // tab bar (switch / new / close / rename)
    initWorkspaceManager(); // "+" opens the Workspace Manager (create / open workspaces)
    initBoardSync(); // cross-window study board <-> main chart time-link sync (via ui-bus)
    initSavedLayouts(); // named layout save/load/edit (legacy; superseded by workspaces)
    initChartSettings(); // per-pane gear flyout (lines/labels/scales)
    initOptimizationSync(); // Optimization knobs changed in ANY window apply to this window's panes live
    initChartType(); // toolbar "Chart type" button -> candles/line dialog
    initShiftEnd(); // toolbar "Shift end of chart from right border" toggle
    initAutoScroll(); // toolbar auto-scroll (follow latest bar) toggle
    initChartOrderButton(); // toolbar "Order" button -> order ticket on this chart's broker + symbol
    initStudies(); // indicators button + menu
    initStudyTemplates(); // indicator-templates button + menu
    initToolController(); // active drawing tool + click routing
    initToolbar(); // left tool toolbar + manager
    initObjects(); // right slide-out Object Manager (object tree)
    initWatchlist(); // right slide-out Watchlist
    initAlertsPanel(); // right slide-out Alerts manager
    initAlertToasts(); // in-app toast when an alert fires (listens for the alert-host's fired broadcast)
    initAlertDrawingSync(); // keep a drawing-anchored alert's level in sync when its line is moved
    initChartDialog(); // right-click → full settings dialog + templates + settings rail action
    initThemeModes(); // Light/Dark theme-mode rail toggle (by the camera/gear)
    initUndo(); // drawing-canvas undo/redo (must run after initLayout)
    initHotkeys(); // keyboard shortcuts engine
    initClipboard(); // copy/paste drawing objects (Ctrl+C / Ctrl+V)
    initCompare(); // compare symbols (adds a sub-pane below)
    initBottomBar(); // clock + tz offset
    initAddons();
    initConnectDialog();
    initConnStatusChips(); // top-bar chips: one per connected account (app-lifetime, dialog-independent)
    initBrokerAlerts(); // popup on broker errors (so a failed autoconnect at startup is never silent)
    upgradeIcons(); // mask the static top-strip icons (compare / addons / connect) with the rest
  } catch (e) {
    const err = /** @type {any} */ (e);
    log('Init failed: ' + (err.message || err), true);
    throw e;
  }

  // auto-connect every account flagged for it (multiple brokers at once)
  const auto = listAccounts().filter((a) => a.autoConnect);
  if (auto.length) {
    auto.forEach((acct) => {
      log('Auto-connecting to ' + acct.name + '…');
      broker.connect(acct);
    });
    return;
  }
  // fallback: legacy single global toggle + last-used account
  if (getSetting('autoConnect')) {
    const acct = listAccounts().find((a) => a.name === lastUsed());
    if (acct) {
      log('Auto-connecting to ' + acct.name + '…');
      broker.connect(acct);
      return;
    }
  }

  log('Ready. Click Connect to choose a broker account.');
}

// Toolbar "Order" button: open the standalone order ticket seeded with THIS chart's broker + symbol (the active
// pane). Desktop-only (the ticket is its own OS window); hidden when there's no desktop bridge.
function initChartOrderButton() {
  const btn = document.getElementById('btnChartOrder');
  if (!btn) return;
  const d = /** @type {any} */ (window).desktop;
  if (!d || !d.openOrderTicket) {
    btn.style.display = 'none';
    return;
  }
  btn.onclick = () => {
    const p = /** @type {any} */ (getActivePane());
    d.openOrderTicket(p && p.symbol ? { symbol: p.symbol, broker: p.broker } : {});
  };
}

start();
