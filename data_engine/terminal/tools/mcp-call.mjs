// Small MCP client to drive the engine terminal from a shell (until native mcp__engine__* tools load in a
// fresh Claude Code session). Usage:
//   node tools/mcp-call.mjs list
//   node tools/mcp-call.mjs <tool> '<json-args>'
// e.g. node tools/mcp-call.mjs connections
//      node tools/mcp-call.mjs command '{"cmd":{"type":"echo","hi":1}}'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const name = process.argv[2];
const argsJson = process.argv[3];
const url = process.env.MCP_URL || 'http://127.0.0.1:8790/mcp';

const client = new Client({ name: 'claude-driver', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
try {
  if (!name || name === 'list') {
    const { tools } = await client.listTools();
    console.log(tools.map((t) => '- ' + t.name + ': ' + (t.description || '').split('\n')[0]).join('\n'));
  } else {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const res = await client.callTool({ name, arguments: args });
    const text = res.content && res.content[0] && res.content[0].text;
    console.log((res.isError ? 'ERROR: ' : '') + (text != null ? text : JSON.stringify(res)));
  }
} finally {
  await client.close();
  process.exit(0);
}
