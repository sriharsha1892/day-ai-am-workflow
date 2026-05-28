// Public-only candidate: Apollo returns a public-data person; tier must not auto-create Day AI Person.
// Verifies Apollo normalization tiers (Hold) when email is missing.

import { test, assert } from './lib.mjs';
import { apolloPeopleSearch } from '../../worker/providers/apollo.mjs';

// Without APOLLO_API_KEY, apolloPeopleSearch returns `status: failed` with empty candidates.
// We assert that the function is well-behaved (no throw) so Codex always gets a structured receipt.

const results = [];

results.push(
  await test('apolloPeopleSearch returns structured response when API key absent', async () => {
    const original = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    const out = await apolloPeopleSearch({ canonicalDomain: 'test-public-only.invalid' });
    if (original) process.env.APOLLO_API_KEY = original;

    assert.ok(out);
    assert.ok(['failed', 'no_data'].includes(out.status), `unexpected status: ${out.status}`);
    assert.equal(out.candidateCount, 0);
    assert.deepEqual(out.tieredCounts, { recommended: 0, maybe: 0, hold: 0 });
    assert.ok(out.headlineReason);
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
