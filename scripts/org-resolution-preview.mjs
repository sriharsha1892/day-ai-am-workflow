#!/usr/bin/env node

import fs from 'node:fs';

const [accountName, domain, packetPath = 'account-packet.json'] = process.argv.slice(2);

if (!accountName || !domain) {
  console.error('Usage: node scripts/org-resolution-preview.mjs <account_name> <domain> [account-packet.json]');
  process.exit(2);
}

const policy = JSON.parse(fs.readFileSync('workflow/config/org-resolution.json', 'utf8'));
const candidates = fs.existsSync(packetPath) ? readPacketCandidates(packetPath) : [];
const target = {
  accountName,
  domain,
  canonicalDomain: canonicalDomain(domain),
  normalizedName: normalizedName(accountName),
};

const scored = candidates
  .filter((candidate) => candidate.accountName !== accountName || canonicalDomain(candidate.domain) !== target.canonicalDomain)
  .map((candidate) => scoreCandidate(target, candidate))
  .filter((candidate) => candidate.confidence > 0)
  .sort((a, b) => b.confidence - a.confidence)
  .slice(0, 5);

const best = scored[0];
const decision = decide(best);

console.log(JSON.stringify({
  target,
  decision,
  policy: {
    exactCanonicalDomain: policy.decisionPolicy.exactCanonicalDomain.action,
    clearTypoOrNameVariant: policy.decisionPolicy.clearTypoOrNameVariant.action,
    parentSubsidiary: policy.decisionPolicy.parentSubsidiary.action,
    ambiguous: policy.decisionPolicy.ambiguous.action,
    noCredibleMatch: policy.decisionPolicy.noCredibleMatch.action,
  },
  candidates: scored,
}, null, 2));

function readPacketCandidates(filePath) {
  const packet = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (packet.accounts ?? []).map((account) => ({
    source: filePath,
    accountName: account.accountName,
    domain: account.domain,
    status: account.status,
    canonicalDomain: canonicalDomain(account.domain),
    normalizedName: normalizedName(account.accountName),
  }));
}

function scoreCandidate(targetAccount, candidate) {
  const evidence = [];
  let confidence = 0;

  if (candidate.canonicalDomain && candidate.canonicalDomain === targetAccount.canonicalDomain) {
    confidence = 0.99;
    evidence.push('exact canonical domain');
  }

  if (candidate.normalizedName && candidate.normalizedName === targetAccount.normalizedName) {
    confidence = Math.max(confidence, 0.88);
    evidence.push('same normalized account name');
  }

  if (candidate.normalizedName && targetAccount.normalizedName && nameContains(candidate.normalizedName, targetAccount.normalizedName)) {
    confidence = Math.max(confidence, 0.76);
    evidence.push('parent/subsidiary-style name containment');
  }

  return {
    accountName: candidate.accountName,
    domain: candidate.domain,
    status: candidate.status,
    confidence,
    evidence,
  };
}

function decide(best) {
  if (!best) {
    return {
      action: 'allow_new_org_after_receipt',
      matchStatus: 'allow_new_org',
      reason: 'No local packet candidate matched. Day AI and connector evidence must still be checked before write.',
    };
  }
  if (best.confidence >= 0.98) {
    return {
      action: 'auto_link_existing',
      matchStatus: 'auto_link_existing',
      reason: 'Exact local canonical-domain match found.',
    };
  }
  if (best.confidence >= 0.9) {
    return {
      action: 'auto_link_existing_with_receipt',
      matchStatus: 'auto_link_existing_with_receipt',
      reason: 'Strong local variant evidence found.',
    };
  }
  if (best.confidence >= 0.75) {
    return {
      action: 'ask_am_decision',
      matchStatus: 'ask_parent_subsidiary_scope',
      reason: 'Possible parent/subsidiary or scope variant found.',
    };
  }
  return {
    action: 'block_org_creation_create_review_context',
    matchStatus: 'block_for_review',
    reason: 'Weak or ambiguous local match found.',
  };
}

function nameContains(a, b) {
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

function canonicalDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function normalizedName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|company|co|group|holdings|holding)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
