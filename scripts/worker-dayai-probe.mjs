#!/usr/bin/env node
// One-time discovery probe to confirm Day AI MCP OAuth grant types available.
// Hits the OAuth metadata endpoint (RFC 8414) and reports supported grant types so we know
// whether the worker can use client_credentials or must run interactive authorization_code.

const baseUrl = process.argv[2] ?? 'https://day.ai/api/mcp';
const metadataEndpoints = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];

console.log(`# Day AI MCP Auth Probe`);
console.log(`Target: ${baseUrl}\n`);

let foundMetadata = false;
for (const endpoint of metadataEndpoints) {
  const url = baseUrl.replace(/\/api\/mcp$/, '') + endpoint;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.log(`MISS ${endpoint}: ${response.status}`);
      continue;
    }
    foundMetadata = true;
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      console.log(`PARSE ERROR ${endpoint}: response was not JSON`);
      continue;
    }
    console.log(`OK ${endpoint}`);
    console.log(`  issuer: ${data.issuer ?? '(none)'}`);
    console.log(`  authorization_endpoint: ${data.authorization_endpoint ?? '(none)'}`);
    console.log(`  token_endpoint: ${data.token_endpoint ?? '(none)'}`);
    console.log(`  grant_types_supported: ${(data.grant_types_supported ?? []).join(', ') || '(none)'}`);
    console.log(`  response_types_supported: ${(data.response_types_supported ?? []).join(', ') || '(none)'}`);
    console.log(`  scopes_supported: ${(data.scopes_supported ?? []).join(', ') || '(none)'}`);
    console.log('');
  } catch (error) {
    console.log(`ERR ${endpoint}: ${error.message}`);
  }
}

if (!foundMetadata) {
  console.log('No OAuth metadata endpoint responded.');
  console.log('Falling back: trying the MCP endpoint directly to see whether it returns OAuth challenge headers.');
  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`Direct probe status: ${response.status}`);
    const wwwAuth = response.headers.get('www-authenticate');
    if (wwwAuth) console.log(`WWW-Authenticate: ${wwwAuth}`);
  } catch (error) {
    console.log(`Direct probe error: ${error.message}`);
  }
}

console.log('\nNext step:');
console.log('  - If grant_types_supported includes "client_credentials": use scripts/worker-dayai-onboard.mjs --client-credentials');
console.log('  - If only "authorization_code": run scripts/worker-dayai-onboard.mjs and complete the browser flow once for harsha@ask-myra.ai');
console.log('  - If neither: open a ticket with Day AI for a service-account credential. Worker writes are blocked until resolved.');
