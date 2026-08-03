// @ts-check
// ipc-contract.js -- the canonical declaration of the APP's cross-window communication (window <-> window,
// over BroadcastChannel). Every channel and the shape of the messages it carries is declared HERE, in one
// place, instead of being inferred from each producer. This file is DECLARATION ONLY: channel-name constants
// + message typedefs. It changes no behaviour -- channel owners can import IPC.* for the names (one source
// of truth) and annotate their messages against these typedefs.
//
// The EXECUTION ENGINE's channels (broker-bus, order-bus, the platform store/channel prefixes) are declared
// in data_engine/ipc.js -- they belong to the engine, not the app. The OTHER IPC axis -- renderer <-> main
// (Electron) -- is a separate surface: `window.desktop`, typed by `src/desktop.d.ts` (DesktopApi). Window
// management, OS controls, file dialogs. Not this file.
//
// Channels (each a self-contained mini-protocol):
//   ui-bus                UI coordination: theme, chart template, study-board range/crosshair/presence
//   drawing-clipboard     copy/paste drawings across windows
//   assistant-confirm     order worker <-> UI: approve/deny an assistant-placed order (execute.confirm)
//   alert-bus             surfaces -> alert-host: semantic alert COMMANDS + acks (the Alert engine, app-layer;
//                         mirrors the engine's order-bus but is app-owned since alerts are not engine code)
//   alert-store           alert-host -> windows: authoritative alert-rule state replication (set/remove/reset).
//                         ONE writer (the host); every other window holds a read-only mirror (unidirectional flow)

/** The app's cross-window channel names. */
export const IPC = {
  ORDER_PLAN: 'order-plan', // surfaces -> chart overlays: PLAN drawing requests (gray projection etc.), keyed by broker+symbol; pure UI, never touches the book
  UI_BUS: 'ui-bus',
  DRAWING_CLIPBOARD: 'drawing-clipboard',
  ASSISTANT_CONFIRM: 'assistant-confirm',
  ASSISTANT_RELOAD: 'assistant-reload', // addon-host -> UI: reload a study file the assistant just wrote
  ASSISTANT_CMD: 'assistant-cmd', // addon-host -> UI: run a live workspace command (add study, set symbol/tf) + reply
  ASSISTANT_INJECT: 'assistant-inject', // chart window -> AI Workspace: inject context text into its terminal prompt
  ALERT_BUS: 'alert-bus', // surfaces -> alert-host: semantic alert COMMANDS + acks (the Alert engine)
  ALERT_STORE: 'alert-store', // alert-host -> windows: authoritative alert-rule state replication (read-only mirrors)
  ALERT_FIRED: 'alert-fired', // alert-host -> windows: an alert fired; visible windows show an in-app toast
  ALERT_LOG: 'alert-log', // alert-host -> windows: the persistent fire LOG (the mailbox) -- an ordered capped ring, read-only mirrors (push/clear/reset)
};

// ---------------------------------------------------------------------------------------------------
// ui-bus -- UI coordination. NOTE two discriminators are in use: `type` (theme / chart template) and `t`
// (study-board messages). Documented as-is; unifying them would be a follow-up, not a contract change.
// ---------------------------------------------------------------------------------------------------
/** theme + optimization broadcasts (re-skin / re-throttle every other window).
 * @typedef {{ type: 'theme', name: string } | { type: 'optimization' }} UiThemeMsg */
/** money-management config sync: a save in one window carries the NEW store (name -> config) to every other
 * window's warm copy (order worker, ticket) -- no polling.
 * @typedef {{ type: 'mm-config', store: Record<string, any> }} UiMMConfigMsg */
/** study-board sync: range/crosshair/presence. `sb-*range`/`sb-*cross` share time/price; board variants
 * (`sb-b*`) target a linked anchor via `to`, non-board variants carry `ws` + `pane`.
 * @typedef {{ t: ('sb-range'|'sb-cross'|'sb-presence'), ws: string, pane?: number, range?: any, time?: any,
 *   price?: any, panes?: any } | { t: ('sb-brange'|'sb-bcross'), to: any, pane: any, range?: any, time?: any,
 *   price?: any }} UiBoardMsg */
/** @typedef {UiThemeMsg | UiBoardMsg | UiMMConfigMsg} UiBusMsg */

// ---------------------------------------------------------------------------------------------------
// drawing-clipboard -- share the copy buffer (an array of drawing records) with every other window.
// ---------------------------------------------------------------------------------------------------
/** @typedef {{ clip: any[] }} ClipboardMsg */

// ---------------------------------------------------------------------------------------------------
// assistant-confirm -- the data host asks a UI window to approve an assistant-placed order (when
// execute.confirm is on); the focused window replies. `cancel` is sent on timeout so any open modal dismisses.
// ---------------------------------------------------------------------------------------------------
/** @typedef {{ type: 'request', id: number, method: string, order: any, brokerId: (string|null) }
 *   | { type: 'reply', id: number, approved: boolean } | { type: 'cancel', id: number }} AssistantConfirmMsg */
