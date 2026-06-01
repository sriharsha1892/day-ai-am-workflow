// admin-config now owns creditFloor (outreach spend gate) + duplicateRiskMediumMax (Freshsales
// duplicate-risk tier), tunable via set_admin_thresholds (KV > env > default). Pins their presence.

import { test, assert } from './lib.mjs';
import { getThresholds, THRESHOLD_DEFAULTS } from '../../worker/admin-config.mjs';

const results = [];

results.push(
  await test('admin-config exposes creditFloor + duplicateRiskMediumMax (and keeps the originals)', async () => {
    assert.ok(Number.isFinite(THRESHOLD_DEFAULTS.creditFloor), 'creditFloor default is a number');
    assert.ok(Number.isFinite(THRESHOLD_DEFAULTS.duplicateRiskMediumMax), 'duplicateRiskMediumMax default is a number');
    const t = await getThresholds();
    for (const k of ['overloadThreshold', 'staleDays', 'lowRunwayDays', 'creditFloor', 'duplicateRiskMediumMax']) {
      assert.ok(Number.isFinite(t[k]), `getThresholds returns numeric ${k}`);
    }
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
