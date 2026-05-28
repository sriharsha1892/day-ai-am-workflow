// Bearer token auth. Maps token -> AM email so every write can stamp `approving_am_email`.
// Token map loaded from WORKER_BEARER_TOKENS env var: "email:token,email:token".

let tokenMap = null;

function ensureLoaded() {
  if (tokenMap) return;
  tokenMap = new Map();
  const raw = process.env.WORKER_BEARER_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [email, token] = pair.split(':').map((s) => s?.trim()).filter(Boolean);
    if (email && token) tokenMap.set(token, email);
  }
}

export function bearerAuth() {
  return async (c, next) => {
    ensureLoaded();
    const header = c.req.header('authorization') ?? '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return c.json({ error: 'missing bearer token' }, 401);
    }
    const am = tokenMap.get(match[1]);
    if (!am) {
      return c.json({ error: 'unknown bearer token' }, 401);
    }
    c.set('amEmail', am);
    await next();
  };
}

export function amEmailFor(c) {
  return c.get('amEmail');
}
