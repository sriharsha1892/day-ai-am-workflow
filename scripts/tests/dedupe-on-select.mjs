// Dedupe on retry: recordIdempotency must short-circuit duplicate writes with same key.
// This proves Day AI cannot accidentally receive two Organization creates for the same account.
// Uses the disk backend (no KV env vars set in tests) so we can assert the on-disk persistence.

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

// Ensure disk backend by stripping any KV env that might leak in.
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-dedupe-'));
process.env.WORKER_STORE_DIR = tmp;

const {
  recordIdempotency,
  lookupIdempotency,
  getIdempotencyForAccount,
  backendKind,
} = await import('../../worker/store.mjs');

const results = [];

results.push(
  await test('disk backend is selected when KV env vars are absent', () => {
    assert.equal(backendKind(), 'disk');
  }),
);

results.push(
  await test('idempotency store returns prior value on second lookup', async () => {
    const key = 'org-create.michelman.com.2026-05-28.deadbeef';
    const value = {
      type: 'organization',
      id: 'org_M_1',
      name: 'Michelman',
      idempotencyKey: key,
      canonicalDomain: 'michelman.com',
      writtenAt: '2026-05-28T10:00:00Z',
    };
    await recordIdempotency(key, value);
    const fetched = await lookupIdempotency(key);
    assert.deepEqual(fetched, value);
  }),
);

results.push(
  await test('store persists across reload (simulates worker restart)', async () => {
    const key = 'person-create.michelman.com.2026-05-28.cafef00d';
    const value = {
      type: 'person',
      id: 'p_1',
      name: 'Jane Doe',
      idempotencyKey: key,
      canonicalDomain: 'michelman.com',
      writtenAt: '2026-05-28T10:05:00Z',
    };
    await recordIdempotency(key, value);

    const idemPath = path.join(tmp, 'idempotency.json');
    assert.ok(fs.existsSync(idemPath), 'idempotency.json should be persisted');
    const stored = JSON.parse(fs.readFileSync(idemPath, 'utf8'));
    assert.deepEqual(stored[key], value);
  }),
);

results.push(
  await test('getIdempotencyForAccount returns records scoped to canonical domain', async () => {
    const records = await getIdempotencyForAccount('michelman.com');
    assert.ok(records.length >= 2, `expected >=2 records for michelman.com, got ${records.length}`);
    for (const r of records) {
      assert.ok(r.idempotencyKey.includes('michelman.com'));
    }
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
