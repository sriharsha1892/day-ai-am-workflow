// Locks the Recommended/Maybe/Hold tiering. Regression guard for the "everyone is Hold" bug:
// Apollo SEARCH masks the email until enrich, so tiering must NOT depend on the email address —
// only title→persona fit + seniority, with a known-unreachable email_status as the only Hold-forcer.

import { test, assert } from './lib.mjs';
import { normalizePerson } from '../../worker/providers/apollo.mjs';

const BUCKETS = ['Strategy', 'Market Intelligence', 'Insights/Research', 'Innovation', 'Corporate Development', 'Procurement', 'Business Unit Leader'];
const tier = (p) => normalizePerson(p, BUCKETS).tier;

const results = [];

results.push(
  await test('role fit + senior + MASKED email → Recommended (the bug fix)', () => {
    // email null + email_status null = exactly what Apollo search returns pre-enrich.
    assert.equal(tier({ title: 'Head of Market Intelligence', seniority: 'head', email: null, email_status: null }), 'Recommended');
    assert.equal(tier({ title: 'VP Strategy', seniority: 'vp', email: null }), 'Recommended');
  }),
);

results.push(
  await test('role fit + manager → Recommended', () => {
    assert.equal(tier({ title: 'Procurement Manager', seniority: 'manager', email: null }), 'Recommended');
  }),
);

results.push(
  await test('senior but role unclear → Maybe (never auto-Hold a leader)', () => {
    assert.equal(tier({ title: 'Global Operations Lead', seniority: 'director', email: null }), 'Maybe');
  }),
);

results.push(
  await test('role fit but junior/unknown seniority → Maybe', () => {
    assert.equal(tier({ title: 'Innovation Analyst', seniority: 'entry', email: null }), 'Maybe');
  }),
);

results.push(
  await test('weak fit (no role, not senior) → Hold', () => {
    assert.equal(tier({ title: 'Warehouse Associate', seniority: 'entry', email: null }), 'Hold');
  }),
);

results.push(
  await test('known-unreachable email → Hold even if otherwise a fit', () => {
    assert.equal(tier({ title: 'VP Strategy', seniority: 'vp', email_status: 'unavailable' }), 'Hold');
  }),
);

results.push(
  await test('a realistic search slate is NOT all-Hold', () => {
    const slate = [
      { title: 'Chief Strategy Officer', seniority: 'c_suite', email: null },
      { title: 'Head of Insights', seniority: 'head', email: null },
      { title: 'Procurement Director', seniority: 'director', email: null },
      { title: 'R&D Lead', seniority: 'director', email: null },
      { title: 'Coordinator', seniority: 'entry', email: null },
    ].map((p) => normalizePerson(p, BUCKETS));
    const holds = slate.filter((c) => c.tier === 'Hold').length;
    assert.ok(holds < slate.length, `expected some non-Hold, got ${holds}/${slate.length} Hold`);
    assert.ok(slate.some((c) => c.tier === 'Recommended'), 'expected at least one Recommended');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
