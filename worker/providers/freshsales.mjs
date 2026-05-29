// Freshsales provider. Read-only. Lifts scripts/freshsales-probe.mjs auth pattern.
// Worker is the only place Freshsales credentials live. AMs never see them.
// Evidence is cached 1h (worker/cache.mjs) so resolve_identity / receipt / per-contact guards
// share one pull instead of re-hitting the CRM. Transport/auth failures are surfaced as a distinct
// 'failed' status (NOT 'no_data') so an outage can't masquerade as an empty CRM and trigger a dup org.

import { cached, freshsalesKey, TTL } from '../cache.mjs';

const orgDomainEnv = () => process.env.FRESHSALES_ORG_DOMAIN ?? 'mordorintelligence';
const apiKeyEnv = () => process.env.FRESHSALES_API_KEY;

function tenantBase() {
  return `https://${orgDomainEnv()}.freshsales.io`;
}

function authHeaders() {
  const key = apiKeyEnv();
  if (!key) throw new Error('Missing FRESHSALES_API_KEY');
  return {
    Authorization: `Token token=${key}`,
    'Content-Type': 'application/json',
  };
}

async function freshsalesFetch(path, options = {}) {
  const url = new URL(path, tenantBase());
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...authHeaders(),
      Connection: 'close',
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(8_000),
    keepalive: false,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`Freshsales ${response.status}: ${safeMessage(text)}`);
    err.status = response.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

export async function probe() {
  const owners = await freshsalesFetch('/api/selector/owners');
  const dealStages = await freshsalesFetch('/api/selector/deal_stages');
  const fields = await freshsalesFetch('/api/settings/contacts/fields');
  return {
    ok: true,
    tenant: tenantBase(),
    counts: {
      owners: Array.isArray(owners?.users) ? owners.users.length : 0,
      dealStages: Array.isArray(dealStages?.deal_stages) ? dealStages.deal_stages.length : 0,
      contactFields: Array.isArray(fields?.fields) ? fields.fields.length : 0,
    },
  };
}

// Throws on transport/auth error so callers can distinguish an outage from a genuinely empty CRM.
async function lookupAccountsByDomain(domain) {
  if (!domain) return [];
  // Freshsales universal lookup endpoint. Fast, no view-ID dependency.
  const data = await freshsalesFetch(
    `/api/lookup?q=${encodeURIComponent(domain)}&f=website&entities=sales_account`,
  );
  // Freshsales lookup returns { sales_accounts: { sales_accounts: [...] } } (nested).
  const list = data?.sales_accounts?.sales_accounts ?? data?.sales_accounts ?? [];
  return list.map((acct) => ({
    id: acct.id,
    name: acct.name,
    domain: acct.website ?? domain,
    owner: acct.owner_id,
  }));
}

// Backward-compatible swallow (used by identity.mjs, which treats [] as "no match").
export async function fetchFreshsalesAccountsByDomain(domain) {
  try {
    return await lookupAccountsByDomain(domain);
  } catch {
    return [];
  }
}

// owner_id -> human name map, so contact rows read "owner Satish", not "owner 4471". Cached 24h
// (owners change rarely); best-effort — falls back to the numeric id in the renderer on any failure.
async function getOwnersMap(refresh = false) {
  const res = await cached(
    'freshsales:owners',
    24 * 3600,
    async () => {
      const data = await freshsalesFetch('/api/selector/owners');
      const users = Array.isArray(data?.users) ? data.users : [];
      const map = {};
      for (const u of users) {
        if (u?.id == null) continue;
        const name = u.display_name || u.name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;
        if (name) map[u.id] = name;
      }
      return map;
    },
    { refresh, shouldCache: (v) => v && Object.keys(v).length > 0 },
  ).catch(() => ({ value: {} }));
  return res.value ?? {};
}

async function fetchContactsForAccount(accountId, limit, ownersMap = {}) {
  try {
    // Universal lookup also works for contacts; filter via sales_account_id include.
    const data = await freshsalesFetch(
      `/api/sales_accounts/${accountId}?include=contacts`,
    );
    const list = data?.sales_account?.contacts ?? data?.contacts ?? [];
    return list.slice(0, limit).map((c) => ({
      id: c.id,
      name: c.display_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
      email: c.email,
      title: c.job_title,
      owner: c.owner_id,
      ownerName: ownersMap[c.owner_id] ?? null,
      accountId,
      // Only a real sales activity counts as a touch — NOT updated_at (a field edit must not read
      // as "recently contacted" in the already-contacted guard). Null when there's no real touch.
      lastActivity: c.last_contacted_via_sales_activity ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchDealsForAccount(accountId, limit) {
  try {
    const data = await freshsalesFetch(
      `/api/sales_accounts/${accountId}?include=deals`,
    );
    const list = data?.sales_account?.deals ?? data?.deals ?? [];
    return list.slice(0, limit).map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.deal_stage_id,
      amount: d.amount,
      updatedAt: d.updated_at,
      accountId,
    }));
  } catch {
    return [];
  }
}

// `aliases` is echoed for callers; conversation/notes pulls are not implemented in v1 (the dead
// includeConversations/includeNotes params were removed — see dedupe-contacts.md for v1 scope).
export async function fetchFreshsalesEvidence({ canonicalDomain, accountName, aliases = [], maxRecords = 100, refresh = false }) {
  if (!canonicalDomain) {
    return { status: 'no_data', canonicalDomain, accountName, aliases, accounts: [], contacts: [], deals: [], duplicateRisk: 'none', evidenceCount: 0, headlineReason: 'No domain provided.' };
  }

  const res = await cached(
    freshsalesKey(canonicalDomain),
    TTL.freshsales,
    async () => {
      let accounts;
      try {
        accounts = await lookupAccountsByDomain(canonicalDomain);
      } catch (error) {
        // Transport/auth failure — DISTINCT from an empty CRM. Surfaced as 'failed' (→ Red receipt),
        // never cached, so resolve_identity won't mistake an outage for "no existing org".
        return {
          status: 'failed',
          canonicalDomain,
          accountName,
          aliases,
          accounts: [],
          contacts: [],
          deals: [],
          duplicateRisk: 'unknown',
          evidenceCount: 0,
          error: error.message,
          headlineReason: `Freshsales unreachable from worker: ${error.message}`,
        };
      }

      const targetAccounts = accounts.slice(0, 5);
      const ownersMap = await getOwnersMap().catch(() => ({}));
      const perAccountResults = await Promise.all(
        targetAccounts.map(async (acct) => ({
          contacts: await fetchContactsForAccount(acct.id, maxRecords, ownersMap),
          deals: await fetchDealsForAccount(acct.id, 20),
        })),
      );
      const contacts = perAccountResults.flatMap((r) => r.contacts);
      const deals = perAccountResults.flatMap((r) => r.deals);

      const duplicateRisk =
        accounts.length === 0
          ? 'none'
          : accounts.length === 1
            ? 'low'
            : accounts.length <= 3
              ? 'medium'
              : 'high';

      return {
        status: accounts.length === 0 && contacts.length === 0 ? 'no_data' : 'ok',
        canonicalDomain,
        accountName,
        aliases,
        accounts,
        contacts,
        deals,
        duplicateRisk,
        evidenceCount: accounts.length + contacts.length + deals.length,
        headlineReason:
          accounts.length === 0
            ? 'No Freshsales sales account matched this domain.'
            : `${accounts.length} Freshsales account(s), ${contacts.length} contact(s), ${deals.length} deal(s).`,
      };
    },
    { refresh, shouldCache: (v) => v.status !== 'failed' },
  );

  return { ...res.value, fromCache: res.fromCache, cachedAt: res.cachedAt, ageHours: res.ageHours };
}

function safeMessage(text) {
  if (!text) return 'no body';
  try {
    const data = JSON.parse(text);
    return String(data.message ?? data.error ?? data.errors ?? data.description ?? '').slice(0, 300);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 300);
  }
}
