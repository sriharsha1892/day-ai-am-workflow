// UX uplift increment 1: draft subject variants + quality summary + applied-defaults echo (compose),
// and account list sort/filter (accounts). Offline (disk KV).

import fs from 'node:fs';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-uxu-'));
process.env.WORKER_KV_DIR = path.join(tmp, 'kv');
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import { test, assert } from './lib.mjs';
import { composeFirstTouch } from '../../worker/compose.mjs';
import { assignAccounts, listMyAccounts } from '../../worker/accounts.mjs';

const results = [];

results.push(
  await test('compose: subjectVariants + qualitySummary + appliedDefaults + refineHint', () => {
    const d = composeFirstTouch({
      canonicalDomain: 'itc.in',
      contactName: 'Priya Rao',
      title: 'Head of Market Intelligence',
      emailVerdict: 'verified',
      preferences: { signature: '— Satish', defaultTone: 'consultative' },
    });
    assert.ok(d.subjectVariants?.inquisitive && d.subjectVariants?.consultative && d.subjectVariants?.direct, 'three subject angles');
    assert.notEqual(d.subjectVariants.inquisitive, d.subjectVariants.direct, 'variants differ');
    assert.ok(d.qualitySummary.good.includes('non-salesy'), `quality good: ${d.qualitySummary.good}`);
    assert.equal(d.appliedDefaults.signature, true);
    assert.equal(d.appliedDefaults.tone, 'consultative');
    assert.ok(/warmer/.test(d.refineHint), 'refine hint present');
  }),
);

results.push(
  await test('accounts: filter by priority + sort by name', async () => {
    await assignAccounts('loader@x.com', [
      { amEmail: 'am@x.com', amName: 'AM', accountName: 'Zeta Corp', domain: 'zeta.com', status: 'ready_for_intake', priority: 'P1' },
      { amEmail: 'am@x.com', amName: 'AM', accountName: 'Alpha Inc', domain: 'alpha.com', status: 'domain_pending', priority: 'P2' },
      { amEmail: 'am@x.com', amName: 'AM', accountName: 'Beta LLC', domain: 'beta.com', status: 'ready_for_intake', priority: 'P1' },
    ]);
    assert.equal((await listMyAccounts('am@x.com')).count, 3);
    assert.equal((await listMyAccounts('am@x.com', { priority: 'P1' })).count, 2, 'two P1s');
    assert.equal((await listMyAccounts('am@x.com', { status: 'domain_pending' })).count, 1);
    const byName = await listMyAccounts('am@x.com', { sort: 'name' });
    assert.equal(byName.accounts[0].accountName, 'Alpha Inc', 'alphabetical first');
    assert.ok(byName.filter && byName.filter.sort === 'name', 'echoes the filter applied');
  }),
);

results.push(
  await test('compose: risky/invalid email is NOT queue-ready (verified-only)', () => {
    assert.equal(composeFirstTouch({ canonicalDomain: 'x.com', title: 'VP', emailVerdict: 'risky' }).queueReady, false);
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
