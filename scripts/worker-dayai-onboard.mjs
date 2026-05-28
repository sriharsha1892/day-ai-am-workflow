#!/usr/bin/env node
// One-time interactive onboarding for the Day AI integration user (harsha@ask-myra.ai).
// Runs the authorization_code flow with PKCE in a tiny local HTTP server, captures the code,
// exchanges it for tokens, and persists the refresh token to worker/.secrets/day-ai-refresh.json.
//
// Usage:
//   node scripts/worker-dayai-onboard.mjs --client-id <id> [--scopes "read write"] [--port 4321]
//
// Read scripts/worker-dayai-probe.mjs first to confirm grant types Day AI MCP supports.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { applyEnv, loadLocalEnv } from './env-utils.mjs';
import { parseArgs } from './worker-client.mjs';

applyEnv(loadLocalEnv('.env.local'));

const args = parseArgs(process.argv);
const clientId = args['client-id'] ?? process.env.DAY_AI_CLIENT_ID;
const clientSecret = args['client-secret'] ?? process.env.DAY_AI_CLIENT_SECRET;
const authBase = args['auth-base'] ?? process.env.DAY_AI_AUTH_BASE ?? 'https://day.ai';
const tokenEndpoint = args['token-endpoint'] ?? `${authBase}/oauth/token`;
const authEndpoint = args['auth-endpoint'] ?? `${authBase}/oauth/authorize`;
const scopes = args.scopes ?? 'read write';
const port = Number(args.port ?? 4321);
const useClientCredentials = args['client-credentials'] === true || args['client-credentials'] === 'true';

if (!clientId) {
  process.stderr.write(
    'Missing --client-id (or DAY_AI_CLIENT_ID in .env.local). Register harsha@ask-myra.ai as an OAuth client in Day AI first.\n',
  );
  process.exit(1);
}

const secretsDir = path.resolve('worker/.secrets');
fs.mkdirSync(secretsDir, { recursive: true });
const tokenStorePath = path.join(secretsDir, 'day-ai-refresh.json');

if (useClientCredentials) {
  await runClientCredentials();
} else {
  await runAuthorizationCode();
}

async function runClientCredentials() {
  console.log('Day AI onboard: client_credentials flow');
  if (!clientSecret) {
    process.stderr.write('Missing --client-secret for client_credentials flow.\n');
    process.exit(1);
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopes,
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    process.stderr.write(`Token endpoint ${tokenEndpoint} responded ${response.status}: ${text}\n`);
    process.exit(1);
  }
  const tokens = JSON.parse(text);
  persistTokens({ ...tokens, grantType: 'client_credentials', obtainedAt: new Date().toISOString() });
  console.log(`Stored client_credentials access_token at ${tokenStorePath} (no refresh token; re-run when expired).`);
}

async function runAuthorizationCode() {
  console.log('Day AI onboard: authorization_code + PKCE flow');
  console.log(`Listening on http://127.0.0.1:${port}/callback for the redirect.\n`);

  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');

  const authUrl = new URL(authEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/callback`);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  console.log('Open this URL in a browser logged into harsha@ask-myra.ai:\n');
  console.log(authUrl.toString());
  console.log('');

  const code = await waitForCode({ port, state });

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `http://127.0.0.1:${port}/callback`,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (clientSecret) params.set('client_secret', clientSecret);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    process.stderr.write(`Token endpoint ${tokenEndpoint} responded ${response.status}: ${text}\n`);
    process.exit(1);
  }
  const tokens = JSON.parse(text);
  if (!tokens.refresh_token) {
    process.stderr.write(
      'Token response did not include refresh_token. Day AI may require a different grant or scope.\n',
    );
    process.exit(1);
  }
  persistTokens({ ...tokens, grantType: 'authorization_code', obtainedAt: new Date().toISOString() });
  console.log(`Stored refresh_token at ${tokenStorePath}.`);
}

function persistTokens(tokens) {
  fs.writeFileSync(tokenStorePath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.chmodSync(tokenStorePath, 0o600);
}

async function waitForCode({ port: listenPort, state }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${listenPort}`);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (returnedState !== state) {
        res.statusCode = 400;
        res.end('state mismatch');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end('missing code');
        server.close();
        reject(new Error('OAuth code missing'));
        return;
      }
      res.statusCode = 200;
      res.end('Day AI integration user authorized. You can close this tab.');
      server.close();
      resolve(code);
    });
    server.listen(listenPort);
  });
}
