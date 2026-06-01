// Full MCP client sequence against production: initialize -> initialized -> tools/call.
// Proves the Codex→MCP→tool→provider path end to end on Vercel.
// Run: node scripts/tests/mcp-prod-toolcall.mjs
import { workerMcpUrl } from '../worker-url.mjs';
const BASE = workerMcpUrl();
const TOKEN = process.env.MCP_TOKEN ?? 'tok_satya_16b698ab18dc27e76aaabb17c6a84453fb9dc8e9d15d13ea';

let sessionId = null;

async function send(method, params, isNotification = false) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params: params ?? {} };
  if (!isNotification) body.id = Math.floor(Math.random() * 1e6);
  const res = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (isNotification) return { status: res.status };
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
  return { status: res.status, json: JSON.parse(dataLine ? dataLine.slice(5).trim() : text || '{}') };
}

const init = await send('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'prod-test', version: '1' },
});
process.stdout.write(`initialize: HTTP ${init.status}, session ${sessionId ? 'set' : 'none'}\n`);

await send('notifications/initialized', {}, true);

const call = await send('tools/call', {
  name: 'resolve_identity',
  arguments: { accountName: 'Michelman', canonicalDomain: 'michelman.com' },
});
const sc = call.json.result?.structuredContent;
process.stdout.write(`tools/call resolve_identity: HTTP ${call.status}\n`);
if (sc) {
  process.stdout.write(
    `  decision: ${sc.decision?.action} / ${sc.decision?.receiptColor} (conf ${sc.decision?.matchConfidence})\n`,
  );
  process.stdout.write(`  evidence: ${JSON.stringify(sc.evidenceSources)}\n`);
  process.stdout.write(`  approvedBy: ${sc.approvedBy}\n`);
} else {
  process.stdout.write(`  raw: ${JSON.stringify(call.json).slice(0, 400)}\n`);
}
