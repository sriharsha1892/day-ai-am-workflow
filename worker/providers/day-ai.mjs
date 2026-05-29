// Day AI provider. Speaks directly to Day AI MCP / OAuth endpoints using the
// CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN issued by `yarn oauth:setup` in
// github.com/day-ai/day-ai-sdk (dynamic OAuth client registration).
//
// Env vars (set on Vercel + locally in ~/day-ai-sdk/.env):
//   CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN — required
//   DAY_AI_BASE_URL — defaults to https://day.ai
//   WORKSPACE_ID — optional; SDK falls back to user's default workspace if unset

import { lookupIdempotency, recordIdempotency } from '../store.mjs';

const TOKEN_BUFFER_MS = 60_000;
// Access-token cache keyed by the refresh token used (shared integration token OR a
// per-AM token from the OAuth broker), so per-AM and shared tokens cache independently.
const tokenCaches = new Map();

function baseUrl() {
  return (process.env.DAY_AI_BASE_URL ?? 'https://day.ai').replace(/\/+$/, '');
}

function credsReady() {
  return Boolean(
    process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.REFRESH_TOKEN,
  );
}

export async function probe() {
  if (!credsReady()) {
    return {
      ok: false,
      reason: 'Day AI credentials missing. Set CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN env vars.',
    };
  }
  try {
    await ensureAccessToken();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// refreshOverride: a specific AM's Day AI refresh token (from the OAuth broker) so the
// write is attributed to that AM. Omitted → the shared integration REFRESH_TOKEN.
async function ensureAccessToken(refreshOverride) {
  const refreshToken = refreshOverride ?? process.env.REFRESH_TOKEN;
  if (!refreshToken) throw new Error('No Day AI refresh token available');
  const cacheKey = refreshOverride ? `am:${refreshOverride.slice(-12)}` : 'shared';

  const cached = tokenCaches.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    return cached.accessToken;
  }

  const response = await fetch(`${baseUrl()}/api/oauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Day AI token refresh ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const expiresIn = data.expires_in ?? 3600;
  const entry = { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  tokenCaches.set(cacheKey, entry);
  return entry.accessToken;
}

async function mcpCallTool(toolName, args = {}, refreshOverride) {
  const accessToken = await ensureAccessToken(refreshOverride);
  const response = await fetch(`${baseUrl()}/api/mcp`, {
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
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Day AI MCP ${toolName} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = text ? JSON.parse(text) : {};
  if (data.error) {
    throw new Error(`Day AI MCP ${toolName} RPC error: ${JSON.stringify(data.error).slice(0, 300)}`);
  }
  return data.result ?? data;
}

function parseMcpResult(result) {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

// ----- Reads -----

export async function fetchDayAiOrgsByDomain(domain) {
  if (!domain || !credsReady()) return [];
  try {
    const result = await mcpCallTool('search_objects', {
      queries: [
        {
          objectType: 'native_organization',
          where: { propertyId: 'domain', operator: 'eq', value: domain },
        },
      ],
      propertiesToReturn: '*',
    });
    const parsed = parseMcpResult(result);
    const list = parsed?.native_organization?.results ?? [];
    return list.map((o) => ({
      id: o.objectId,
      name: o.title ?? o.properties?.name,
      domain: o.properties?.domain ?? domain,
    }));
  } catch {
    return [];
  }
}

export async function fetchDayAiOrgsByName(normalizedName) {
  if (!normalizedName || !credsReady()) return [];
  try {
    const result = await mcpCallTool('search_objects', {
      queries: [
        {
          objectType: 'native_organization',
          where: { propertyId: 'name', operator: 'contains', value: normalizedName },
        },
      ],
      propertiesToReturn: '*',
    });
    const parsed = parseMcpResult(result);
    const list = parsed?.native_organization?.results ?? [];
    return list.map((o) => ({
      id: o.objectId,
      name: o.title ?? o.properties?.name,
      domain: o.properties?.domain,
    }));
  } catch {
    return [];
  }
}

// ----- Writes -----

// Action verb -> { toolName, buildArgs(payload) }. Each handler shapes our
// internal payload into the exact arguments Day AI's MCP tool expects.
const WRITE_HANDLERS = {
  'org-link': {
    tool: null,
    // Day AI doesn't have an explicit "link org" tool; linking is implicit when
    // we pass `domain` to opportunity-create. So org-link is a no-op that just
    // returns the existing org IDs we already found.
    async run({ canonicalDomain, matchedDayAiOrgId }) {
      return {
        record: {
          id: matchedDayAiOrgId ?? null,
          name: canonicalDomain,
          link: matchedDayAiOrgId ? `${baseUrl()}/organizations/${matchedDayAiOrgId}` : null,
        },
        type: 'organization',
      };
    },
  },
  'org-create': {
    tool: 'create_or_update_person_organization',
    args: (p) => ({
      objectType: 'Organization',
      domain: p.canonicalDomain,
      name: p.accountName ?? p.canonicalDomain,
    }),
    type: 'organization',
    extractRecord: (parsed, p) => {
      const r = parsed?.organization ?? parsed?.record ?? parsed;
      return {
        id: r?.objectId ?? r?.id,
        name: r?.title ?? r?.name ?? p.accountName ?? p.canonicalDomain,
        link: r?.objectId ? `${baseUrl()}/organizations/${r.objectId}` : null,
      };
    },
  },
  'opportunity-create': {
    tool: 'create_or_update_opportunity',
    args: (p) => ({
      isCreating: true,
      title: p.title ?? `${p.canonicalDomain} - Researching`,
      domain: p.canonicalDomain,
      stageId: p.stageId,
      ownerEmail: p.ownerEmail ?? p.approvingAm,
      expectedRevenue: p.expectedRevenue,
      expectedCloseDate: p.expectedCloseDate,
    }),
    type: 'opportunity',
    extractRecord: (parsed, p) => {
      const r = parsed?.opportunity ?? parsed?.record ?? parsed;
      return {
        id: r?.objectId ?? r?.id,
        name: r?.title ?? p.title,
        link: r?.objectId ? `${baseUrl()}/opportunities/${r.objectId}` : null,
      };
    },
  },
  'person-create': {
    tool: 'create_or_update_person_organization',
    args: (p) => {
      const candidate = p.candidate ?? p;
      return {
        objectType: 'Person',
        email: candidate.email,
        firstName: candidate.firstName ?? candidate.name?.split(' ')[0],
        lastName: candidate.lastName ?? candidate.name?.split(' ').slice(1).join(' '),
        jobTitle: candidate.title ?? candidate.jobTitle,
        linkedInUrl: candidate.linkedinUrl ?? candidate.linkedInUrl,
        phoneNumbers: candidate.phone ? [candidate.phone] : undefined,
      };
    },
    type: 'person',
    extractRecord: (parsed, p) => {
      const r = parsed?.person ?? parsed?.record ?? parsed;
      const email = p.candidate?.email ?? p.email;
      return {
        id: r?.objectId ?? email,
        name: r?.title ?? (`${p.candidate?.firstName ?? ''} ${p.candidate?.lastName ?? ''}`.trim() || email),
        link: r?.objectId ? `${baseUrl()}/people/${r.objectId}` : null,
      };
    },
  },
  'person-dedupe-check': {
    tool: 'search_objects',
    args: (p) => ({
      queries: (p.candidates ?? []).map((c) => ({
        objectType: 'native_contact',
        where: { propertyId: 'email', operator: 'eq', value: c.email },
      })),
      propertiesToReturn: '*',
    }),
    type: 'page',
    extractRecord: (parsed, p) => {
      const matches = parsed?.native_contact?.results ?? [];
      return {
        id: `dedupe-${p.canonicalDomain}-${Date.now()}`,
        name: `Dedupe check: ${matches.length} existing match(es) of ${p.candidates?.length ?? 0} candidates`,
        matches,
        link: null,
      };
    },
  },
  'action-create': {
    tool: 'create_or_update_action',
    args: (p) => ({
      title: p.summary ?? p.title ?? 'Follow-up',
      description: p.description ?? p.summary,
      dueAt: p.dueAt,
      assigneeEmail: p.assigneeEmail ?? p.approvingAm,
      relatedContactEmail: p.contactEmail,
      relatedOpportunityDomain: p.canonicalDomain,
      channel: p.channel,
    }),
    type: 'action',
    extractRecord: (parsed, p) => {
      const r = parsed?.action ?? parsed?.record ?? parsed;
      return {
        id: r?.objectId ?? r?.id,
        name: r?.title ?? p.summary,
        link: r?.objectId ? `${baseUrl()}/actions/${r.objectId}` : null,
      };
    },
  },
  'draft-create': {
    tool: 'create_email_draft',
    args: (p) => ({
      to: p.contactEmail ?? p.to,
      subject: p.subject,
      body: p.bodyHtml ?? p.body,
      relatedOpportunityDomain: p.canonicalDomain,
    }),
    type: 'draft',
    extractRecord: (parsed, p) => {
      const r = parsed?.draft ?? parsed?.record ?? parsed;
      return {
        id: r?.objectId ?? r?.id,
        name: r?.title ?? p.subject,
        link: r?.objectId ? `${baseUrl()}/drafts/${r.objectId}` : null,
      };
    },
  },
  'review-context': {
    tool: 'create_or_update_workspace_context',
    args: (p) => ({
      title: p.summary ?? p.title ?? 'Review required',
      content: p.reason ?? p.bodyMarkdown ?? '',
      relatedOrganizationDomain: p.canonicalDomain,
    }),
    type: 'page',
    extractRecord: (parsed, p) => {
      const r = parsed?.context ?? parsed?.record ?? parsed;
      return {
        id: r?.objectId ?? `review-${p.canonicalDomain}-${Date.now()}`,
        name: r?.title ?? p.summary ?? 'Review context',
        link: r?.objectId ? `${baseUrl()}/contexts/${r.objectId}` : null,
      };
    },
  },
};

export async function dayAiWrite({ action, approvingAm, canonicalDomain, idempotencyKey, retry, dayAiToken, ...rest }) {
  if (!approvingAm) throw new Error('approvingAm required for Day AI writes');
  if (!idempotencyKey) throw new Error('idempotencyKey required for Day AI writes');

  const prior = await lookupIdempotency(idempotencyKey);
  if (prior && !retry) {
    return { ok: true, replayed: true, action, ...prior };
  }
  if (prior && retry) {
    return { ok: true, replayed: true, retried: true, action, ...prior };
  }

  if (!credsReady()) {
    throw new Error('Day AI credentials missing; set CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN.');
  }

  const handler = WRITE_HANDLERS[action];
  if (!handler) throw new Error(`Unknown Day AI write action: ${action}`);

  const payload = { approvingAm, canonicalDomain, idempotencyKey, ...rest };
  let record;
  let type;
  if (handler.run) {
    const out = await handler.run(payload);
    record = out.record;
    type = out.type;
  } else {
    // dayAiToken (the signed-in AM's refresh token) attributes the write to that AM;
    // undefined falls back to the shared integration token.
    const result = await mcpCallTool(handler.tool, handler.args(payload), dayAiToken);
    const parsed = parseMcpResult(result);
    record = handler.extractRecord(parsed, payload);
    type = handler.type;
  }

  if (!record?.id) {
    throw new Error(`Day AI ${handler.tool ?? action} returned no record ID`);
  }

  const persisted = {
    type,
    id: record.id,
    name: record.name,
    link: record.link,
    idempotencyKey,
    approvingAm,
    canonicalDomain,
    writtenAt: new Date().toISOString(),
  };
  await recordIdempotency(idempotencyKey, persisted);

  return { ok: true, action, ...persisted, raw: record };
}

export async function writeDayAiContextPage({ canonicalDomain, organizationId, title, bodyMarkdown, approvingAm }) {
  if (!credsReady()) throw new Error('Day AI credentials missing');
  const result = await mcpCallTool('create_or_update_workspace_context', {
    title,
    content: bodyMarkdown,
    relatedOrganizationDomain: canonicalDomain,
    relatedOrganizationId: organizationId,
  });
  const parsed = parseMcpResult(result);
  const r = parsed?.context ?? parsed?.record ?? parsed;
  return {
    pageId: r?.objectId ?? null,
    link: r?.objectId ? `${baseUrl()}/contexts/${r.objectId}` : null,
  };
}
