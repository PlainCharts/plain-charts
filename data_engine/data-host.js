// @ts-check
// DATA-HOST boot entry. Import this (and nothing else from the engine) in the headless data-host
// window (?role=data). broker.js detects the host role, runs the REAL broker core + every adapter,
// starts the bridge server for the proxy windows and feeds the platform stores via the trade feed.
import './data/broker.js';
