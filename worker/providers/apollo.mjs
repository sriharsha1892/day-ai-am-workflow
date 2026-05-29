// Apollo provider. People Search (free against Apollo metadata) + selective enrich (credit-consuming).
// Tiers candidates Recommended/Maybe/Hold per workflow/config/ux-guidance.json contactCardTiers semantics.

import fs from 'node:fs';
import path from 'node:path';

const PACKS = JSON.parse(fs.readFileSync(path.resolve('workflow/config/packs.json'), 'utf8'));

function apiKey() {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new Error('Missing APOLLO_API_KEY');
  return k;
}

async function apolloFetch(endpoint, body) {
  const response = await fetch(`https://api.apollo.io${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey(),
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`Apollo ${response.status}: ${safeMessage(text)}`);
    err.status = response.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

// Apollo's newer search endpoints (mixed_people/api_search) take params in the QUERY STRING with
// bracket array notation, not a JSON body — and live under /api/v1, not /v1.
async function apolloApiSearch(path, params) {
  const url = new URL(`https://api.apollo.io${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  // Auth both ways: header (current endpoints) and api_key query param (some search endpoints
  // expect it inline). Whichever Apollo honors for api_search, we're covered.
  url.searchParams.set('api_key', apiKey());
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', accept: 'application/json', 'X-Api-Key': apiKey() },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`Apollo ${response.status}: ${safeMessage(text)}`);
    err.status = response.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

export async function probe() {
  const response = await fetch('https://api.apollo.io/v1/auth/health', {
    headers: { 'X-Api-Key': apiKey() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Apollo health ${response.status}`);
  return { ok: true };
}

export async function fetchApolloOrgByDomain(domain) {
  if (!domain) return null;
  try {
    const data = await apolloFetch('/v1/mixed_companies/search', {
      q_organization_domains: domain,
      per_page: 1,
    });
    return data?.organizations?.[0] ?? data?.accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function apolloPeopleSearch({ canonicalDomain, personaPack = 'balanced', targetRoleBuckets = [], titleKeywords = [], limit = 25 }) {
  if (!canonicalDomain) {
    return { status: 'no_data', candidateCount: 0, candidates: [], tieredCounts: { recommended: 0, maybe: 0, hold: 0 } };
  }

  const pack = PACKS.personaPacks?.[personaPack] ?? PACKS.personaPacks?.balanced;
  const roleBuckets = targetRoleBuckets.length > 0 ? targetRoleBuckets : pack?.roleBuckets ?? [];
  const keywords = titleKeywords.length > 0 ? titleKeywords : roleBuckets;

  let data;
  try {
    // New (non-deprecated) people search: /api/v1/mixed_people/api_search, params in query string.
    data = await apolloApiSearch('/api/v1/mixed_people/api_search', {
      'q_organization_domains_list[]': [canonicalDomain],
      'person_titles[]': keywords,
      // Focus on decision-makers so results are tier-able (excludes entry/intern/senior-IC noise).
      'person_seniorities[]': ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager'],
      per_page: Math.min(limit, 25),
      page: 1,
    });
  } catch (error) {
    return {
      status: 'failed',
      candidateCount: 0,
      candidates: [],
      tieredCounts: { recommended: 0, maybe: 0, hold: 0 },
      headlineReason: error.message,
    };
  }

  const rawPeople = (data?.people ?? data?.contacts ?? []).slice(0, limit);
  const candidates = rawPeople.map((p) => normalizePerson(p, roleBuckets));
  const tieredCounts = candidates.reduce(
    (acc, c) => {
      acc[c.tier.toLowerCase()] += 1;
      return acc;
    },
    { recommended: 0, maybe: 0, hold: 0 },
  );

  return {
    status: candidates.length === 0 ? 'no_data' : 'ok',
    canonicalDomain,
    personaPack,
    candidateCount: candidates.length,
    candidates,
    tieredCounts,
    creditsConsumed: 0,
    headlineReason:
      candidates.length === 0
        ? 'Apollo returned no candidates for this domain + persona filter.'
        : `${candidates.length} candidates (${tieredCounts.recommended} Recommended / ${tieredCounts.maybe} Maybe / ${tieredCounts.hold} Hold).`,
  };
}

export async function apolloEnrich({ candidateIds, approvingAm }) {
  if (!candidateIds || candidateIds.length === 0) {
    return { status: 'no_data', enriched: [], creditsConsumed: 0 };
  }
  const enriched = [];
  let creditsConsumed = 0;
  for (const id of candidateIds) {
    try {
      const data = await apolloFetch('/v1/people/match', { id });
      const p = data?.person;
      if (p) {
        enriched.push(normalizePerson(p, []));
        creditsConsumed += 1;
      }
    } catch (error) {
      enriched.push({ apolloPersonId: id, status: 'failed', error: error.message });
    }
  }
  if (creditsConsumed) {
    const { recordUsage } = await import('../credits.mjs');
    await recordUsage(approvingAm, 'apollo', creditsConsumed);
  }
  return {
    status: enriched.length === 0 ? 'failed' : 'ok',
    enriched,
    creditsConsumed,
    approvingAm,
    headlineReason: `Enriched ${creditsConsumed} of ${candidateIds.length} candidate(s).`,
  };
}

export function normalizePerson(p, roleBuckets) {
  const title = p.title ?? p.headline ?? '';
  const email = p.email ?? null;
  const emailStatus = p.email_status ?? null;
  const matchedRoleBucket = matchRoleBucket(title, roleBuckets);
  const seniority = p.seniority ?? '';

  // Tier on what SEARCH actually returns: title→persona fit + seniority. The email address is
  // masked until enrich, so it must NOT gate tiering here (that bug put everyone in Hold). Only a
  // known-unreachable email (email_status 'unavailable') forces Hold. Reachability is confirmed
  // later by enrich + Clearout.
  const seniorityStr = String(seniority).toLowerCase();
  const isSenior = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director'].some((s) => seniorityStr.includes(s));
  const isMid = seniorityStr.includes('manager');
  const roleFit = Boolean(matchedRoleBucket);
  const emailUnreachable = emailStatus === 'unavailable';

  let tier;
  let tierReason;
  if (emailUnreachable) {
    tier = 'Hold';
    tierReason = 'no reachable email at this account';
  } else if (roleFit && (isSenior || isMid)) {
    tier = 'Recommended';
    tierReason = `strong fit: ${matchedRoleBucket}${seniority ? `, ${seniority}` : ''}`;
  } else if (roleFit || isSenior) {
    tier = 'Maybe';
    tierReason = roleFit ? 'role fit; seniority unclear' : `senior (${seniority || 'leader'}); role unclear`;
  } else {
    tier = 'Hold';
    tierReason = 'weak role/seniority fit';
  }

  return {
    apolloPersonId: p.id ?? p.person_id ?? null,
    name: p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    email,
    emailStatus,
    title,
    seniority,
    department: p.departments?.[0] ?? p.department,
    linkedinUrl: p.linkedin_url,
    organizationName: p.organization?.name,
    organizationDomain: p.organization?.primary_domain,
    roleBucket: matchedRoleBucket,
    tier,
    tierReason,
    evidenceTrail: [
      title ? `title=${title}` : null,
      seniority ? `seniority=${seniority}` : null,
      emailStatus ? `emailStatus=${emailStatus}` : null,
    ].filter(Boolean),
  };
}

export function matchRoleBucket(title, roleBuckets) {
  const t = String(title).toLowerCase();
  for (const bucket of roleBuckets) {
    const tokens = bucket.toLowerCase().split(/[\s/]+/);
    if (tokens.some((tok) => tok.length >= 3 && t.includes(tok))) return bucket;
  }
  return null;
}

function safeMessage(text) {
  if (!text) return 'no body';
  try {
    const data = JSON.parse(text);
    return String(data.message ?? data.error ?? data.errors ?? '').slice(0, 300);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 300);
  }
}
