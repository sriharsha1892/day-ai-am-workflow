// Dedupe on retry: store.recordIdempotency must short-circuit duplicate writes with same key.
// This proves Day AI cannot accidentally receive two Organization creates for the same account.

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-dedupe-'));
process.env.WORKER_STORE_DIR = tmp;

const { recordIdempotency, lookupIdempotency } = await import('../../worker/store.mjs');

const results = [];

results.push(
  await test('idempotency store returns prior value on second lookup', () => {
    const key = 'org-create.michelman.com.2026-05-28.deadbeef';
    const value = { type: 'organization', id: 'org_M_1', name: 'Michelman', writtenAt: '2026-05-28T10:00:00Z' };
    recordIdempotency(key, value);
    const fetched = lookupIdempotency(key);
    assert.deepEqual(fetched, value);
  }),
);

results.push(
  await test('store persists across reload (simulates worker restart)', async () => {
    const key = 'person-create.michelman.com.2026-05-28.cafef00d';
    const value = { type: 'person', id: 'p_1', name: 'Jane Doe', writtenAt: '2026-05-28T10:05:00Z' };
    recordIdempotency(key, value);

    // Allow async fs write to flush.
    await new Promise((r) => setTimeout(r, 50));

    const idemPath = path.join(tmp, 'idempotency.json');
    assert.ok(fs.existsSync(idemPath), 'idempotency.json should be persisted');
    const stored = JSON.parse(fs.readFileSync(idemPath, 'utf8'));
    assert.deepEqual(stored[key], value);
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
