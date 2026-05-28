// Provider roundtrip: receipt builder aggregates Freshsales/Apollo/Clearout/DayAI blocks
// into the canonical account-receipt.schema.json shape. We stub providers to verify shape.

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

// Use a temp WORKER_STORE_DIR so the test does not pollute real worker state.
const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-roundtrip-'));
process.env.WORKER_STORE_DIR = tmp;

const receipt = await import('../../worker/receipt.mjs').then((m) => m.buildReceipt);

const out = await receipt({
  canonicalDomain: 'nonexistent-test-domain-12345.invalid',
  displayName: 'Test Co',
  approvingAm: 'satya@ask-myra.ai',
  includeExpanded: false,
});

const results = [];

results.push(
  await test('receipt has canonical shape with all four provider blocks', () => {
    assert.ok(out.version);
    assert.ok(out.account?.canonicalDomain);
    assert.ok(out.summary?.color);
    assert.ok(out.summary?.headline);
    assert.ok(out.summary?.narrative);
    assert.ok(out.summary?.nextAction);
    assert.ok(out.summary?.headlineReasonByProvider);
    assert.ok(out.providers?.freshsales);
    assert.ok(out.providers?.apollo);
    assert.ok(out.providers?.clearout);
    assert.ok(out.providers?.dayAi);
    assert.ok(Array.isArray(out.approvals));
    assert.ok(Array.isArray(out.idempotencyKeys));
    assert.equal(out.approvedBy, 'satya@ask-myra.ai');
  }),
);

results.push(
  await test('color is red or yellow when providers cannot reach upstream', () => {
    // Without provider creds, freshsales/apollo will fail, so color must be at least yellow.
    assert.ok(
      out.summary.color === 'yellow' || out.summary.color === 'red',
      `expected yellow or red without provider creds, got ${out.summary.color}`,
    );
  }),
);

results.push(
  await test('expanded payload populated on non-green receipts', () => {
    if (out.summary.color !== 'green') {
      assert.ok(out.expanded, 'expanded payload should exist for yellow/red receipts');
    }
  }),
);

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
