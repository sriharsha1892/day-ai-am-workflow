// Day AI provider. Single integration user (myra-worker@ask-myra.ai), OAuth refresh token.
// Designed as a DayAiClient interface so a future service-account API key is a drop-in swap.
//
// In v1 the worker speaks MCP-over-HTTP to https://day.ai/api/mcp using the integration user.
// Until the OAuth probe and onboarding are complete, the client is a "policy-only" stub that
// rejects writes loudly and returns shape-compatible empty reads (so worker boots and probes work).

import fs from 'node:fs';
import path from 'node:path';
import { getStore, recordIdempotency } from '../store.mjs';

const REFRESH_PATH = path.resolve('worker/.secrets/day-ai-refresh.json');

let tokenCache = null;

function loadStoredTokens() {
  // Vercel-friendly: prefer env-provided refresh JSON when present, fall back to disk for local dev.
  const fromEnv = process.env.DAY_AI_REFRESH_JSON;
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv);
    } catch {
      return null;
    }
  }
  if (!fs.existsSync(REFRESH_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(REFRESH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function tokensReady() {
  const overrideToken = process.env.DAY_AI_INTEGRATION_TOKEN;
  if (overrideToken) return true;
  const stored = loadStoredTokens();
  return Boolean(stored?.refresh_token || stored?.access_token);
}

export async function probe() {
  if (!tokensReady()) {
    return {
      ok: false,
      reason:
        'No Day AI integration credentials. Run scripts/worker-dayai-probe.mjs and scripts/worker-dayai-onboard.mjs first.',
    };
  }
  await ensureAccessToken();
  return { ok: true };
}

async function ensureAccessToken() {
  const override = process.env.DAY_AI_INTEGRATION_TOKEN;
  if (override) return override;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const stored = loadStoredTokens();
  if (!stored) throw new Error('Day AI integration credentials missing');

  if (stored.grantType === 'client_credentials' || !stored.refresh_token) {
    tokenCache = {
      accessToken: stored.access_token,
      expiresAt: stored.obtainedAt
        ? new Date(stored.obtainedAt).getTime() + (stored.expires_in ?? 3600) * 1000
        : Date.now() + 5 * 60 * 1000,
    };
    return tokenCache.accessToken;
  }

  // Refresh via refresh_token grant.
  const clientId = process.env.DAY_AI_CLIENT_ID;
  const clientSecret = process.env.DAY_AI_CLIENT_SECRET;
  const tokenEndpoint = process.env.DAY_AI_TOKEN_ENDPOINT ?? `${process.env.DAY_AI_AUTH_BASE ?? 'https://day.ai'}/oauth/token`;
  if (!clientId) throw new Error('Missing DAY_AI_CLIENT_ID for refresh');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
    client_id: clientId,
  });
  if (clientSecret) params.set('client_secret', clientSecret);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error(`Day AI token refresh failed: ${response.status}`);
  }
  const data = await response.json();
  const expiresIn = data.expires_in ?? 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  if (data.refresh_token && data.refresh_token !== stored.refresh_token) {
    fs.writeFileSync(
      REFRESH_PATH,
      JSON.stringify({ ...stored, refresh_token: data.refresh_token, obtainedAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    );
    fs.chmodSync(REFRESH_PATH, 0o600);
  }
  return tokenCache.accessToken;
}

async function dayAiCall(toolName, args) {
  const accessToken = await ensureAccessToken();
  const mcpBase = process.env.DAY_AI_MCP_BASE ?? 'https://day.ai/api/mcp';
  // MCP JSON-RPC over HTTP. Day AI's exact RPC shape is confirmed by scripts/worker-dayai-probe.mjs;
  // this is the streamable-HTTP transport request shape per spec.
  const response = await fetch(mcpBase, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1e9),
      method: 'tools/call',
      params: { name: toolName, arguments: args ?? {} },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Day AI MCP ${toolName} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = text ? JSON.parse(text) : {};
  if (data.error) {
    throw new Error(`Day AI MCP ${toolName} RPC error: ${JSON.stringify(data.error).slice(0, 300)}`);
  }
  // MCP tool responses usually wrap content in `result.content[*].text` or `result.structuredContent`.
  return data.result ?? data;
}

export async function fetchDayAiOrgsByDomain(domain) {
  if (!domain || !tokensReady()) return [];
  try {
    const result = await dayAiCall('search_organizations', { domain });
    return extractList(result, 'organizations').map((o) => ({
      id: o.id,
      name: o.name,
      domain: o.domain ?? o.primaryDomain ?? domain,
    }));
  } catch {
    return [];
  }
}

export async function fetchDayAiOrgsByName(normalizedName) {
  if (!normalizedName || !tokensReady()) return [];
  try {
    const result = await dayAiCall('search_organizations', { name: normalizedName });
    return extractList(result, 'organizations').map((o) => ({
      id: o.id,
      name: o.name,
      domain: o.domain ?? o.primaryDomain,
    }));
  } catch {
    return [];
  }
}

export async function dayAiWrite({ action, approvingAm, canonicalDomain, idempotencyKey, retry, ...rest }) {
  if (!approvingAm) throw new Error('approvingAm required for Day AI writes');
  if (!idempotencyKey) throw new Error('idempotencyKey required for Day AI writes');

  // Idempotency check first.
  const store = getStore();
  const prior = store.idempotency.get(idempotencyKey);
  if (prior && !retry) {
    return {
      ok: true,
      replayed: true,
      action,
      ...prior,
    };
  }
  if (prior && retry) {
    // Retry: reuse the same record; just verify it still exists. Here we trust prior.
    return {
      ok: true,
      replayed: true,
      retried: true,
      action,
      ...prior,
    };
  }

  if (!tokensReady()) {
    throw new Error('Day AI integration credentials missing; run worker-dayai-onboard first.');
  }

  const tool = TOOL_MAP[action];
  if (!tool) throw new Error(`Unknown Day AI write action: ${action}`);

  const args = buildArgs(action, { approvingAm, canonicalDomain, idempotencyKey, ...rest });
  const result = await dayAiCall(tool, args);
  const record = extractRecord(action, result);
  if (!record?.id) {
    throw new Error(`Day AI ${tool} returned no record ID`);
  }

  const persisted = {
    type: typeFor(action),
    id: record.id,
    name: record.name,
    link: record.link ?? record.url,
    idempotencyKey,
    approvingAm,
    writtenAt: new Date().toISOString(),
  };
  recordIdempotency(idempotencyKey, persisted);

  return { ok: true, action, ...persisted, raw: record };
}

export async function writeDayAiContextPage({ canonicalDomain, organizationId, title, bodyMarkdown, approvingAm }) {
  if (!tokensReady()) throw new Error('Day AI integration credentials missing');
  const result = await dayAiCall('create_context_page', {
    organizationId,
    canonicalDomain,
    title,
    bodyMarkdown,
    approvingAmEmail: approvingAm,
  });
  const page = extractRecord('page-create', result);
  return {
    pageId: page?.id,
    link: page?.link ?? page?.url,
  };
}

const TOOL_MAP = {
  'org-link': 'link_organization',
  'org-create': 'create_organization',
  'opportunity-create': 'create_opportunity',
  'person-dedupe-check': 'search_people',
  'person-create': 'create_person',
  'action-create': 'create_action',
  'draft-create': 'create_draft',
  'review-context': 'create_context_page',
};

function typeFor(action) {
  if (action.startsWith('org-')) return 'organization';
  if (action === 'opportunity-create') return 'opportunity';
  if (action.startsWith('person-')) return 'person';
  if (action === 'action-create') return 'action';
  if (action === 'draft-create') return 'draft';
  if (action === 'review-context') return 'page';
  return 'unknown';
}

function buildArgs(action, payload) {
  const base = {
    canonicalDomain: payload.canonicalDomain,
    idempotencyKey: payload.idempotencyKey,
    approvingAmEmail: payload.approvingAm,
  };
  if (action === 'org-link') {
    return { ...base, dayAiOrganizationId: payload.matchedDayAiOrgId, matchEvidence: payload.matchEvidence };
  }
  if (action === 'org-create') {
    return { ...base, name: payload.accountName, packet: payload.packet };
  }
  if (action === 'opportunity-create') {
    return { ...base, stage: payload.stage ?? 'Researching' };
  }
  if (action === 'person-dedupe-check') {
    return { ...base, candidates: payload.candidates ?? [] };
  }
  if (action === 'person-create') {
    return { ...base, candidate: payload.candidate };
  }
  if (action === 'action-create') {
    return {
      ...base,
      contactEmail: payload.contactEmail,
      channel: payload.channel,
      dueAt: payload.dueAt,
      summary: payload.summary,
      branchIf: payload.branchIf,
    };
  }
  if (action === 'draft-create') {
    return {
      ...base,
      contactEmail: payload.contactEmail,
      linkedActionId: payload.linkedActionId,
      subject: payload.subject,
      bodyHtml: payload.bodyHtml,
      tone: payload.tone,
      cta: payload.cta,
      length: payload.length,
      personaPack: payload.personaPack,
      channelPack: payload.channelPack,
    };
  }
  if (action === 'review-context') {
    return { ...base, title: payload.summary ?? 'Review required', bodyMarkdown: payload.reason ?? '' };
  }
  return base;
}

function extractList(result, key) {
  if (!result) return [];
  if (Array.isArray(result[key])) return result[key];
  if (result.structuredContent?.[key]) return result.structuredContent[key];
  // MCP often returns content as a single text block containing JSON.
  const text = result.content?.[0]?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed[key])) return parsed[key];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function extractRecord(action, result) {
  if (!result) return null;
  if (result.id) return result;
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      return parsed.record ?? parsed;
    } catch {
      return null;
    }
  }
  return null;
}
