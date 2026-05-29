// Hardening contract for the provider-flow review changes:
//   P1a/P1b cache short-circuits (0 credits on a hit), P3a verified-only queue, P1d contact-scoped
//   idempotency keys, P1e already-contacted guard via myRA progress, P2b receipt reflects real state.
// Fully offline: pre-seeds caches/progress in a temp KV dir; provider creds are removed so any
// accidental live call would throw (proving the cached/seeded paths don't hit the network).

import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-harden-'));
process.env.WORKER_KV_DIR = path.join(tmp, 'kv');
process.env.WORKER_STORE_DIR = path.join(tmp, 'store');
process.env.WORKER_STATE_DIR = path.join(tmp, 'state');
delete process.env.APOLLO_API_KEY;
delete process.env.CLEAROUT_API_TOKEN;
delete process.env.FRESHSALES_API_KEY;
delete process.env.KV_REST_API_URL; // force disk backend for a hermetic test
delete process.env.KV_REST_API_TOKEN;

import { test, assert } from './lib.mjs';
import { putEntry, clearoutKey, enrichKey, TTL } from '../../worker/cache.mjs';
import { clearoutVerify } from '../../worker/providers/clearout.mjs';
import { apolloEnrich } from '../../worker/providers/apollo.mjs';
import { composeFirstTouch } from '../../worker/compose.mjs';
import { defaultIdempotencyKey } from '../../worker/mcp.mjs';
import { recordContactWorked } from '../../worker/progress.mjs';
import { checkRecentTouch } from '../../worker/outreach.mjs';
import { buildReceipt } from '../../worker/receipt.mjs';

const results = [];

results.push(
  await test('Clearout verdict cache → 0 credits + cached flag on a hit (P1a)', async () => {
    await putEntry(clearoutKey('cached@acme.com'), { email: 'cached@acme.com', status: 'verified', clearoutReason: null, verifiedAt: new Date().toISOString() }, TTL.clearout);
    const r = await clearoutVerify({ emails: ['cached@acme.com'], approvingAm: 'satya@ask-myra.ai' });
    assert.equal(r.creditsConsumed, 0, 'a cache hit must cost 0 credits');
    assert.equal(r.servedFromCache, 1);
    assert.equal(r.results[0].status, 'verified');
    assert.equal(r.results[0].cached, true);
  }),
);

results.push(
  await test('Apollo enrich cache → 0 credits on a hit (P1b)', async () => {
    await putEntry(enrichKey('p-123'), { apolloPersonId: 'p-123', name: 'Cached Person', email: 'p@acme.com', tier: 'Recommended' }, TTL.apolloEnrich);
    const r = await apolloEnrich({ candidateIds: ['p-123'], approvingAm: 'satya@ask-myra.ai' });
    assert.equal(r.creditsConsumed, 0, 're-enrich of a cached person must not charge');
    assert.equal(r.servedFromCache, 1);
    assert.equal(r.enriched[0].email, 'p@acme.com');
    assert.equal(r.enriched[0].cached, true);
  }),
);

results.push(
  await test('verified-only queue: risky/unknown held, verified queued (P3a)', () => {
    assert.equal(composeFirstTouch({ canonicalDomain: 'x.com', title: 'VP Strategy', emailVerdict: 'risky' }).queueReady, false);
    assert.equal(composeFirstTouch({ canonicalDomain: 'x.com', title: 'VP Strategy', emailVerdict: 'unknown' }).queueReady, false);
    assert.equal(composeFirstTouch({ canonicalDomain: 'x.com', title: 'VP Strategy', emailVerdict: 'verified' }).queueReady, true);
    assert.ok(composeFirstTouch({ canonicalDomain: 'x.com', title: 'VP Strategy', emailVerdict: 'risky' }).queueHold, 'risky must carry a hold reason');
  }),
);

results.push(
  await test('contact-scoped idempotency: two contacts, same account/day → distinct keys (P1d)', () => {
    const a = defaultIdempotencyKey({ action: 'draft-create', canonicalDomain: 'acme.com', payload: { contactEmail: 'a@acme.com' } });
    const b = defaultIdempotencyKey({ action: 'draft-create', canonicalDomain: 'acme.com', payload: { contactEmail: 'b@acme.com' } });
    assert.notEqual(a, b, 'distinct contacts must not collide into one write');
    const org = defaultIdempotencyKey({ action: 'org-create', canonicalDomain: 'acme.com', payload: { contactEmail: 'a@acme.com' } });
    assert.ok(!/a-acme-com/.test(org), 'account-scoped actions stay domain+day');
  }),
);

results.push(
  await test('already-contacted guard sees prior myRA work (P1e)', async () => {
    await recordContactWorked('acme.com', { email: 'worked@acme.com', name: 'Worked One', emailVerdict: 'verified' });
    const touch = await checkRecentTouch({ canonicalDomain: 'acme.com', contactEmail: 'worked@acme.com' });
    assert.ok(touch, 'expected a recent-touch hit from progress');
    assert.equal(touch.channel, 'myra');
  }),
);

results.push(
  await test('receipt reflects real Clearout/enrich state from progress (P2b)', async () => {
    await recordContactWorked('receipttest.invalid', { email: 'r@receipttest.invalid', name: 'R', emailVerdict: 'verified', creditsClearout: 1, creditsApollo: 1 });
    const rec = await buildReceipt({ canonicalDomain: 'receipttest.invalid', displayName: 'Receipt Test', approvingAm: 'satya@ask-myra.ai' });
    assert.equal(rec.providers.clearout.status, 'ok', 'clearout block must reflect work done, not hardcoded not_run');
    assert.equal(rec.providers.clearout.verified, 1);
    assert.ok(rec.contacts.length >= 1, 'contacts populated from progress');
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
