// Local MCP protocol smoke test: initialize, tools/list, prompts/list, resources/list.
// Run: node scripts/tests/mcp-protocol.mjs
import { createMcpHandler } from 'mcp-handler';
import { initializeServer, serverOptions } from '../../worker/mcp.mjs';

const handler = createMcpHandler(initializeServer, serverOptions, { basePath: '' });

function rpc(id, method, params, sid) {
  const r = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
  });
  if (sid) r.headers.set('mcp-session-id', sid);
  return r;
}

function extractJson(text) {
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
}

const initRes = await handler(
  rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
);
const init = extractJson(await initRes.text());
process.stdout.write(
  `initialize HTTP ${initRes.status} | serverInfo ${JSON.stringify(init.result?.serverInfo)} | instructions ${(init.result?.instructions ?? '').length} chars\n`,
);
const sid = initRes.headers.get('mcp-session-id');

for (const [method, key] of [
  ['tools/list', 'tools'],
  ['prompts/list', 'prompts'],
  ['resources/list', 'resources'],
]) {
  const res = await handler(rpc(10, method, {}, sid));
  const parsed = extractJson(await res.text());
  const items = parsed.result?.[key] ?? [];
  process.stdout.write(`${method} HTTP ${res.status} — ${items.length}: ${items.map((i) => i.name).join(', ')}\n`);
}

// mcp-handler keeps a handle open; exit explicitly so the script doesn't hang.
process.exit(0);
