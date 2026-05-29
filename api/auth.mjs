// Vercel entry for OAuth discovery + broker endpoints. vercel.json routes
// /.well-known/* and /auth/* here. Dispatches on the request path to worker/oauth/broker.mjs.
//
// Plain Node (req,res) handler — no MCP transport involved, so no Web-adapter needed.

import {
  authorizationServerMetadata,
  register,
  authorize,
  idpCallback,
  token,
} from '../worker/oauth/broker.mjs';

export const config = { runtime: 'nodejs', maxDuration: 30 };

// Load local env for dev (no-op on Vercel).
import fs from 'node:fs';
import path from 'node:path';
for (const candidate of ['worker/.env', '.env.local']) {
  const p = path.resolve(candidate);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = t.slice(i + 1).replace(/^['"]|['"]$/g, '');
  }
}

function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.end(JSON.stringify(body));
}

function sendRedirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

export default async function authHandler(req, res) {
  try {
    const origin = originOf(req);
    const url = new URL(req.url, origin);
    const pathname = url.pathname;

    // Discovery: authorization server metadata
    if (pathname.endsWith('/.well-known/oauth-authorization-server')) {
      return sendJson(res, 200, authorizationServerMetadata(origin));
    }

    // Discovery: protected resource metadata (RFC 9728) — points at ourselves as the auth server
    if (pathname.endsWith('/.well-known/oauth-protected-resource')) {
      return sendJson(res, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        bearer_methods_supported: ['header'],
        scopes_supported: ['myra:use'],
      });
    }

    if (pathname.endsWith('/auth/register') && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const out = await register(body);
      return sendJson(res, out.status, out.body);
    }

    if (pathname.endsWith('/auth/authorize') && req.method === 'GET') {
      const out = await authorize(url.searchParams, origin);
      if (out.redirect) return sendRedirect(res, out.redirect);
      return sendJson(res, out.status, out.body);
    }

    if (pathname.endsWith('/auth/idp-callback') && req.method === 'GET') {
      const out = await idpCallback(url.searchParams, origin);
      if (out.redirect) return sendRedirect(res, out.redirect);
      return sendJson(res, out.status, out.body);
    }

    if (pathname.endsWith('/auth/token') && req.method === 'POST') {
      const raw = await readBody(req);
      const form = new URLSearchParams(raw);
      const out = await token(form);
      return sendJson(res, out.status, out.body);
    }

    return sendJson(res, 404, { error: 'not_found', path: pathname });
  } catch (error) {
    return sendJson(res, 500, { error: 'server_error', message: error.message });
  }
}
