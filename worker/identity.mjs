// Domain-first identity resolution. Lifts scoring + decision logic from
// scripts/org-resolution-preview.mjs verbatim, then adds live Day AI / Freshsales / Apollo evidence.

import fs from 'node:fs';
import path from 'node:path';
import { fetchDayAiOrgsByDomain, fetchDayAiOrgsByName } from './providers/day-ai.mjs';
import { fetchFreshsalesAccountsByDomain } from './providers/freshsales.mjs';
import { fetchApolloOrgByDomain } from './providers/apollo.mjs';

const POLICY = JSON.parse(
  fs.readFileSync(path.resolve('workflow/config/org-resolution.json'), 'utf8'),
);

export function canonicalDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export function normalizedName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|company|co|group|holdings|holding)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function nameContains(a, b) {
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

export function scoreCandidate(target, candidate) {
  const evidence = [];
  let confidence = 0;

  if (
    candidate.canonicalDomain &&
    candidate.canonicalDomain === target.canonicalDomain
  ) {
    confidence = 0.99;
    evidence.push({ source: candidate.source, value: 'exact canonical domain', confidence: 0.99 });
  }

  if (candidate.dayAiOrganizationId && target.dayAiOrganizationId === candidate.dayAiOrganizationId) {
    confidence = Math.max(confidence, 0.99);
    evidence.push({ source: 'day-ai', value: 'matched stored Day AI source ID', confidence: 0.99 });
  }

  if (candidate.normalizedName && candidate.normalizedName === target.normalizedName) {
    confidence = Math.max(confidence, 0.88);
    evidence.push({
      source: candidate.source,
      value: 'same normalized account name',
      confidence: 0.88,
    });
  }

  if (nameContains(candidate.normalizedName, target.normalizedName)) {
    confidence = Math.max(confidence, 0.76);
    evidence.push({
      source: candidate.source,
      value: 'parent/subsidiary-style name containment',
      confidence: 0.76,
    });
  }

  return {
    name: candidate.accountName ?? candidate.name,
    domain: candidate.domain,
    canonicalDomain: candidate.canonicalDomain,
    dayAiOrganizationId: candidate.dayAiOrganizationId,
    freshsalesAccountIds: candidate.freshsalesAccountIds,
    apolloOrganizationId: candidate.apolloOrganizationId,
    confidence,
    evidence,
  };
}

export function decide(best, candidateCount) {
  if (!best || best.confidence < 0.49) {
    return {
      action: 'allow_new_org_after_receipt',
      matchStatus: 'allow_new_org',
      matchConfidence: best?.confidence ?? 0,
      headlineReason: POLICY.decisionPolicy.noCredibleMatch.receipt,
      receiptColor: 'green',
    };
  }
  if (best.confidence >= 0.98) {
    return {
      action: 'auto_link_existing',
      matchStatus: 'auto_link_existing',
      matchConfidence: best.confidence,
      headlineReason: POLICY.decisionPolicy.exactCanonicalDomain.receipt,
      receiptColor: 'green',
    };
  }
  if (best.confidence >= 0.9) {
    return {
      action: 'auto_link_existing_with_receipt',
      matchStatus: 'auto_link_existing_with_receipt',
      matchConfidence: best.confidence,
      headlineReason: POLICY.decisionPolicy.clearTypoOrNameVariant.receipt,
      receiptColor: 'green',
    };
  }
  if (best.confidence >= 0.75) {
    return {
      action: 'ask_parent_subsidiary_scope',
      matchStatus: 'ask_parent_subsidiary_scope',
      matchConfidence: best.confidence,
      headlineReason: POLICY.decisionPolicy.parentSubsidiary.receipt,
      receiptColor: 'yellow',
    };
  }
  return {
    action: 'block_org_creation_create_review_context',
    matchStatus: 'block_for_review',
    matchConfidence: best.confidence,
    headlineReason:
      candidateCount > 1
        ? POLICY.decisionPolicy.ambiguous.receipt
        : 'Match confidence too low to auto-link; review required.',
    receiptColor: 'red',
  };
}

export async function resolveIdentity(input) {
  const target = {
    accountName: input.accountName,
    canonicalDomain: canonicalDomain(input.canonicalDomain),
    normalizedName: normalizedName(input.accountName),
  };

  // Pull candidates from each evidence source in parallel.
  const [dayAiByDomain, dayAiByName, freshsalesByDomain, apolloByDomain] = await Promise.all([
    safe(() => fetchDayAiOrgsByDomain(target.canonicalDomain), []),
    safe(() => fetchDayAiOrgsByName(target.normalizedName), []),
    safe(() => fetchFreshsalesAccountsByDomain(target.canonicalDomain), []),
    safe(() => fetchApolloOrgByDomain(target.canonicalDomain), null),
  ]);

  const rawCandidates = [];
  for (const org of dayAiByDomain) {
    rawCandidates.push({
      source: 'day-ai',
      accountName: org.name,
      domain: org.domain,
      canonicalDomain: canonicalDomain(org.domain),
      normalizedName: normalizedName(org.name),
      dayAiOrganizationId: org.id,
    });
  }
  for (const org of dayAiByName) {
    rawCandidates.push({
      source: 'day-ai',
      accountName: org.name,
      domain: org.domain,
      canonicalDomain: canonicalDomain(org.domain),
      normalizedName: normalizedName(org.name),
      dayAiOrganizationId: org.id,
    });
  }
  for (const acct of freshsalesByDomain) {
    rawCandidates.push({
      source: 'freshsales',
      accountName: acct.name,
      domain: acct.domain,
      canonicalDomain: canonicalDomain(acct.domain),
      normalizedName: normalizedName(acct.name),
      freshsalesAccountIds: [String(acct.id)],
    });
  }
  if (apolloByDomain) {
    rawCandidates.push({
      source: 'apollo',
      accountName: apolloByDomain.name,
      domain: apolloByDomain.primary_domain,
      canonicalDomain: canonicalDomain(apolloByDomain.primary_domain),
      normalizedName: normalizedName(apolloByDomain.name),
      apolloOrganizationId: apolloByDomain.id,
    });
  }

  const scored = rawCandidates
    .map((c) => scoreCandidate(target, c))
    .filter((c) => c.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  // De-dupe per Day AI org ID: keep the highest-confidence row per org.
  const seen = new Set();
  const unique = [];
  for (const c of scored) {
    const key = c.dayAiOrganizationId ?? `${c.canonicalDomain}|${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const top = unique.slice(0, 5);
  const best = top[0];
  const decision = decide(best, top.length);

  return {
    target,
    decision,
    candidates: top,
    evidenceSources: {
      dayAiByDomain: dayAiByDomain.length,
      dayAiByName: dayAiByName.length,
      freshsalesByDomain: freshsalesByDomain.length,
      apolloByDomain: apolloByDomain ? 1 : 0,
    },
  };
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
