#!/usr/bin/env node

import { applyEnv, loadLocalEnv } from './env-utils.mjs';

applyEnv(loadLocalEnv('.env.local'));

const apiKey = process.env.FRESHSALES_API_KEY;
const orgDomain = process.env.FRESHSALES_ORG_DOMAIN ?? 'mordorintelligence';

if (!apiKey) {
  fail('Missing FRESHSALES_API_KEY. Add it to .env.local or the runtime environment.');
}

const baseUrl = `https://${orgDomain}.freshsales.io`;
const probes = [
  {
    label: 'owners',
    path: '/api/selector/owners',
    summarize: (data) => summarizeCount(data, ['owners', 'users']),
  },
  {
    label: 'deal stages',
    path: '/api/selector/deal_stages',
    summarize: (data) => summarizeCount(data, ['deal_stages', 'dealStages']),
  },
  {
    label: 'contact fields',
    path: '/api/settings/contacts/fields',
    summarize: (data) => summarizeCount(data, ['fields', 'contact_fields', 'contactFields']),
  },
];

console.log(`# Freshsales Probe`);
console.log(`Tenant: ${baseUrl}`);
console.log(`Mode: read-only\n`);

let failures = 0;
for (const probe of probes) {
  const result = await runProbe(probe);
  if (result.ok) {
    console.log(`OK ${probe.label}: ${result.summary}`);
  } else {
    failures += 1;
    console.log(`FAIL ${probe.label}: ${result.status} ${result.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} Freshsales probe(s) failed. Check API key permissions, tenant domain, and Freshsales availability.`);
  process.exit(1);
}

console.log('\nFreshsales read-only metadata probe passed.');

async function runProbe(probe) {
  const url = new URL(probe.path, baseUrl);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Token token=${apiKey}`,
        'Content-Type': 'application/json',
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

    const data = text ? JSON.parse(text) : {};
    return {
      ok: true,
      summary: probe.summarize(data),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'ERR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeCount(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return `${data[key].length} item(s)`;
  }
  if (Array.isArray(data)) return `${data.length} item(s)`;
  return `response keys: ${Object.keys(data ?? {}).slice(0, 8).join(', ') || 'none'}`;
}

function safeMessage(text) {
  if (!text) return 'No response body';
  try {
    const parsed = JSON.parse(text);
    const message = parsed.message ?? parsed.error ?? parsed.errors ?? parsed.description;
    return String(message ?? 'Request failed').slice(0, 300);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 300);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
