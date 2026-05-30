// Locks the Day AI write contract (root of the ITC "returned no record ID" bug). create_or_update_*
// tools take properties under standardProperties (verified vs live tools/list + day-ai-sdk SCHEMA.md);
// org objectId IS the domain; and the resolver must only auto_link_existing when a real Day AI org
// exists (else create_org_from_evidence -> org-create). Pure/offline — asserts arg shapes + decide().

import { test, assert } from './lib.mjs';
import { WRITE_HANDLERS } from '../../worker/providers/day-ai.mjs';
import { decide } from '../../worker/identity.mjs';

const results = [];

results.push(
  await test('org-create: properties under standardProperties; id = domain', () => {
    const a = WRITE_HANDLERS['org-create'].args({ canonicalDomain: 'itc.in', accountName: 'ITC Limited' });
    assert.equal(a.objectType, 'Organization');
    assert.equal(a.isCreating, true);
    assert.equal(a.standardProperties?.domain, 'itc.in');
    assert.equal(a.standardProperties?.name, 'ITC Limited');
    assert.equal(a.domain, undefined, 'must NOT put domain at the top level');
    const rec = WRITE_HANDLERS['org-create'].extractRecord({}, { canonicalDomain: 'itc.in', accountName: 'ITC Limited' });
    assert.equal(rec.id, 'itc.in', 'org objectId is the domain');
  }),
);

results.push(
  await test('person-create: objectType Person + standardProperties', () => {
    const a = WRITE_HANDLERS['person-create'].args({ candidate: { email: 'a@b.com', name: 'Ann Bee', title: 'VP' } });
    assert.equal(a.objectType, 'Person');
    assert.equal(a.standardProperties?.email, 'a@b.com');
    assert.equal(a.standardProperties?.jobTitle, 'VP');
    assert.equal(a.email, undefined, 'no top-level email');
  }),
);

results.push(
  await test('opportunity-create: standardProperties.title/stageId/domain', () => {
    const a = WRITE_HANDLERS['opportunity-create'].args({ canonicalDomain: 'itc.in', stageId: 's1', approvingAm: 'x@y.com' });
    assert.ok(a.standardProperties?.title);
    assert.equal(a.standardProperties?.domain, 'itc.in');
    assert.equal(a.standardProperties?.stageId, 's1');
    assert.equal(a.domain, undefined);
  }),
);

results.push(
  await test('action-create: live field names (ownerEmail/dueDate/people/domains)', () => {
    const a = WRITE_HANDLERS['action-create'].args({ canonicalDomain: 'itc.in', summary: 'Connect on LinkedIn', contactEmail: 'a@b.com', approvingAm: 'x@y.com', channel: 'linkedin', dueAt: '2026-06-01' });
    assert.equal(a.ownerEmail, 'x@y.com');
    assert.equal(a.dueDate, '2026-06-01');
    assert.deepEqual(a.people, ['a@b.com']);
    assert.deepEqual(a.domains, ['itc.in']);
    assert.equal(a.assignedToAssistant, false);
    assert.equal(a.assigneeEmail, undefined);
    assert.equal(a.channel, undefined, 'channel is not a Day AI action field');
  }),
);

results.push(
  await test('draft-create: required description + to as array', () => {
    const a = WRITE_HANDLERS['draft-create'].args({ canonicalDomain: 'itc.in', contactEmail: 'a@b.com', subject: 'Hi', bodyHtml: '<p>x</p>' });
    assert.ok(a.description && a.description.length > 0, 'description is required');
    assert.deepEqual(a.to, ['a@b.com'], 'to must be an array');
    assert.equal(a.relatedOpportunityDomain, undefined);
  }),
);

results.push(
  await test('review-context: mode + plainTextValue + object attachment', () => {
    const a = WRITE_HANDLERS['review-context'].args({ canonicalDomain: 'itc.in', summary: 'Review', reason: 'note' });
    assert.equal(a.mode, 'create');
    assert.equal(a.plainTextValue, 'note');
    assert.equal(a.attachmentType, 'object');
    assert.equal(a.objectType, 'native_organization');
    assert.equal(a.objectId, 'itc.in');
    assert.equal(a.content, undefined);
  }),
);

results.push(
  await test('decide(): Freshsales-only strong match → create_org_from_evidence (not auto_link)', () => {
    const best = { confidence: 0.99, dayAiOrganizationId: undefined, evidence: [{ source: 'freshsales' }] };
    const d = decide(best, 1);
    assert.equal(d.action, 'create_org_from_evidence');
    assert.equal(d.matchedDayAiOrgId, undefined);
  }),
);

results.push(
  await test('decide(): a real Day AI org → auto_link_existing + matchedDayAiOrgId', () => {
    const best = { confidence: 0.99, dayAiOrganizationId: 'itc.in', evidence: [{ source: 'day-ai' }] };
    const d = decide(best, 1);
    assert.equal(d.action, 'auto_link_existing');
    assert.equal(d.matchedDayAiOrgId, 'itc.in');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
