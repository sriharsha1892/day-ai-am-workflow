// Contract for the modular tool-interpretation UX (worker/render.mjs + workflow/config/tool-rendering.json).
// Pure/offline: feeds hand-built provider-shaped results into interpret()/groupContacts() and asserts the
// uniform card, badges, confidence ladders, cache/staleness/cost cues, and the two contact groups.

import { test, assert } from './lib.mjs';
import { interpret, groupContacts, loadRenderConfig } from '../../worker/render.mjs';

const cfg = loadRenderConfig();
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const results = [];

results.push(
  await test('uniform card shape + ran string (apollo_search)', () => {
    const c = interpret('apollo_search', { status: 'ok', candidateCount: 18, tieredCounts: { recommended: 5, maybe: 9, hold: 4 }, candidates: [] });
    for (const k of ['ran', 'found', 'means', 'source', 'confidence']) assert.ok(c[k], `missing ${k}`);
    assert.equal(c.ran, 'Apollo (net-new sourcing · search (0 credits))');
    assert.ok(c.found.includes('18 candidate'), c.found);
  }),
);

results.push(
  await test('badge mapping FS/AP/CO/DAY', () => {
    assert.ok(interpret('freshsales_evidence', { status: 'no_data' }).source.startsWith('[FS]'));
    assert.ok(interpret('apollo_enrich', { status: 'ok', enriched: [{ email: 'a@b.com' }], creditsConsumed: 1 }).source.startsWith('[AP]'));
    assert.ok(interpret('clearout_verify', { status: 'ok', verified: 1 }).source.startsWith('[CO]'));
    assert.ok(interpret('dayai_write', { ok: true, type: 'draft', name: 'X', idempotencyKey: 'k' }).source.startsWith('[DAY]'));
  }),
);

results.push(
  await test('Freshsales confidence ladder (dup risk + failure)', () => {
    assert.equal(interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'low', accounts: [{}], contacts: [], deals: [] }).confidence, 'high');
    assert.equal(interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'medium', accounts: [{}, {}], contacts: [], deals: [] }).confidence, 'med');
    assert.equal(interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'high', accounts: [{}, {}, {}, {}], contacts: [], deals: [] }).confidence, 'med');
    assert.equal(interpret('freshsales_evidence', { status: 'failed', error: 'boom' }).confidence, 'low');
  }),
);

results.push(
  await test('Clearout verdict confidence + dominant-verdict pick', () => {
    assert.equal(interpret('clearout_verify', { status: 'ok', verified: 1, risky: 0, invalid: 0 }).confidence, 'high');
    assert.equal(interpret('clearout_verify', { status: 'ok', verified: 0, risky: 1, invalid: 0 }).confidence, 'med');
    assert.equal(interpret('clearout_verify', { status: 'failed' }).confidence, 'low');
    // both verified+risky present → 'verified' dominates → high
    assert.equal(interpret('clearout_verify', { status: 'ok', verified: 1, risky: 1, invalid: 0 }).confidence, 'high');
  }),
);

results.push(
  await test('cache cue shows served-from-cache 0 credits', () => {
    const c = interpret('clearout_verify', { status: 'ok', verified: 0, risky: 0, invalid: 0, servedFromCache: 2, creditsConsumed: 0 });
    assert.ok(c.source.includes('served from cache (0 credits)'), c.source);
  }),
);

results.push(
  await test('staleness downgrades confidence + flags refresh', () => {
    const fresh = interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'low', accounts: [{}], contacts: [], deals: [], fromCache: true, ageHours: 3 });
    assert.equal(fresh.confidence, 'high', 'fresh cache keeps base confidence');
    assert.ok(fresh.source.includes('refreshed 3h ago'), fresh.source);
    const stale = interpret('freshsales_evidence', { status: 'ok', duplicateRisk: 'low', accounts: [{}], contacts: [], deals: [], fromCache: true, ageHours: 30 });
    assert.equal(stale.confidence, 'med', 'stale cache downgrades high→med');
    assert.ok(stale.source.includes('add refresh:true to re-pull'), stale.source);
  }),
);

results.push(
  await test('work_contact needsCostApproval pre-empts (nothing spent)', () => {
    const c = interpret('work_contact', { needsCostApproval: true, contact: { name: 'A' }, projected: { apollo: 1, clearout: 1 }, message: 'This contact would spend 1 Apollo + 1 Clearout.' });
    assert.ok(c.source.includes('needs cost approval — nothing spent yet'), c.source);
    assert.ok(c.means.includes('would spend'), c.means);
  }),
);

results.push(
  await test('work_contact no-email → low + ❌ + held for review', () => {
    const c = interpret('work_contact', { ok: true, contact: { name: 'A', title: 'VP' }, email: { address: null, verdict: 'invalid', reason: 'no deliverable email found' }, credits: { apollo: 0, clearout: 0 } });
    assert.equal(c.confidence, 'low');
    assert.equal(c.glyph, '❌');
    assert.ok(/held for review/i.test(c.means), c.means);
  }),
);

results.push(
  await test('work_contact verified → high + ✅ + queue-ready', () => {
    const c = interpret('work_contact', { ok: true, contact: { name: 'A', title: 'VP' }, email: { address: 'a@b.com', verdict: 'verified' }, credits: { apollo: 1, clearout: 1 } });
    assert.equal(c.confidence, 'high');
    assert.equal(c.glyph, '✅');
    assert.ok(c.means.includes('Queue-ready.'), c.means);
  }),
);

results.push(
  await test('Freshsales group: title, owner name, ⚠ touch rules', () => {
    const g = groupContacts('freshsales_evidence', {
      contacts: [
        { name: 'Priya', title: 'Head of MI', owner: 4471, ownerName: 'Satish', lastActivity: iso(8) },
        { name: 'Old Touch', title: 'VP', owner: 4471, ownerName: 'Satish', lastActivity: iso(45) },
        { name: 'No Touch', title: 'Director', owner: null, ownerName: null, lastActivity: null },
      ],
    });
    const fs = g.find((x) => x.key === 'freshsales');
    assert.equal(fs.title, 'Existing MI contacts');
    assert.equal(fs.order, 1);
    assert.ok(fs.rows[0].includes('owner Satish'), fs.rows[0]);
    assert.ok(fs.rows[0].includes('⚠ contacted 8 days ago'), fs.rows[0]);
    assert.ok(!fs.rows[1].includes('⚠'), 'a 45-day-old touch must NOT flag ⚠');
    assert.ok(!fs.rows[2].includes('⚠') && fs.rows[2].includes('unowned'), fs.rows[2]);
  }),
);

results.push(
  await test('Apollo group: title, order, Hold excluded, Recommended first', () => {
    const g = groupContacts('apollo_search', {
      candidates: [
        { name: 'Maybe Person', title: 'Mgr', tier: 'Maybe' },
        { name: 'Hold Person', title: 'Intern', tier: 'Hold' },
        { name: 'Rec Person', title: 'VP', tier: 'Recommended' },
      ],
    });
    const ap = g.find((x) => x.key === 'apollo');
    assert.equal(ap.title, 'Net-new (Apollo)');
    assert.equal(ap.order, 2);
    assert.equal(ap.rows.length, 2, 'Hold must be excluded');
    assert.ok(ap.rows[0].includes('★ Recommended'), ap.rows[0]);
    assert.ok(ap.rows[0].includes('Rec Person'), 'Recommended sorts before Maybe');
  }),
);

results.push(
  await test('dayai_write replay branch → high, no-duplicate language', () => {
    const c = interpret('dayai_write', { ok: true, replayed: true, type: 'draft', name: 'X', idempotencyKey: 'k' });
    assert.equal(c.confidence, 'high');
    assert.ok(/already saved|no duplicate/i.test(c.means), c.means);
  }),
);

results.push(
  await test('interpret is safe for unknown tools + empty results', () => {
    assert.equal(interpret('unknown_tool', { foo: 1 }), null);
    assert.doesNotThrow(() => interpret('apollo_search', {}));
    assert.equal(interpret('apollo_search', null), null);
  }),
);

results.push(
  await test('no drift: every configured tool has a working builder', () => {
    for (const toolName of Object.keys(cfg.tools)) {
      const c = interpret(toolName, { status: 'ok', ok: true, summary: { color: 'green' }, candidates: [], contacts: [], enriched: [], results: [] });
      assert.ok(c && c.badge && c.ran, `tool ${toolName} produced no interpretation block`);
      assert.ok(['FS', 'AP', 'CO', 'DAY'].includes(c.badge), `tool ${toolName} has unexpected badge ${c.badge}`);
    }
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
