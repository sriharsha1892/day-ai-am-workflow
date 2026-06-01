// Confirmation gate for Day AI writes (kills synthetic-ID fake successes). Verifies:
//  - opportunity/person/action/draft/review-context no longer fabricate an id when Day AI echoes
//    none -> the write is reported unconfirmed (no id, no link) so dayAiWrite throws -> pendingSync;
//  - the same handlers DO use a real echoed objectId;
//  - org-create keeps its deterministic domain id (orgs are domain-keyed — a real id);
//  - dayAiWrite replays a prior success without calling Day AI.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WORKER_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dayai-rb-'));

import { test, assert } from './lib.mjs';
import { WRITE_HANDLERS, dayAiWrite } from '../../worker/providers/day-ai.mjs';
import { recordIdempotency } from '../../worker/store.mjs';

const results = [];
const NEEDS_REAL_ID = ['opportunity-create', 'person-create', 'action-create', 'draft-create', 'review-context'];

results.push(
  await test('no synthetic-id fabrication: an unconfirmed write has no id/link (→ pendingSync)', () => {
    const payload = { canonicalDomain: 'acme.com', candidate: { email: 'a@acme.com', name: 'A B' }, contactEmail: 'a@acme.com', subject: 'Hi', summary: 's', reason: 'r' };
    for (const a of NEEDS_REAL_ID) {
      const rec = WRITE_HANDLERS[a].extractRecord({}, payload);
      assert.ok(!rec.id, `${a}: no fabricated id when Day AI echoes none`);
      assert.equal(rec.link, null, `${a}: no link without a real id`);
      const ok = WRITE_HANDLERS[a].extractRecord({ objectId: 'real_123' }, payload);
      assert.equal(ok.id, 'real_123', `${a}: uses the real echoed objectId`);
      assert.ok(ok.link && ok.link.includes('real_123'), `${a}: links to the real id`);
    }
  }),
);

results.push(
  await test('org-create keeps its deterministic domain id (domain-keyed = real)', () => {
    assert.equal(WRITE_HANDLERS['org-create'].extractRecord({}, { canonicalDomain: 'acme.com' }).id, 'acme.com');
  }),
);

results.push(
  await test('dayAiWrite replays a prior success without calling Day AI (no creds needed)', async () => {
    const key = 'opportunity-create.acme.com.2026-06-01.replaytest';
    await recordIdempotency(key, { type: 'opportunity', id: 'real_1', name: 'x', link: null });
    const r = await dayAiWrite({ action: 'opportunity-create', approvingAm: 'satish@ask-myra.ai', canonicalDomain: 'acme.com', idempotencyKey: key });
    assert.equal(r.replayed, true);
    assert.equal(r.id, 'real_1');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
