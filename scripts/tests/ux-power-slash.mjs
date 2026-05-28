// Power-mode slash-command fixture: every shortcut MD now has a ## Execution section
// describing the exact worker:* call Codex invokes, and AGENTS.md declares the
// hosted-worker non-negotiable.

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const shortcuts = [
  'org-resolution',
  'account-intake',
  'freshsales-lookup',
  'map-contacts',
  'source-new-contacts',
  'verify-contact-email',
  'dedupe-contacts',
  'build-cadence',
  'draft-outreach',
  'account-health',
  'guided-tour',
];

const results = [];

for (const slug of shortcuts) {
  results.push(
    await test(`/${slug} has ## Execution section with worker call`, () => {
      const body = fs.readFileSync(path.resolve(`workflow/shortcuts/${slug}.md`), 'utf8');
      assert.ok(body.includes('## Execution'), `## Execution missing in ${slug}.md`);
      assert.ok(
        /npm run worker:/.test(body) || /worker:run-state/.test(body) || /worker:end-tour/.test(body) || /worker:receipt/.test(body),
        `${slug}.md does not reference any worker:* invocation`,
      );
    }),
  );
}

results.push(
  await test('AGENTS.md declares hosted-worker non-negotiable', () => {
    const agents = fs.readFileSync(path.resolve('AGENTS.md'), 'utf8');
    assert.ok(
      /hosted worker/i.test(agents) && /npm run worker:/.test(agents),
      'AGENTS.md must declare hosted worker as production executor',
    );
    assert.ok(
      /idempotency key/i.test(agents),
      'AGENTS.md must require idempotency keys on Day AI writes',
    );
    assert.ok(
      /approvedBy/i.test(agents) || /approving AM/i.test(agents),
      'AGENTS.md must require approving AM stamping',
    );
  }),
);

results.push(
  await test('AGENTS.md auto-resume rule is present', () => {
    const agents = fs.readFileSync(path.resolve('AGENTS.md'), 'utf8');
    assert.ok(
      /worker:run-state\s+next-resume/.test(agents),
      'AGENTS.md must call worker:run-state next-resume on fresh session',
    );
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
