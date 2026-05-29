// OAuth 2.1 authorization server for the MCP resource, IdP-agnostic.
// Flow: Codex --DCR+authorize+token--> broker --delegates auth--> IdP (Day AI by default).
// The broker mints its own short codes + access tokens; AM identity + downstream tokens
// come from the pluggable IdP. All state lives in the shared KV (worker/kv.mjs).
//
// Endpoints (pure functions returning {status, headers?, body} or a redirect):
//   authorizationServerMetadata(origin)  -> /.well-known/oauth-authorization-server
//   register(body)                       -> Dynamic Client Registration (RFC 7591)
//   authorize(params, origin)            -> validates Codex client, delegates to IdP
//   idpCallback(query, origin)           -> resolves identity, mints our code, redirects to Codex
//   token(form)                          -> code->token (PKCE) and refresh
//   verifyAccessToken(token)             -> { amEmail, downstream } | null   (used by /mcp)

import crypto from 'node:crypto';
import * as kv from '../kv.mjs';
import { getIdP } from './idp.mjs';

const CODE_TTL = 600; // 10 min
const TOKEN_TTL = 30 * 86_400; // 30 days
const PENDING_TTL = 600;

const k = {
  client: (id) => `oauth:client:${id}`,
  pending: (s) => `oauth:pending:${s}`,
  code: (c) => `oauth:code:${c}`,
  token: (t) => `oauth:token:${sha256(t)}`,
};

function rand(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('base64url');
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/auth/authorize`,
    token_endpoint: `${origin}/auth/token`,
    registration_endpoint: `${origin}/auth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['myra:use'],
  };
}

// RFC 7591 Dynamic Client Registration. Codex registers itself; we record its redirect URIs.
export async function register(body) {
  const redirectUris = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris required' } };
  }
  const clientId = `codex-${rand(12)}`;
  await kv.set(k.client(clientId), { redirectUris, name: body.client_name ?? 'codex', createdAt: Date.now() });
  return {
    status: 201,
    body: {
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  };
}

// Codex opens this in the browser. We validate its client + redirect, stash the request,
// and hand off to the configured IdP for actual user authentication.
export async function authorize(params, origin) {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codexState = params.get('state') ?? '';
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');

  const client = clientId ? await kv.get(k.client(clientId)) : null;
  if (!client) return redirectError(redirectUri, 'unauthorized_client', codexState);
  if (!client.redirectUris.includes(redirectUri)) {
    return { status: 400, body: { error: 'invalid_redirect_uri' } };
  }
  if (codeChallenge && codeChallengeMethod !== 'S256') {
    return redirectError(redirectUri, 'invalid_request', codexState, 'only S256 PKCE supported');
  }

  const brokerState = rand(16);
  await kv.set(
    k.pending(brokerState),
    { clientId, redirectUri, codexState, codeChallenge: codeChallenge ?? null },
    { ttlSeconds: PENDING_TTL },
  );

  const idp = getIdP();
  const callbackUrl = `${origin}/auth/idp-callback`;
  const { redirectUrl } = await idp.startAuthorization({ state: brokerState, callbackUrl });
  return { status: 302, redirect: redirectUrl };
}

// The IdP redirects back here. Resolve the AM identity, mint our authorization code,
// and bounce the browser to Codex's redirect_uri with the code.
export async function idpCallback(query, origin) {
  const brokerState = query.get('state');
  const pending = brokerState ? await kv.get(k.pending(brokerState)) : null;
  if (!pending) return { status: 400, body: { error: 'invalid_state', error_description: 'unknown or expired auth request' } };
  await kv.del(k.pending(brokerState));

  const idp = getIdP();
  const callbackUrl = `${origin}/auth/idp-callback`;
  let identity;
  try {
    identity = await idp.handleCallback({ query, callbackUrl });
  } catch (e) {
    return redirectError(pending.redirectUri, 'access_denied', pending.codexState, e.message);
  }

  const code = rand(24);
  await kv.set(
    k.code(code),
    {
      amEmail: identity.amEmail,
      downstream: identity.downstream,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
    },
    { ttlSeconds: CODE_TTL },
  );

  const dest = new URL(pending.redirectUri);
  dest.searchParams.set('code', code);
  if (pending.codexState) dest.searchParams.set('state', pending.codexState);
  return { status: 302, redirect: dest.toString() };
}

// Codex exchanges the code (with PKCE verifier) for an access token; also handles refresh.
export async function token(form) {
  const grantType = form.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const verifier = form.get('code_verifier');
    const redirectUri = form.get('redirect_uri');
    const entry = code ? await kv.get(k.code(code)) : null;
    if (!entry) return { status: 400, body: { error: 'invalid_grant', error_description: 'bad or expired code' } };
    await kv.del(k.code(code));
    if (entry.redirectUri && redirectUri && entry.redirectUri !== redirectUri) {
      return { status: 400, body: { error: 'invalid_grant', error_description: 'redirect_uri mismatch' } };
    }
    if (entry.codeChallenge) {
      if (!verifier || sha256(verifier) !== entry.codeChallenge) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE verification failed' } };
      }
    }
    return issueToken(entry.amEmail, entry.downstream);
  }

  if (grantType === 'refresh_token') {
    const rt = form.get('refresh_token');
    const entry = rt ? await kv.get(k.token(rt)) : null;
    if (!entry) return { status: 400, body: { error: 'invalid_grant' } };
    return issueToken(entry.amEmail, entry.downstream, rt);
  }

  return { status: 400, body: { error: 'unsupported_grant_type' } };
}

async function issueToken(amEmail, downstream, reuseRefresh) {
  const accessToken = `myra_at_${rand(32)}`;
  const refreshToken = reuseRefresh ?? `myra_rt_${rand(32)}`;
  const record = { amEmail, downstream };
  await kv.set(k.token(accessToken), record, { ttlSeconds: TOKEN_TTL });
  if (!reuseRefresh) await kv.set(k.token(refreshToken), record, { ttlSeconds: TOKEN_TTL });
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL,
      refresh_token: refreshToken,
      scope: 'myra:use',
    },
  };
}

// Used by /mcp verifyToken: validate a broker-issued access token.
export async function verifyAccessToken(accessToken) {
  if (!accessToken) return null;
  const entry = await kv.get(k.token(accessToken));
  if (!entry) return null;
  return { amEmail: entry.amEmail, downstream: entry.downstream };
}

function redirectError(redirectUri, error, state, description) {
  if (!redirectUri) return { status: 400, body: { error, error_description: description } };
  const dest = new URL(redirectUri);
  dest.searchParams.set('error', error);
  if (description) dest.searchParams.set('error_description', description);
  if (state) dest.searchParams.set('state', state);
  return { status: 302, redirect: dest.toString() };
}
