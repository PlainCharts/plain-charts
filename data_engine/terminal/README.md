# engine terminal

A standalone TUI for driving the data engine directly -- adapters, broker, orders, stores -- without
the app, without Electron, without remote debugging. Its own session: the engine runs in-process in
`solo` mode and owns the broker socket. This is the development environment for the engine and its
adapters: isolate one adapter, connect to a broker, place orders, and measure execution latency from
the command line.

Built with React + Ink (declarative, Yoga-flexbox layout). Self-contained toolchain (its own
`package.json` / `node_modules`) so React and JSX never enter the app or the engine's zero-dep core.

## Run

```
cd data_engine/terminal
npm install      # first time
npm start        # launch the TUI
npm test         # headless render + input-loop smoke test
```

## Status

- P1 (done): the shell. Header, scrolling log, input line, status bar, input loop, clean exit.
- P2 (next): boot the engine in-process (solo), load an adapter, wire real commands
  (connect, quote, buy/sell, orders, positions, accounts, cancel, history).
- P3: MCP over HTTP so an agent drives the same live engine instance; latency/exec metrics.
