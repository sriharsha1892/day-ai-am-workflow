#!/usr/bin/env node

import { applyEnv, loadLocalEnv } from './env-utils.mjs';

applyEnv(loadLocalEnv('.env.local'));

const token = process.env.CLEAROUT_API_TOKEN;
const baseUrl = (process.env.CLEAROUT_BASE_URL || 'https://api.clearout.io').replace(/\/+$/, '');

if (!token) {
  fail('Missing CLEAROUT_API_TOKEN. Add it with: npm run secrets:set CLEAROUT_API_TOKEN');
}

console.log('# Clearout Probe');
console.log(`Base URL: ${baseUrl}`);
console.log('Mode: credits/auth check; no email verification\n');

const result = await probeCredits();
if (!result.ok) {
  console.error(`FAIL Clearout credits/auth: ${result.status} ${result.message}`);
  process.exit(1);
}

console.log(`OK Clearout credits/auth: ${result.summary}`);
console.log('\nClearout probe passed. Email verification is intentionally not called.');

async function probeCredits() {
  const endpoint = `${baseUrl}/v2/email_verify/getcredits`;
  const attempts = [
    { label: 'bearer', authorization: `Bearer ${token}` },
    { label: 'raw', authorization: token },
  ];

  let lastFailure = null;
  for (const attempt of attempts) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: attempt.authorization,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      if (response.ok) {
        const data = parseJson(text);
        return {
          ok: true,
          summary: summarizeCredits(data, response),
        };
      }
      lastFailure = {
        ok: false,
        status: response.status,
        message: `${safeMessage(text)} (${attempt.label} auth)`,
      };
    } catch (error) {
      lastFailure = {
        ok: false,
        status: 'ERR',
        message: `${error instanceof Error ? error.message : String(error)} (${attempt.label} auth)`,
      };
    }
  }
  return lastFailure ?? { ok: false, status: 'ERR', message: 'Unknown Clearout probe failure' };
}

function summarizeCredits(data, response) {
  const candidates = [
    data.available_credits,
    data.availableCredits,
    data.credits,
    data.data?.available_credits,
    data.data?.availableCredits,
    data.data?.credits,
  ].filter((value) => value !== undefined && value !== null);
  const credits = candidates.length > 0 ? `credits=${candidates[0]}` : `response keys=${Object.keys(data ?? {}).slice(0, 8).join(', ') || 'none'}`;
  const limit = response.headers.get('x-ratelimit-limit');
  const remaining = response.headers.get('x-ratelimit-remaining');
  return [credits, limit ? `rateLimit=${limit}` : '', remaining ? `remaining=${remaining}` : '']
    .filter(Boolean)
    .join(', ');
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
