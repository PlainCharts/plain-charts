// @ts-check
// CQG WebAPI protocol: load the protobuf schema, encode/decode messages.
// Uses the global `protobuf` (protobuf.min.js loaded as a classic script).

// protobuf.min.js is a classic script global with no bundled types here; treat it opaquely.
/** @type {any} */
let ClientMsg = null;
/** @type {any} */
let ServerMsg = null;

export async function loadProtocol() {
  const root = new (/** @type {any} */ (globalThis).protobuf).Root();
  const base = 'data_engine/adapters/cqg/proto/';   // proto schema lives with the broker adapter
  root.resolvePath = (/** @type {string} */ origin, /** @type {string} */ target) => (target.startsWith(base) ? target : base + target);
  await root.load(base + 'WebAPI/webapi_2.proto', { keepCase: false });
  ClientMsg = root.lookupType('WebAPI_2.ClientMsg');
  ServerMsg = root.lookupType('WebAPI_2.ServerMsg');
}

/** @param {any} obj */
export function encode(obj) {
  const err = ClientMsg.verify(obj);
  if (err) throw new Error(err);
  return ClientMsg.encode(ClientMsg.create(obj)).finish();
}

/** @param {ArrayBuffer} buf */
export function decode(buf) {
  return ServerMsg.toObject(ServerMsg.decode(new Uint8Array(buf)), {
    longs: Number, enums: Number, defaults: true, arrays: true,
  });
}

// CQG BarReportStatusCode failure codes (100+).
export const BAR_STATUS = {
  101: 'FAILURE', 103: 'ACCESS_DENIED', 104: 'NOT_FOUND',
  105: 'OUTSIDE_ALLOWED_RANGE', 106: 'INVALID_PARAMS',
  107: 'ACTIVE_REQUESTS_LIMIT', 108: 'SUBSCRIPTION_LIMIT',
  109: 'REQUEST_RATE_LIMIT', 110: 'NOT_SUPPORTED',
  111: 'UPDATE_INTERVAL_OUTSIDE_RANGE',
};
