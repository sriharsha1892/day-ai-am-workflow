// Pins the org-match decision gates + scoring weights to org-resolution.json (single source of
// truth), proving the de-hardcode is behavior-preserving AND config-driven: change the JSON and the
// decision follows. Guards against identity.mjs silently re-hardcoding the thresholds.

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from './lib.mjs';
import { scoreCandidate, decide } from '../../worker/identity.mjs';

const POLICY = JSON.parse(fs.readFileSync(path.resolve('workflow/config/org-resolution.json'), 'utf8'));
const W = POLICY.scoringWeights;
const G = POLICY.decisionPolicy;

const best = (confidence, extra = {}) => ({ confidence, evidence: [{ source: 'freshsales' }], ...extra });
const results = [];

results.push(
  await test('scoreCandidate reads weights from org-resolution.json', () => {
    const target = { canonicalDomain: 'acme.com', normalizedName: 'acme' };
    assert.equal(scoreCandidate(target, { source: 'freshsales', canonicalDomain: 'acme.com' }).confidence, W.exactCanonicalDomain, 'exact domain → exactCanonicalDomain weight');
    const targetWithOrg = { canonicalDomain: 'acme.com', normalizedName: 'acme', dayAiOrganizationId: 'org_x' };
    assert.equal(scoreCandidate(targetWithOrg, { source: 'day-ai', dayAiOrganizationId: 'org_x', normalizedName: 'zzz' }).confidence, W.knownSourceId, 'source-id → knownSourceId weight');
    assert.equal(scoreCandidate(target, { source: 'apollo', normalizedName: 'acme' }).confidence, W.sameNormalizedName, 'same name → sameNormalizedName weight');
    assert.equal(scoreCandidate(target, { source: 'apollo', normalizedName: 'acme global holdings' }).confidence, W.nameContainment, 'containment → nameContainment weight');
  }),
);

results.push(
  await test('decide gates are driven by decisionPolicy.*.minimum/maximumConfidence', () => {
    // exact-domain tier: link when a Day AI org exists, else create
    assert.equal(decide(best(G.exactCanonicalDomain.minimumConfidence, { dayAiOrganizationId: 'org_1' })).action, 'auto_link_existing');
    assert.equal(decide(best(G.exactCanonicalDomain.minimumConfidence)).action, 'create_org_from_evidence', 'strong match, no Day AI org → create (the ITC fix)');
    // typo/variant tier
    assert.equal(decide(best(G.clearTypoOrNameVariant.minimumConfidence, { dayAiOrganizationId: 'org_1' })).action, 'auto_link_existing_with_receipt');
    assert.equal(decide(best(G.clearTypoOrNameVariant.minimumConfidence)).action, 'create_org_from_evidence');
    // just below the variant gate falls to parent/subsidiary ask
    assert.equal(decide(best(G.clearTypoOrNameVariant.minimumConfidence - 0.001)).action, 'ask_parent_subsidiary_scope');
    assert.equal(decide(best(G.parentSubsidiary.minimumConfidence)).action, 'ask_parent_subsidiary_scope');
    // below noCredibleMatch ceiling → allow new org
    assert.equal(decide(best(G.noCredibleMatch.maximumConfidence - 0.001)).action, 'allow_new_org_after_receipt');
    assert.equal(decide(null).action, 'allow_new_org_after_receipt');
    // between parentSubsidiary floor and noCredibleMatch ceiling → block (ambiguous)
    const mid = (G.parentSubsidiary.minimumConfidence + G.noCredibleMatch.maximumConfidence) / 2;
    assert.equal(decide(best(mid)).matchStatus !== 'ask_parent_subsidiary_scope', true, 'a mid score is not parent/subsidiary');
  }),
);

results.push(
  await test('current production thresholds are preserved (behavior-preserving regression pin)', () => {
    assert.equal(W.exactCanonicalDomain, 0.99);
    assert.equal(W.sameNormalizedName, 0.88);
    assert.equal(W.nameContainment, 0.76);
    assert.equal(G.exactCanonicalDomain.minimumConfidence, 0.98);
    assert.equal(G.clearTypoOrNameVariant.minimumConfidence, 0.9);
    assert.equal(G.parentSubsidiary.minimumConfidence, 0.75);
    assert.equal(G.noCredibleMatch.maximumConfidence, 0.49);
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
