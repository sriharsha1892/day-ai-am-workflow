// Vercel entry for the myRA MCP server at /mcp.
//
// mcp-handler returns a Web-style (Request)=>Promise<Response> handler. We adapt Node
// req/res to Web Request/Response manually (the @hono/node-server/vercel adapter hangs
// on POST in this Vercel runtime — same lesson as api/index.mjs).
//
// Auth (Increment A): verifyToken reuses the WORKER_BEARER_TOKENS map so the server is
// curl-testable today and works with `codex mcp add myra --header "Authorization: Bearer <token>"`.
// Increment B swaps verifyToken to validate broker-issued OAuth tokens so `codex mcp login` works.

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { initializeServer, serverOptions } from '../worker/mcp.mjs';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const mcpHandler = createMcpHandler(initializeServer, serverOptions, {
  // Stateless streamable-HTTP: each tool call is request/response, no SSE session store.
  basePath: '',
  verboseLogs: false,
});

function parseTokenMap(raw) {
  const map = new Map();
  for (const pair of (raw ?? '').split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const email = pair.slice(0, idx).trim();
    const token = pair.slice(idx + 1).trim();
    if (email && token) map.set(token, email);
  }
  return map;
}

async function verifyToken(_req, bearerToken) {
  if (!bearerToken) return undefined;
  const amEmail = parseTokenMap(process.env.WORKER_BEARER_TOKENS).get(bearerToken);
  if (!amEmail) return undefined;
  return {
    token: bearerToken,
    clientId: amEmail,
    scopes: ['myra:use'],
    extra: { amEmail },
  };
}

const authedHandler = withMcpAuth(mcpHandler, verifyToken, { required: true });

export default async function vercelMcp(req, res) {
  try {
    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const url = `${proto}://${host}${req.url}`;

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
      else if (v !== undefined) headers.set(k, String(v));
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    const response = await authedHandler(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const text = await response.text();
    res.end(text);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: error.message } }));
  }
}
