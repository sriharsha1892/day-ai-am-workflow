// Single Vercel serverless function. vercel.json rewrites every path to /api,
// so this handler sees the original request URL and Hono routes it.
//
// We bypass @hono/node-server/vercel's handle() (which hangs on POST in this team's
// Vercel runtime) and adapt Node req/res to Web Request/Response directly so Hono's
// native fetch() handler runs cleanly.

import { app } from '../worker/app.mjs';

export const config = {
  runtime: 'nodejs',
};

export default async function vercelHandler(req, res) {
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

    const response = await app.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const text = await response.text();
    res.end(text);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}
