// Typo test: misspelled name, correct domain -> auto_link_existing_with_receipt
// (exact canonical domain match scores 0.99 regardless of name typo, so the decision
// must lock to auto_link_existing or the strong-variant tier).

import { test, assert } from './lib.mjs';
import { canonicalDomain, normalizedName, scoreCandidate, decide } from '../../worker/identity.mjs';

const target = {
  accountName: 'Mishelman Inc',
  canonicalDomain: canonicalDomain('michelman.com'),
  normalizedName: normalizedName('Mishelman Inc'),
};

const candidate = {
  source: 'day-ai',
  accountName: 'Michelman',
  canonicalDomain: canonicalDomain('michelman.com'),
  normalizedName: normalizedName('Michelman'),
  dayAiOrganizationId: 'org_michelman',
};

const results = [];

results.push(
  await test('exact canonical domain wins even with misspelled name', () => {
    const scored = scoreCandidate(target, candidate);
    assert.ok(scored.confidence >= 0.98, `expected >= 0.98, got ${scored.confidence}`);
    const decision = decide(scored, 1);
    assert.equal(decision.action, 'auto_link_existing');
    assert.equal(decision.matchStatus, 'auto_link_existing');
    assert.equal(decision.receiptColor, 'green');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
