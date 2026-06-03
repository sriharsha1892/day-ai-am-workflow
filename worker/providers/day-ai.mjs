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

export function credsReady() {
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

// Day AI rotates refresh tokens on use. Instance-local chain: a stale token -> its rotation, so a
// warm worker keeps presenting the freshest token instead of re-failing on the original. (Cross-
// instance persistence to the broker store is a separate, live-tested follow-up; the shared-token
// fallback already prevents lockout when a cold instance hits an already-rotated token.)
const rotatedRefreshTokens = new Map();
function freshestRefresh(token) {
  let t = token;
  const seen = new Set();
  while (t && rotatedRefreshTokens.has(t) && !seen.has(t)) {
    seen.add(t);
    t = rotatedRefreshTokens.get(t);
  }
  return t;
}

// refreshOverride: a specific AM's Day AI refresh token (from the OAuth broker) so the
// write is attributed to that AM. Omitted → the shared integration REFRESH_TOKEN.
async function ensureAccessToken(refreshOverride) {
  const baseToken = refreshOverride ?? process.env.REFRESH_TOKEN;
  if (!baseToken) throw new Error('No Day AI refresh token available');
  const refreshToken = refreshOverride ? freshestRefresh(baseToken) : baseToken;
  const cacheKey = refreshOverride ? `am:${baseToken.slice(-12)}` : 'shared';

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
  if (refreshOverride && data.refresh_token && data.refresh_token !== refreshToken) {
    rotatedRefreshTokens.set(refreshToken, data.refresh_token);
    if (baseToken !== refreshToken) rotatedRefreshTokens.set(baseToken, data.refresh_token);
  }
  const expiresIn = data.expires_in ?? 3600;
  const entry = { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  tokenCaches.set(cacheKey, entry);
  return entry.accessToken;
}

// A per-AM Day AI token that's stale/revoked/rotated must not block the AM. Detect auth-shaped
// refresh failures so mcpCallTool can fall back to the shared integration token.
function isReauthError(err) {
  return /401|403|invalid_grant|invalid_token|unauthor|token refresh/i.test(String(err?.message ?? err));
}

async function mcpCallTool(toolName, args = {}, refreshOverride) {
  let accessToken;
  let usedSharedFallback = false;
  try {
    accessToken = await ensureAccessToken(refreshOverride);
  } catch (err) {
    // Stale per-AM token -> fall back to the shared integration token + flag degraded attribution
    // (decision 2026-06-01). A shared-token failure (no override) is a real outage and rethrows.
    if (refreshOverride && isReauthError(err)) {
      accessToken = await ensureAccessToken(undefined);
      usedSharedFallback = true;
    } else {
      throw err;
    }
  }
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
  const result = data.result ?? data;
  if (usedSharedFallback && result && typeof result === 'object') result.__sharedFallback = true;
  return result;
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

// Several create_or_update_* Day AI tools (action / draft / workspace-context) legitimately return a
// human-readable confirmation STRING with no id JSON. For handlers flagged `confirmsWithoutId` we
// accept a genuine success — a non-empty parsed body that does NOT read as a failure (isError is
// guarded separately) — rather than parking it forever as "no record id returned".
function hasContent(parsed) {
  if (!parsed) return false;
  if (typeof parsed._raw === 'string') return parsed._raw.trim().length > 0;
  return Object.keys(parsed).length > 0;
}
function looksLikeFailure(parsed) {
  if (!parsed) return false;
  if (parsed.success === false || parsed.error || parsed.errors) return true;
  const raw = typeof parsed._raw === 'string' ? parsed._raw : '';
  return /\b(error|failed|invalid|denied|unauthor|not found|rejected)\b/i.test(raw);
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
    args: (p) => {
      const out = {
        isCreating: true,
        objectType: 'native_organization', // live enum is native_organization|native_contact (NOT 'Organization')
        objectId: p.canonicalDomain,
        standardProperties: { domain: p.canonicalDomain, name: p.accountName ?? p.canonicalDomain },
      };
      // Pass-through custom properties (e.g., AM Account List option UUID at creation).
      // Caller resolves option UUIDs from templates/day-ai-workspace-ids.json. Shape per Day.ai MCP:
      //   [{ propertyId: "uuid", value: <string|number|boolean|array|null>, reasoning?: "..." }]
      if (Array.isArray(p.customProperties) && p.customProperties.length) {
        out.customProperties = p.customProperties;
      }
      return out;
    },
    type: 'organization',
    // objectId is deterministically the domain — the write response need not echo it.
    extractRecord: (parsed, p) => ({
      id: p.canonicalDomain,
      name: p.accountName ?? parsed?.title ?? p.canonicalDomain,
      link: orgLink(p.canonicalDomain),
    }),
  },
  'org-update-tags': {
    // Admin-scope: update an EXISTING org's custom properties only (e.g., AM Account List,
    // Account Status, Vertical). Used by W4 cleanup scripts. Not exposed via the dayai_write
    // MCP tool by default — admin scripts invoke via the same dispatcher.
    tool: 'create_or_update_person_organization',
    args: (p) => {
      if (!p.canonicalDomain) throw new Error('org-update-tags requires canonicalDomain');
      if (!Array.isArray(p.customProperties) || !p.customProperties.length) {
        throw new Error('org-update-tags requires non-empty customProperties array');
      }
      return {
        isCreating: false,
        objectType: 'native_organization',
        objectId: p.canonicalDomain,
        customProperties: p.customProperties,
      };
    },
    type: 'organization',
    extractRecord: (_parsed, p) => ({
      id: p.canonicalDomain,
      name: p.canonicalDomain,
      link: orgLink(p.canonicalDomain),
    }),
  },
  'contact-update-tags': {
    // Admin-scope: update an EXISTING contact's custom properties only (e.g., Contact Status).
    // Used by W4 cleanup scripts. Contact objectId is the email address.
    tool: 'create_or_update_person_organization',
    args: (p) => {
      if (!p.contactEmail) throw new Error('contact-update-tags requires contactEmail');
      if (!Array.isArray(p.customProperties) || !p.customProperties.length) {
        throw new Error('contact-update-tags requires non-empty customProperties array');
      }
      return {
        isCreating: false,
        objectType: 'native_contact',
        objectId: p.contactEmail,
        customProperties: p.customProperties,
      };
    },
    type: 'person',
    extractRecord: (_parsed, p) => ({
      id: p.contactEmail,
      name: p.contactEmail,
      link: `${baseUrl()}/people/${encodeURIComponent(p.contactEmail)}`,
    }),
  },
  'opportunity-create': {
    tool: 'create_or_update_opportunity',
    args: (p) => {
      const out = {
        isCreating: true,
        standardProperties: {
          title: p.title ?? `${p.canonicalDomain} - Researching`,
          stageId: p.stageId,
          domain: p.canonicalDomain,
          ownerEmail: p.ownerEmail ?? p.approvingAm,
          expectedRevenue: p.expectedRevenue,
          expectedCloseDate: p.expectedCloseDate,
        },
      };
      // Pass-through custom properties. Caller is responsible for using the
      // workspace property + option UUIDs from templates/day-ai-workspace-ids.json.
      // Day.ai MCP shape: [{ propertyId: "uuid", value: <string|number|boolean|array|null>, reasoning?: "..." }]
      // For picklist properties, `value` MUST be the option ID (UUID), not the display name.
      if (Array.isArray(p.customProperties) && p.customProperties.length) {
        out.customProperties = p.customProperties;
      }
      return out;
    },
    type: 'opportunity',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id, // no fabrication: a missing id means Day AI didn't confirm the write -> dayAiWrite queues a pendingSync
        name: parsed?.title ?? p.title ?? `${p.canonicalDomain} opportunity`,
        link: id ? `${baseUrl()}/opportunities/${id}` : null,
      };
    },
  },
  'opportunity-update-stage': {
    tool: 'create_or_update_opportunity',
    // stage transitions return a confirmation string without echoing the id JSON — same pattern
    // as action-create. We know the id (caller passed opportunityId), so extractRecord can return
    // it deterministically without a read-back.
    confirmsWithoutId: true,
    args: (p) => {
      if (!p.opportunityId) throw new Error('opportunity-update-stage requires opportunityId');
      if (!p.stageId) throw new Error('opportunity-update-stage requires stageId (target stage UUID)');
      const out = {
        isCreating: false,
        objectId: p.opportunityId,
        standardProperties: { stageId: p.stageId },
      };
      if (Array.isArray(p.customProperties) && p.customProperties.length) {
        out.customProperties = p.customProperties;
      }
      return out;
    },
    type: 'opportunity',
    extractRecord: (_parsed, p) => ({
      id: p.opportunityId, // we passed it in — confirmed by the call returning without error
      name: `Opportunity ${String(p.opportunityId).slice(0, 8)}`,
      link: `${baseUrl()}/opportunities/${p.opportunityId}`,
    }),
  },
  'person-create': {
    tool: 'create_or_update_person_organization',
    // Dedup-on-write: search Day AI for an existing contact by email first; if found, UPDATE it
    // (isCreating:false + objectId) instead of creating a duplicate Person. Best-effort — a search
    // failure never blocks the write (it proceeds as a create).
    async prepare(p) {
      const email = (p.candidate ?? p).email;
      if (!email || !credsReady()) return {};
      try {
        const parsed = parseMcpResult(
          await mcpCallTool('search_objects', {
            queries: [{ objectType: 'native_contact', where: { propertyId: 'email', operator: 'eq', value: email } }],
            propertiesToReturn: '*',
          }),
        );
        const match = parsed?.native_contact?.results?.[0];
        const existingPersonId = match?.objectId ?? match?.id ?? null;
        return existingPersonId ? { existingPersonId } : {};
      } catch {
        return {};
      }
    },
    args: (p) => {
      const candidate = p.candidate ?? p;
      return {
        isCreating: !p.existingPersonId, // update in place when the email already exists
        objectType: 'native_contact', // live enum is native_organization|native_contact (NOT 'Person')
        ...(p.existingPersonId ? { objectId: p.existingPersonId } : {}),
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
      // existingPersonId is a real Day AI id (from the dedup search), so an update is confirmed even
      // if the response doesn't re-echo the id. A bare create with no echoed id stays unconfirmed.
      const id = idFromResponse(parsed) ?? p.existingPersonId ?? null;
      const email = candidate.email;
      return {
        id,
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
    confirmsWithoutId: true, // create_or_update_action returns a confirmation string, no id JSON
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
        id, // no id echoed -> readBack tries to recover it; else the gate stores a pending-action token
        name: parsed?.title ?? p.summary ?? p.title ?? 'Action',
        link: id ? `${baseUrl()}/actions/${id}` : null,
      };
    },
    // Advisory: actions have no natural key, so after an id-less success try a best-effort search to
    // recover the real objectId. Bind ONLY on an unambiguous single owner+title match; any miss or
    // ambiguity returns null (gate then stores the namespaced token). Never re-throws. If the
    // objectType is wrong it simply finds nothing -> safe degrade to the pending-action token.
    async readBack(p, dayAiToken) {
      if (!credsReady()) return null;
      const title = p.summary ?? p.title ?? 'Follow-up';
      const owner = p.assigneeEmail ?? p.ownerEmail ?? p.approvingAm;
      try {
        const parsed = parseMcpResult(
          await mcpCallTool(
            'search_objects',
            { queries: [{ objectType: 'native_action', where: { propertyId: 'title', operator: 'eq', value: title } }], propertiesToReturn: '*' },
            dayAiToken,
          ),
        );
        const results = parsed?.native_action?.results ?? [];
        const owned = owner ? results.filter((r) => (r.ownerEmail ?? r.properties?.ownerEmail ?? r.standardProperties?.ownerEmail) === owner) : results;
        const hit = owned.length === 1 ? owned[0] : null;
        const id = hit?.objectId ?? hit?.id ?? null;
        return id ? { id, link: `${baseUrl()}/actions/${id}` } : null;
      } catch {
        return null;
      }
    },
  },
  'draft-create': {
    tool: 'create_email_draft',
    confirmsWithoutId: true, // create_email_draft returns a confirmation string, no id JSON
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
        id, // no fabrication -> unconfirmed draft queues a pendingSync
        name: parsed?.title ?? p.subject ?? 'Draft',
        link: id ? `${baseUrl()}/drafts/${id}` : null,
      };
    },
  },
  'review-context': {
    tool: 'create_or_update_workspace_context',
    // Live schema: mode + plainTextValue (REQUIRED, min 1 char) + attach to the org via
    // objectType+objectId. The body arrives from the LLM under varying keys — resolve from any
    // reasonable one and FAIL LOUDLY if truly empty (never send plainTextValue:'' -> Day AI Zod reject).
    confirmsWithoutId: true, // create_or_update_workspace_context returns a confirmation string, no id
    args: (p) => {
      const body = p.plainTextValue ?? p.reason ?? p.bodyMarkdown ?? p.markdown ?? p.body ?? p.content ?? p.text ?? p.note ?? p.description;
      if (!body || !String(body).trim()) {
        throw new Error(`review-context needs non-empty body text (set one of: content/reason/bodyMarkdown/text/markdown/note). Got payload keys: ${Object.keys(p).join(', ') || '(none)'}`);
      }
      return {
        mode: 'create',
        plainTextValue: String(body).trim(),
        title: p.summary ?? p.title ?? 'Review required',
        summary: p.summary ?? p.title,
        attachmentType: 'object',
        objectType: 'native_organization',
        objectId: p.canonicalDomain,
      };
    },
    type: 'page',
    extractRecord: (parsed, p) => {
      const id = idFromResponse(parsed);
      return {
        id, // no id echoed -> the confirmsWithoutId gate records a namespaced pending-page token
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
  let sharedFallback = false;
  let parsedBody = null;
  if (handler.run) {
    const out = await handler.run(payload);
    record = out.record;
    type = out.type;
  } else {
    // dayAiToken (the signed-in AM's refresh token) attributes the write to that AM;
    // undefined falls back to the shared integration token.
    if (handler.prepare) Object.assign(payload, (await handler.prepare(payload)) ?? {});
    const result = await mcpCallTool(handler.tool, handler.args(payload), dayAiToken);
    // Day AI can return a tool-level error (result.isError) WITHOUT a JSON-RPC error — mcpCallTool
    // lets that through, so guard here or extractRecord fabricates success on a failed write.
    if (result?.isError) {
      const msg = result.content?.[0]?.text ?? 'Day AI tool reported isError';
      throw new Error(`Day AI ${handler.tool} error: ${String(msg).slice(0, 300)}`);
    }
    sharedFallback = Boolean(result?.__sharedFallback);
    parsedBody = parseMcpResult(result);
    record = handler.extractRecord(parsedBody, payload);
    type = handler.type;
  }

  // Confirmation gate. Confirmed when Day AI echoes a real objectId or a domain-keyed org id.
  // Some create_or_update_* tools (action/draft/context) legitimately return only a confirmation
  // STRING with no id; for those (handler.confirmsWithoutId) accept a genuine success — isError was
  // already guarded above, the parsed body is non-empty, and it doesn't read as a soft failure —
  // then (advisory) try a read-back to recover the real id, else store a NAMESPACED local correlation
  // token (never a Day AI id/URL) so retry stops re-issuing. Still throw for id-bearing handlers
  // (org/opportunity/person) with no id, or when the response reads as a failure. Never fabricate.
  if (!record?.id) {
    if (handler.confirmsWithoutId && hasContent(parsedBody) && !looksLikeFailure(parsedBody)) {
      const recovered = handler.readBack ? await handler.readBack(payload, dayAiToken).catch(() => null) : null;
      record = recovered?.id
        ? { ...record, id: recovered.id, link: recovered.link ?? null }
        : { ...record, id: `pending-${type}:${idempotencyKey}`, link: null };
    } else {
      throw new Error(`Day AI ${handler.tool ?? action} write not confirmed (no record id returned) — queued for retry`);
    }
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
    attributedVia: sharedFallback ? 'shared-fallback' : dayAiToken ? 'per-am' : 'shared',
  };
  await recordIdempotency(idempotencyKey, persisted);

  return {
    ok: true,
    action,
    ...persisted,
    raw: record,
    ...(sharedFallback
      ? { attributionWarning: 'Your Day AI sign-in expired — saved via the shared service account. Re-link when you can: codex mcp login myra' }
      : {}),
  };
}

export async function writeDayAiContextPage({ canonicalDomain, organizationId, title, bodyMarkdown, approvingAm }) {
  if (!credsReady()) throw new Error('Day AI credentials missing');
  if (!bodyMarkdown || !String(bodyMarkdown).trim()) {
    throw new Error('writeDayAiContextPage: empty body — refusing to send plainTextValue:"" to Day AI');
  }
  const result = await mcpCallTool('create_or_update_workspace_context', {
    mode: 'create',
    plainTextValue: String(bodyMarkdown),
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
