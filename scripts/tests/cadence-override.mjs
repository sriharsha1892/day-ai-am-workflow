// Cadence override test: account-motion schema must accept the new packs override fields
// (channelOrder, stepTimingOverrides, skippedSteps, manualOnlyTaskOverrides) without breaking
// the schema-required guardrails (approvalRequiredForExternalSends, etc.).

import { test, assert } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const motion = JSON.parse(
  fs.readFileSync(path.resolve('workflow/schemas/account-motion.schema.json'), 'utf8'),
);
const packs = JSON.parse(fs.readFileSync(path.resolve('workflow/config/packs.json'), 'utf8'));

const results = [];

results.push(
  await test('account-motion.packs schema accepts override fields', () => {
    const props = motion.properties.packs.properties;
    for (const f of ['channelOrder', 'stepTimingOverrides', 'skippedSteps', 'manualOnlyTaskOverrides']) {
      assert.ok(props[f], `missing ${f} in account-motion.packs`);
    }
  }),
);

results.push(
  await test('packs.json customization.allowed lists override fields', () => {
    for (const f of ['channelOrder', 'stepTimingOverride', 'stepSkip', 'manualOnlyTaskOverride']) {
      assert.ok(
        packs.customization.allowed.includes(f),
        `customization.allowed missing ${f}`,
      );
    }
  }),
);

results.push(
  await test('packs.json customization.guardrailsCannotOverride preserves all 6 guardrails', () => {
    const required = [
      'approvalRequiredForExternalSends',
      'approvalRequiredForCanonicalContactCreation',
      'approvalRequiredForLifecycleStageChangeAfterIntake',
      'freshsalesReadOnly',
      'noCalendarWriteInV1',
      'dayAiLedgerOnlyForOutreachMetrics',
    ];
    for (const g of required) {
      assert.ok(
        packs.customization.guardrailsCannotOverride.includes(g),
        `guardrail removed: ${g}`,
      );
    }
  }),
);

results.push(
  await test('packs.json customization.collectionStyle is walk_each_field_in_sequence', () => {
    assert.equal(packs.customization.collectionStyle, 'walk_each_field_in_sequence');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
