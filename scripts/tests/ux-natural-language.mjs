// Beginner-mode / natural-language fixture: confirm ux-guidance.json routes the natural prompts
// the Michelman runbook depends on (resume, end-tour, show-details, retry sync).

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ux = JSON.parse(
  fs.readFileSync(path.resolve('workflow/config/ux-guidance.json'), 'utf8'),
);

function routeFor(phrase) {
  const lower = phrase.toLowerCase();
  for (const r of ux.naturalPromptRoutes) {
    if (r.examples.some((e) => e.toLowerCase() === lower)) return r.route;
  }
  return null;
}

const results = [];

results.push(
  await test('resume phrases route to /guided-tour resume', () => {
    for (const p of ['continue', 'resume', 'where was i']) {
      assert.equal(routeFor(p), '/guided-tour resume', `phrase "${p}" did not route to resume`);
    }
  }),
);

results.push(
  await test('end-tour phrases route to /end-tour', () => {
    for (const p of ['bye', 'wrap up', 'end tour', 'done for today', 'goodbye']) {
      assert.equal(routeFor(p), '/end-tour', `phrase "${p}" did not route to end-tour`);
    }
  }),
);

results.push(
  await test('show-details phrases route to /expand-receipt', () => {
    for (const p of ['show details', 'show your work', 'why', 'expand']) {
      assert.equal(routeFor(p), '/expand-receipt', `phrase "${p}" did not route to expand-receipt`);
    }
  }),
);

results.push(
  await test('recovery phrases route to /guided-tour recovery', () => {
    for (const p of ['mcp crashed', 'retry sync', 'worker unreachable', 'day ai broke']) {
      assert.equal(routeFor(p), '/guided-tour recovery', `phrase "${p}" did not route to recovery`);
    }
  }),
);

results.push(
  await test('ux-guidance contactSelection is bulk-with-veto with numbered escape', () => {
    assert.equal(ux.contactSelection.defaultFlow, 'bulk_with_veto_then_walk_maybe');
    assert.equal(ux.contactSelection.powerEscape, 'numbered_list_anywhere');
  }),
);

results.push(
  await test('renderingMode is narrative + bullets with power suppression', () => {
    assert.equal(ux.renderingMode.narrative, true);
    assert.equal(ux.renderingMode.providerBullets, true);
    assert.equal(ux.renderingMode.suppressNarrativeInPowerMode, true);
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
