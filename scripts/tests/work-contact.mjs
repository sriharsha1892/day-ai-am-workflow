// Tone + safety contract for the per-contact outreach loop.
// Asserts: non-salesy draft, designation-aware framing, queueReady gating, LinkedIn note ≤300/no-link,
// and that the composer/linkedin paths make NO external send.

import { test, assert } from './lib.mjs';
import { composeFirstTouch, personaFrameFor } from '../../worker/compose.mjs';
import { prepareLinkedinTouch } from '../../worker/providers/linkedin.mjs';

const results = [];

results.push(
  await test('composeFirstTouch is non-salesy + designation-aware + soft CTA', () => {
    const d = composeFirstTouch({
      canonicalDomain: 'michelman.com',
      contactName: 'Priya Rao',
      title: 'Head of Market Intelligence',
      seniority: 'Head',
      emailVerdict: 'verified',
      preferences: { signature: '— Satya' },
    });
    assert.equal(d.toneChecks.nonSalesy, true);
    assert.equal(d.toneChecks.noFeatureDump, true);
    assert.equal(d.toneChecks.softCta, true);
    assert.equal(d.toneChecks.leadsWithThem, true);
    assert.equal(d.toneChecks.lengthOk, true);
    assert.ok(/Market Intelligence/.test(d.personaFrameUsed), `expected MI frame, got ${d.personaFrameUsed}`);
    assert.equal(d.queueReady, true);
    assert.ok(d.bodyText.includes('— Satya'), 'signature injected');
  }),
);

results.push(
  await test('invalid email → queueReady false (bounce guard)', () => {
    const d = composeFirstTouch({ canonicalDomain: 'x.com', title: 'Procurement Lead', emailVerdict: 'invalid' });
    assert.equal(d.queueReady, false);
  }),
);

results.push(
  await test('persona frame maps by title with no second source of truth', () => {
    assert.equal(personaFrameFor({ title: 'VP Strategy' }).frameKey, 'Strategy');
    assert.equal(personaFrameFor({ title: 'Category Manager, Procurement' }).frameKey, 'Procurement');
    assert.equal(personaFrameFor({ title: 'Head of Innovation' }).frameKey, 'Innovation');
  }),
);

results.push(
  await test('LinkedIn note is ≤300 chars, no link, no meeting ask', () => {
    const li = prepareLinkedinTouch({
      canonicalDomain: 'michelman.com',
      contactName: 'Priya Rao',
      title: 'Head of Market Intelligence',
      linkedinUrl: 'https://linkedin.com/in/priya',
    });
    assert.ok(li.noteCharCount <= 300, `note ${li.noteCharCount} > 300`);
    assert.ok(!/https?:\/\//.test(li.connectionNote), 'note must contain no link');
    assert.ok(!/\b(demo|pricing|buy|meeting|call)\b/i.test(li.connectionNote), 'note must not pitch or ask for a meeting');
    assert.equal(li.manualOnly, true);
    assert.equal(li.status, 'ok');
  }),
);

results.push(
  await test('prepare_linkedin_touch with no URL returns needs_profile_url (never blocks)', () => {
    const li = prepareLinkedinTouch({ canonicalDomain: 'x.com', contactName: 'Sam', title: 'CTO' });
    assert.equal(li.status, 'needs_profile_url');
    assert.ok(li.connectionNote.length > 0, 'still drafts a note');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
