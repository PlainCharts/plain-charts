import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { bootEngine } from '../boot/engine.js';
import { startMcp } from '../src/mcp.js';

// End-to-end: boot the engine + order worker, start the MCP HTTP server, connect a real MCP client, list
// tools, and drive the order worker THROUGH MCP (command echo). No live broker needed. This is the channel
// Claude uses. Run: npm run test:mcp

const engine = await bootEngine();
const srv = await startMcp(engine, { accounts: [], port: 8799 });

const client = new Client({ name: 'test-client', version: '0.0.1' });
const transport = new StreamableHTTPClientTransport(new URL(srv.url));
await client.connect(transport);

// tools are advertised
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
for (const need of ['connect', 'command', 'positions', 'orders', 'connections', 'quote']) {
  assert.ok(names.includes(need), 'MCP tool missing: ' + need);
}

// a read tool works (no broker connected -> empty book, not an error)
const posRes = await client.callTool({ name: 'positions', arguments: {} });
assert.ok(!posRes.isError, 'positions tool errored');
assert.ok(Array.isArray(JSON.parse(posRes.content[0].text)), 'positions did not return an array');

// THE channel: an MCP client drives the order worker via command()
const echo = await client.callTool({ name: 'command', arguments: { cmd: { type: 'echo', via: 'mcp' } } });
assert.ok(!echo.isError, 'command tool errored: ' + (echo.content && echo.content[0] && echo.content[0].text));
const parsed = JSON.parse(echo.content[0].text);
assert.deepEqual(parsed.echoed, { type: 'echo', via: 'mcp' }, 'order worker did not echo the MCP command');
assert.ok(parsed.book, 'no book in worker reply');

await client.close();
srv.close();
console.log('PASS: MCP client -> command() -> order worker (book: ' + JSON.stringify(parsed.book) + '); tools: ' + names.length);
process.exit(0);
