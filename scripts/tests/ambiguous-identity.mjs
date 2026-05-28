// Ambiguous identity: low-confidence match must block creation (no org created in Day AI).

import { test, assert } from './lib.mjs';
import { canonicalDomain, normalizedName, scoreCandidate, decide } from '../../worker/identity.mjs';

const target = {
  accountName: 'Acme Industrial Solutions',
  canonicalDomain: canonicalDomain('acmeind.com'),
  normalizedName: normalizedName('Acme Industrial Solutions'),
};

// Distractor with shared "acme" token but different domain. After suffix-stripping,
// "Acme Holdings Co" normalizes to "acme" (holdings, co are stripped), so name containment
// triggers and confidence lands at 0.76 — exactly the parent/subsidiary threshold (Yellow).
const parentSubsidiaryDistractor = {
  source: 'freshsales',
  accountName: 'Acme Holdings Co',
  canonicalDomain: canonicalDomain('acmeholdings.com'),
  normalizedName: normalizedName('Acme Holdings Co'),
};

// True ambiguous case: no domain match, no name overlap, no Day AI ID. Confidence 0.
const unrelatedDistractor = {
  source: 'freshsales',
  accountName: 'Globex Pharma International',
  canonicalDomain: canonicalDomain('globex.com'),
  normalizedName: normalizedName('Globex Pharma International'),
};

const results = [];

results.push(
  await test('parent/subsidiary name containment routes to ask_parent_subsidiary_scope (Yellow)', () => {
    const scored = scoreCandidate(target, parentSubsidiaryDistractor);
    assert.ok(scored.confidence >= 0.75 && scored.confidence < 0.9, `expected 0.75-0.89, got ${scored.confidence}`);
    const decision = decide(scored, 1);
    assert.equal(decision.action, 'ask_parent_subsidiary_scope');
    assert.equal(decision.receiptColor, 'yellow');
  }),
);

results.push(
  await test('unrelated distractor produces zero confidence and noCredibleMatch (allow_new)', () => {
    const scored = scoreCandidate(target, unrelatedDistractor);
    assert.equal(scored.confidence, 0);
    const decision = decide(null, 0);
    assert.equal(decision.action, 'allow_new_org_after_receipt');
    assert.equal(decision.matchStatus, 'allow_new_org');
  }),
);

results.push(
  await test('multiple weak candidates (0.6 confidence) produce block decision', () => {
    const decision = decide({ confidence: 0.6 }, 3);
    assert.equal(decision.action, 'block_org_creation_create_review_context');
    assert.equal(decision.matchStatus, 'block_for_review');
    assert.equal(decision.receiptColor, 'red');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
