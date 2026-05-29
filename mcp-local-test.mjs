import { createMcpHandler } from 'mcp-handler';
import { initializeServer, serverOptions } from './worker/mcp.mjs';

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
const initRes = await handler(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
const init = extractJson(await initRes.text());
console.log('initialize HTTP', initRes.status, '| serverInfo:', JSON.stringify(init.result?.serverInfo), '| instructions chars:', (init.result?.instructions ?? '').length);
const sid = initRes.headers.get('mcp-session-id');
const toolsRes = await handler(rpc(2, 'tools/list', {}, sid));
const tools = extractJson(await toolsRes.text());
console.log('tools:', (tools.result?.tools ?? []).map((t) => t.name).join(', '));
const promptsRes = await handler(rpc(3, 'prompts/list', {}, sid));
const prompts = extractJson(await promptsRes.text());
console.log('prompts:', (prompts.result?.prompts ?? []).map((p) => p.name).join(', '));
const resRes = await handler(rpc(4, 'resources/list', {}, sid));
const resources = extractJson(await resRes.text());
console.log('resources:', (resources.result?.resources ?? []).map((r) => r.name).join(', '));
