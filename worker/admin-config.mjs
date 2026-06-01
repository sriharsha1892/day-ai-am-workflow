// Tunable admin thresholds in KV (no redeploy). assignment_health + credits read these; an admin
// adjusts them via the set_admin_thresholds tool. Fallback to sensible defaults.

import * as kv from './kv.mjs';

const KEY = 'admin:thresholds';
export const THRESHOLD_DEFAULTS = {
  overloadThreshold: 60,
  staleDays: 14,
  lowRunwayDays: 7,
  // KV > env > default. Folded in so an admin can tune them via set_admin_thresholds (no redeploy).
  creditFloor: Number(process.env.CREDIT_FLOOR ?? 50),
  duplicateRiskMediumMax: Number(process.env.DUP_RISK_MEDIUM_MAX ?? 3),
};

export async function getThresholds() {
  const stored = await kv.get(KEY).catch(() => null);
  return { ...THRESHOLD_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export async function setThresholds(partial = {}) {
  const cur = await getThresholds();
  const next = { ...cur };
  for (const k of Object.keys(THRESHOLD_DEFAULTS)) {
    if (partial[k] != null && Number.isFinite(Number(partial[k]))) next[k] = Number(partial[k]);
  }
  await kv.set(KEY, next);
  return next;
}
