// Day AI identity provider. Delegates AM authentication to Day AI's OAuth
// (authorization_code), then resolves the AM's identity via the Day AI `whoami` MCP tool.
// Returns the AM email + their Day AI refresh token so the worker can attribute writes to them.
//
// Uses the broker's own Day AI client (DAY_AI_BROKER_CLIENT_ID/SECRET), registered with our
// production callback. Distinct from the shared integration client used for fallback writes.

const AUTH_BASE = process.env.DAY_AI_AUTH_BASE ?? 'https://day.ai';
const MCP_BASE = process.env.DAY_AI_MCP_BASE ?? 'https://day.ai/api/mcp';
const SCOPE = 'assistant:*:use native_organization:write native_contact:write';

function clientId() {
  const id = process.env.DAY_AI_BROKER_CLIENT_ID;
  if (!id) throw new Error('DAY_AI_BROKER_CLIENT_ID not set');
  return id;
}
function clientSecret() {
  const s = process.env.DAY_AI_BROKER_CLIENT_SECRET;
  if (!s) throw new Error('DAY_AI_BROKER_CLIENT_SECRET not set');
  return s;
}

export const dayAiIdP = {
  name: 'dayai',

  async startAuthorization({ state, callbackUrl }) {
    const url = new URL(`${AUTH_BASE}/integrations/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId());
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);
    return { redirectUrl: url.toString() };
  },

  async handleCallback({ query, callbackUrl }) {
    const code = query.get('code');
    if (!code) {
      const err = query.get('error') ?? 'missing_code';
      throw new Error(`Day AI authorization failed: ${err}`);
    }

    // Exchange the authorization code for tokens.
    const tokenRes = await fetch(`${AUTH_BASE}/api/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: callbackUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) {
      throw new Error(`Day AI token exchange ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
    }
    const tokens = await tokenRes.json();

    // Resolve the AM identity via the Day AI `whoami` MCP tool using the new access token.
    const amEmail = await whoami(tokens.access_token);

    return {
      amEmail,
      downstream: {
        provider: 'dayai',
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        obtainedAt: new Date().toISOString(),
      },
    };
  },
};

async function whoami(accessToken) {
  try {
    const res = await fetch(MCP_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    const inner = data.result?.structuredContent ?? parseContentText(data.result);
    const email =
      inner?.email ??
      inner?.user?.email ??
      inner?.workspaceMember?.email ??
      inner?.me?.email;
    if (email) return String(email).toLowerCase();
  } catch {
    /* fall through */
  }
  // If whoami is unavailable (tier-gated) we cannot verify the email; reject rather than guess.
  throw new Error('Could not resolve AM identity from Day AI (whoami unavailable). Worker write attribution requires a verified email.');
}

function parseContentText(result) {
  const t = result?.content?.[0]?.text;
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
