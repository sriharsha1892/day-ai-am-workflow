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

const orgLink = (domain) => (domain ? `${baseUrl()}/organizations/${domain}` : null);

// Best-effort id dig across the shapes a Day AI write tool may return in content[0].text.
function idFromResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  return (
    parsed.objectId ?? parsed.id ?? parsed.draftId ?? parsed.actionId ?? parsed.contextId ??
    parsed.organization?.objectId ?? parsed.person?.objectId ?? parsed.opportunity?.objectId ??
    parsed.action?.objectId ?? parsed.draft?.objectId ?? parsed.context?.objectId ??
    parsed.record?.objectId ?? parsed.record?.id ?? null
  );
}

// Action verb -> { tool, args(payload), type, extractRecord }. args() shapes our internal payload
// into the EXACT arguments the live Day AI MCP tool expects (verified against day-ai-sdk SCHEMA.md
// + live tools/list, 2026-05-29): every create_or_update_* write takes its properties under
// `standardProperties`, NOT at the top level. Day AI orgs are domain-keyed (the canonical domain IS
// the organization objectId), so org writes/links don't need the response to echo an id.
export const WRITE_HANDLERS = {
  'org-link': {
    tool: null,
    // Orgs are domain-keyed; "linking" = the org exists at this domain. resolve_identity only routes
    // here when a Day AI org already exists (otherwise create_org_from_evidence -> org-create).
    async run({ canonicalDomain, matchedDayAiOrgId }) {
      const id = matchedDayAiOrgId ?? canonicalDomain ?? null;
      return { record: { id, name: canonicalDomain, link: orgLink(id) }, type: 'organization' };
    },
  },
  'org-create': {
    tool: 'create_or_update_person_organization',
    args: (p) => ({
      isCreating: true,
      objectType: 'native_organization', // live enum is native_organization|native_contact (NOT 'Organization')
      objectId: p.canonicalDomain,
      standardProperties: { domain: p.canonicalDomain, name: p.accountName ?? p.canonicalDomain },
    }),
    type: 'organization',
    // objectId is deterministically the domain — the write response need not echo it.
    extractRecord: (parsed, p) => ({
      id: p.canonicalDomain,
      name: p.accountName ?? parsed?.title ?? p.canonicalDomain,
      link: orgLink(p.canonicalDomain),
    }),
  },
  'opportunity-create': {
    tool: 'create_or_update_opportunity',
    args: (p) => ({
      isCreating: true,
      standardProperties: {
        title: p.title ?? `${p.canonicalDomain} - Researching`,
        stageId: p.stageId,
        domain: p.canonicalDomain,
        ownerEmail: p.ownerEmail ?? p.approvingAm,
        expectedRevenue: p.expectedRevenue,
        expectedCloseDate: p.expectedCloseDate,
      },
    }),
    type: 'opportunity',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id: id ?? `opp:${p.canonicalDomain}`,
        name: parsed?.title ?? p.title ?? `${p.canonicalDomain} opportunity`,
        link: id ? `${baseUrl()}/opportunities/${id}` : null,
      };
    },
  },
  'person-create': {
    tool: 'create_or_update_person_organization',
    args: (p) => {
      const candidate = p.candidate ?? p;
      return {
        isCreating: true,
        objectType: 'native_contact', // live enum is native_organization|native_contact (NOT 'Person')
        standardProperties: {
          email: candidate.email,
          firstName: candidate.firstName ?? candidate.name?.split(' ')[0],
          lastName: candidate.lastName ?? candidate.name?.split(' ').slice(1).join(' '),
          jobTitle: candidate.title ?? candidate.jobTitle,
          linkedInUrl: candidate.linkedinUrl ?? candidate.linkedInUrl,
          phoneNumbers: candidate.phone ? [candidate.phone] : undefined,
        },
      };
    },
    type: 'person',
    extractRecord: (parsed, p) => {
      const candidate = p.candidate ?? p;
      const id = idFromResponse(parsed);
      const email = candidate.email;
      return {
        id: id ?? email,
        name: parsed?.title ?? (`${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim() || candidate.name || email),
        link: id ? `${baseUrl()}/people/${id}` : null,
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
    // Live schema: ownerEmail / dueDate / people[] / domains[] / assignedToAssistant — NOT
    // assigneeEmail / dueAt / relatedContactEmail / relatedOpportunityDomain / channel.
    args: (p) => ({
      title: p.summary ?? p.title ?? 'Follow-up',
      assignedToAssistant: false,
      ownerEmail: p.assigneeEmail ?? p.ownerEmail ?? p.approvingAm,
      description: p.description ?? p.summary ?? (p.channel ? `Channel: ${p.channel}` : undefined),
      dueDate: p.dueAt ?? p.dueDate,
      people: p.contactEmail ? [p.contactEmail] : undefined,
      domains: p.canonicalDomain ? [p.canonicalDomain] : undefined,
    }),
    type: 'action',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id: id ?? `action:${p.canonicalDomain}:${String(p.contactEmail ?? p.summary ?? '').slice(0, 40)}`,
        name: parsed?.title ?? p.summary ?? p.title ?? 'Action',
        link: id ? `${baseUrl()}/actions/${id}` : null,
      };
    },
  },
  'draft-create': {
    tool: 'create_email_draft',
    // Live schema: `description` is REQUIRED; `to` is an ARRAY; no relatedOpportunityDomain field.
    args: (p) => ({
      description: p.description ?? (p.subject ? `First-touch: ${p.subject}` : 'First-touch outreach draft'),
      to: p.contactEmail ? [p.contactEmail] : Array.isArray(p.to) ? p.to : p.to ? [p.to] : undefined,
      subject: p.subject,
      body: p.bodyHtml ?? p.body,
    }),
    type: 'draft',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id: id ?? `draft:${p.canonicalDomain}:${String(p.contactEmail ?? p.subject ?? '').slice(0, 40)}`,
        name: parsed?.title ?? p.subject ?? 'Draft',
        link: id ? `${baseUrl()}/drafts/${id}` : null,
      };
    },
  },
  'review-context': {
    tool: 'create_or_update_workspace_context',
    // Live schema: mode + plainTextValue required; attach to the org via objectType+objectId
    // (NOT title/content/relatedOrganizationDomain).
    args: (p) => ({
      mode: 'create',
      plainTextValue: p.reason ?? p.bodyMarkdown ?? p.content ?? '',
      title: p.summary ?? p.title ?? 'Review required',
      summary: p.summary ?? p.title,
      attachmentType: 'object',
      objectType: 'native_organization',
      objectId: p.canonicalDomain,
    }),
    type: 'page',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id: id ?? `review-${p.canonicalDomain}-${Date.now()}`,
        name: parsed?.title ?? p.summary ?? 'Review context',
        link: id ? `${baseUrl()}/contexts/${id}` : null,
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
    // Day AI can return a tool-level error (result.isError) WITHOUT a JSON-RPC error — mcpCallTool
    // lets that through, so guard here or extractRecord fabricates success on a failed write.
    if (result?.isError) {
      const msg = result.content?.[0]?.text ?? 'Day AI tool reported isError';
      throw new Error(`Day AI ${handler.tool} error: ${String(msg).slice(0, 300)}`);
    }
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
    mode: 'create',
    plainTextValue: bodyMarkdown,
    title,
    summary: title,
    attachmentType: 'object',
    objectType: 'native_organization',
    objectId: organizationId ?? canonicalDomain,
  });
  if (result?.isError) {
    throw new Error(`Day AI create_or_update_workspace_context error: ${String(result.content?.[0]?.text ?? '').slice(0, 200)}`);
  }
  const parsed = parseMcpResult(result);
  const id = idFromResponse(parsed) ?? null;
  return {
    pageId: id,
    link: id ? `${baseUrl()}/contexts/${id}` : null,
  };
}
