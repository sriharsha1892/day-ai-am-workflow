// UX uplift increment 2 (Phases B+C): configurable thresholds, pending-sync queue, why-confidence,
// why-color. Offline (disk KV + disk store).

import fs from 'node:fs';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-uxu2-'));
process.env.WORKER_KV_DIR = path.join(tmp, 'kv');
process.env.WORKER_STORE_DIR = path.join(tmp, 'store');
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import { test, assert } from './lib.mjs';
import { getThresholds, setThresholds } from '../../worker/admin-config.mjs';
import { queuePendingSync, allPending, drainPendingByKey } from '../../worker/store.mjs';
import { interpret } from '../../worker/render.mjs';
import { buildReceipt } from '../../worker/receipt.mjs';

const results = [];

results.push(
  await test('admin thresholds: set persists, defaults preserved', async () => {
    const def = await getThresholds();
    assert.equal(def.overloadThreshold, 60);
    const next = await setThresholds({ lowRunwayDays: 3, staleDays: 21, bogus: 'x' });
    assert.equal(next.lowRunwayDays, 3);
    assert.equal(next.staleDays, 21);
    assert.equal(next.overloadThreshold, 60, 'untouched default preserved');
    assert.equal((await getThresholds()).lowRunwayDays, 3, 'persisted');
  }),
);

results.push(
  await test('pending-sync queue: enqueue → allPending → drain', async () => {
    await queuePendingSync({ canonicalDomain: 'itc.in', amEmail: 'satish@ask-myra.ai', action: 'org-create', idempotencyKey: 'k-itc-1', payload: { accountName: 'ITC' }, reason: 'boom' });
    const mine = (await allPending()).filter((e) => e.amEmail === 'satish@ask-myra.ai');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].idempotencyKey, 'k-itc-1');
    assert.equal(mine[0].action, 'org-create');
    await drainPendingByKey('k-itc-1');
    assert.equal((await allPending()).filter((e) => e.idempotencyKey === 'k-itc-1').length, 0, 'drained');
  }),
);

results.push(
  await test('render: interpretation carries confidenceReason (why-confidence)', () => {
    const c = interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'low', accounts: [{}], contacts: [], deals: [] });
    assert.equal(c.confidence, 'high');
    assert.ok(typeof c.confidenceReason === 'string' && c.confidenceReason.length > 0, `confidenceReason: ${c.confidenceReason}`);
  }),
);

results.push(
  await test('receipt: summary.whyColor explains a non-green color', async () => {
    const rec = await buildReceipt({ canonicalDomain: 'nonexistent-uxu2.invalid', displayName: 'UX2', approvingAm: 'satish@ask-myra.ai' });
    assert.ok(Array.isArray(rec.summary.whyColor) && rec.summary.whyColor.length > 0, 'whyColor present');
    assert.notEqual(rec.summary.color, 'green'); // no creds → providers fail
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
