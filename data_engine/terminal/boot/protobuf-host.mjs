// Host shim for the CQG adapter's protobuf schema. In the app, protobuf.js is a classic <script> that sets
// the global `protobuf`, and the .proto files are served over HTTP. In a plain Node process neither exists,
// so the adapter's `new globalThis.protobuf.Root()` throws ("reading 'Root'"). We:
//   1. execute the SAME vendored lib into this global (its UMD does `util.global.protobuf = protobuf`), and
//   2. give protobuf a file-backed XMLHttpRequest -- the vendored browser build loads .proto over XHR
//      (undefined in Node; its bundled fs loader is stripped), so we serve those same on-disk .proto files.
// Adapter untouched -- this is the Node equivalent of the <script> tag + the app server.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));   // data_engine/terminal/boot/ -> repo root

// Minimal XMLHttpRequest that reads local files (the only "server" protobuf.js needs here). Matches the
// subset protobuf.js/@protobufjs/fetch uses: open(), send(), responseText/response, status, readyState,
// onreadystatechange. Proto paths are relative ('data_engine/adapters/...') -> resolve against the root.
class FileXHR {
  constructor() { this.readyState = 0; this.status = 0; this.response = null; this.responseText = ''; this.responseType = ''; this.onreadystatechange = null; }
  open(method, url) { this._url = url; this.readyState = 1; }
  setRequestHeader() {}
  send() {
    const url = this._url;
    // real XHR completes ASYNCHRONOUSLY; protobuf.js relies on that to order its import graph. Firing the
    // callback synchronously here re-enters the loader mid-file and drops imports -- defer to the next tick.
    setImmediate(() => {
      const full = isAbsolute(url) ? url : join(ROOT, url);
      try {
        if (this.responseType === 'arraybuffer') {
          const b = readFileSync(full);
          this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        } else {
          this.responseText = readFileSync(full, 'utf8');
          this.response = this.responseText;
        }
        this.status = 200;
      } catch (_) {
        this.status = 404;
      }
      this.readyState = 4;
      if (this.onreadystatechange) this.onreadystatechange();
    });
  }
}

export function setupProtobuf() {
  if (typeof globalThis.protobuf === 'undefined') {
    const code = readFileSync(new URL('../../../lib/protobuf.min.js', import.meta.url), 'utf8');
    vm.runInThisContext(code);   // UMD: sets globalThis.protobuf (util.global.protobuf = protobuf)
  }
  if (typeof globalThis.XMLHttpRequest === 'undefined') globalThis.XMLHttpRequest = FileXHR;
}
