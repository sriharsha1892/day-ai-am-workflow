#!/usr/bin/env node

import { applyEnv, loadLocalEnv } from './env-utils.mjs';

applyEnv(loadLocalEnv('.env.local'));

const apiKey = process.env.APOLLO_API_KEY;
if (!apiKey) {
  fail('Missing APOLLO_API_KEY. Add it with: npm run secrets:set APOLLO_API_KEY');
}

console.log('# Apollo Probe');
console.log('Mode: auth-only health check; no enrichment\n');

const health = await probeHealth();
if (!health.ok) {
  console.error(`FAIL Apollo auth health: ${health.status} ${health.message}`);
  process.exit(1);
}

console.log(`OK Apollo auth health: ${health.summary}`);
console.log('\nApollo probe passed. People Search can be tested separately; enrichment is intentionally not called.');

async function probeHealth() {
  try {
    const response = await fetch('https://api.apollo.io/v1/auth/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: safeMessage(text),
      };
    }
    const data = parseJson(text);
    return {
      ok: true,
      summary: summarizeHealth(data),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'ERR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeHealth(data) {
  if (typeof data === 'object' && data !== null) {
    const pairs = Object.entries(data)
      .slice(0, 8)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return pairs || 'authenticated';
  }
  return 'authenticated';
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeMessage(text) {
  if (!text) return 'No response body';
  const data = parseJson(text);
  const message = data.message ?? data.error ?? data.errors ?? data.description;
  if (message) return String(message).slice(0, 300);
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
