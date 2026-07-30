// @ts-check
// ipc.js -- the ENGINE's cross-window channels (window <-> window, over BroadcastChannel). These four
// mini-protocols belong to the execution engine: the data bridge (broker-bus), the order worker's command
// bus (order-bus) and the platform store/channel replication prefixes. Channel names + message typedefs,
// declaration only. App-owned UI channels (ui-bus, drawing-clipboard, assistant-*) live in
// src/ipc-contract.js -- the two never share a constant.
//
// Channels (each a self-contained mini-protocol):
//   broker-bus            broker RPC: proxy -> host method calls + results + adapter state snapshot
//   order-bus             surfaces -> order-host: semantic order COMMANDS + acks (the Order Worker)
//   platform:store:<name> keyed live-state replication (one channel per store: orders/fills/positions/accounts)
//   platform:ch:<name>    append streams (one channel per channel: console)

/** The engine's cross-window channel names. `*_PREFIX` are joined with an instance name (store/channel id). */
export const IPC = {
  BROKER_BUS: 'broker-bus',
  BROKER_IN_PREFIX: 'broker-bus:in:', // + <win>: per-window REPLY channel (point-to-point, no fan-out)
  ORDER_BUS: 'order-bus', // surfaces -> order-host: semantic order COMMANDS + acks (the Order Worker)
  STORE_PREFIX: 'platform:store:', // + <store name>
  CHANNEL_PREFIX: 'platform:ch:', // + <channel name>
};

// ---------------------------------------------------------------------------------------------------
// broker-bus -- RPC + state. `dir:'out'` is proxy -> host (requests). The shared channel carries only
// requests + broadcasts (dir:'in' with snap/event/notice/logLine/raw). High-frequency REPLIES (quotes,
// bars, trade events, order acks) do NOT go here -- the host posts each to the requesting window's private
// `broker-bus:in:<win>` channel (BROKER_IN_PREFIX), so only that window deserializes it. A shared bus would
// structured-clone every reply into every window and drop it by callId -- the amplification this avoids.
// ---------------------------------------------------------------------------------------------------
/** proxy -> host: an RPC call. The host runs `method(...args)` on adapter/core `target` and replies by callId.
 * @typedef {{ dir: 'out', win: string, target: string, id: (string|null), method: string, args: any[], callId: number }} BrokerCall */
/** proxy -> host: control. `hello` asks for the current snapshot; `rawtap` toggles the diagnostic raw feed.
 * @typedef {{ dir: 'out', win: string, hello?: true, rawtap?: ('on'|'off') }} BrokerControl */
/** host -> ONE proxy over `broker-bus:in:<win>`: the reply to a call, matched by `callId`; `payload` is the
 * callback arguments. Point-to-point (the channel is window-private), so no `dir`/`to` needed.
 * @typedef {{ callId: number, payload: any[] }} BrokerReply */
/** host -> proxy: broadcasts. Exactly one of snap/event/notice/raw/logLine is set; `to` narrows to one window.
 * @typedef {{ dir: 'in', to?: string, snap?: Snap, event?: ('connections:changed'|'logon'), notice?: any,
 *   raw?: { broker: string, channel: string, msg: any }, logLine?: { text: string, err?: boolean } }} BrokerBroadcast */
/** the adapter-state snapshot the host broadcasts on connection changes -- synchronous reads (isConnected,
 * connections, labelOf, serverNow) read this mirror instead of crossing the bridge.
 * @typedef {{ conns: any[], activeId: (string|null), adapters: Record<string, any> }} Snap */
/** messages on the shared `broker-bus` (requests + broadcasts). Replies ride `broker-bus:in:<win>` (BrokerReply).
 * @typedef {BrokerCall | BrokerControl | BrokerBroadcast} BrokerBusMsg */

// ---------------------------------------------------------------------------------------------------
// order-bus -- surfaces -> order-host RPC. `dir:'cmd'` is a surface (any window) sending a semantic order
// COMMAND to the Order Worker; `dir:'ack'` is the worker's reply, matched by `callId` and routed to `to`
// (the requesting window). The command's meaning lives in the worker, not on the wire.
// ---------------------------------------------------------------------------------------------------
/** surface -> worker: a semantic order command (type + payload). @typedef {{ dir: 'cmd', win: string, callId: number, cmd: { type: string, [k: string]: any } }} OrderCmd */
/** worker -> surface: the reply, matched by callId. @typedef {{ dir: 'ack', to: string, callId: number, ok: boolean, result?: any, error?: string }} OrderAck */
/** @typedef {OrderCmd | OrderAck} OrderBusMsg */

// ---------------------------------------------------------------------------------------------------
// platform:store:<name> -- keyed live-state replication. One channel per store; a late joiner asks with
// reqSnapshot and a peer answers with a full reset.
// ---------------------------------------------------------------------------------------------------
/** @typedef {{ set: { key: string, value: any } } | { remove: { key: string } } | { reset: [string, any][] }
 *   | { reqSnapshot: true }} StoreSync */

// ---------------------------------------------------------------------------------------------------
// platform:ch:<name> -- append streams (console). `msg` appends; `__reset` clears.
// ---------------------------------------------------------------------------------------------------
/** @typedef {{ msg: any } | { __reset: true }} ChannelSync */
