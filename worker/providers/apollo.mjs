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
    data = await apolloFetch('/v1/mixed_people/search', {
      q_organization_domains: canonicalDomain,
      person_titles: keywords,
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
  return {
    status: enriched.length === 0 ? 'failed' : 'ok',
    enriched,
    creditsConsumed,
    approvingAm,
    headlineReason: `Enriched ${creditsConsumed} of ${candidateIds.length} candidate(s).`,
  };
}

function normalizePerson(p, roleBuckets) {
  const title = p.title ?? p.headline ?? '';
  const email = p.email ?? null;
  const emailStatus = p.email_status ?? null;
  const matchedRoleBucket = matchRoleBucket(title, roleBuckets);
  const seniority = p.seniority ?? '';

  let tier = 'Hold';
  let tierReason = 'weak role fit';

  const seniorityRank = ['c_suite', 'founder', 'vp', 'head', 'director', 'manager'].some((s) =>
    String(seniority).toLowerCase().includes(s),
  );
  const hasGoodTitle = matchedRoleBucket && seniorityRank;
  const hasOkTitle = matchedRoleBucket || seniorityRank;
  const hasUsableEmail = emailStatus === 'verified' || emailStatus === 'likely_to_engage';

  if (hasGoodTitle && hasUsableEmail) {
    tier = 'Recommended';
    tierReason = `strong fit: ${matchedRoleBucket}, ${seniority}`;
  } else if (hasGoodTitle || (hasOkTitle && email)) {
    tier = 'Maybe';
    tierReason = matchedRoleBucket ? `role fit but evidence incomplete` : `seniority fit, role unclear`;
  } else if (!email) {
    tier = 'Hold';
    tierReason = 'no email found';
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

function matchRoleBucket(title, roleBuckets) {
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
