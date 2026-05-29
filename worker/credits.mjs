// Credit awareness (CLAUDE.md: "show API credit usage"). Records per-AM Apollo/Clearout spend in
// KV and reads remaining balances from the providers, so AMs see cost-before-spend and admins see
// team-wide runway in plain words.

import * as kv from './kv.mjs';

const usageKey = (am, provider, ym) => `credit-usage:${am}:${provider}:${ym}`;

function thisMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Called by the providers after a credit-consuming call. Best-effort; never blocks the request.
export async function recordUsage(amEmail, provider, count) {
  if (!amEmail || !count) return;
  try {
    const key = usageKey(amEmail, provider, thisMonth());
    const cur = (await kv.get(key)) ?? 0;
    await kv.set(key, cur + count, { ttlSeconds: 200 * 86_400 });
  } catch {
    /* telemetry must never break a provider call */
  }
}

async function remaining(provider) {
  try {
    if (provider === 'clearout') {
      // Lazy import avoids a static credits<->clearout cycle (clearout records usage here).
      const { probe } = await import('./providers/clearout.mjs');
      const p = await probe();
      return typeof p.credits === 'number' ? p.credits : null;
    }
    // Apollo's plan endpoint isn't exposed in the probe; remaining is unknown (return null, not 0).
    return null;
  } catch {
    return null;
  }
}

function tokenEmails() {
  const out = new Set();
  for (const pair of (process.env.WORKER_BEARER_TOKENS ?? '').split(',')) {
    const e = pair.split(':')[0]?.trim();
    if (e) out.add(e);
  }
  return out;
}

async function roster() {
  const assigned = await kv.smembers('accounts-roster').catch(() => []);
  return [...new Set([...assigned, ...tokenEmails()])];
}

export async function myCredits(amEmail) {
  const ym = thisMonth();
  const [apolloUsed, clearoutUsed, clearoutRemaining] = await Promise.all([
    kv.get(usageKey(amEmail, 'apollo', ym)).then((v) => v ?? 0),
    kv.get(usageKey(amEmail, 'clearout', ym)).then((v) => v ?? 0),
    remaining('clearout'),
  ]);
  return {
    ok: true,
    amEmail,
    month: ym,
    apollo: { usedThisMonth: apolloUsed },
    clearout: { usedThisMonth: clearoutUsed, remaining: clearoutRemaining },
  };
}

export async function teamCredits() {
  const ym = thisMonth();
  const ams = await roster();
  const perAm = [];
  let apolloTotal = 0;
  let clearoutTotal = 0;
  for (const am of ams) {
    const a = (await kv.get(usageKey(am, 'apollo', ym))) ?? 0;
    const c = (await kv.get(usageKey(am, 'clearout', ym))) ?? 0;
    apolloTotal += a;
    clearoutTotal += c;
    if (a || c) perAm.push({ amEmail: am, apollo: a, clearout: c });
  }
  const clearoutRemaining = await remaining('clearout');
  return {
    ok: true,
    month: ym,
    apollo: { usedThisMonth: apolloTotal },
    clearout: { usedThisMonth: clearoutTotal, remaining: clearoutRemaining, runway: runwayWords(clearoutTotal, clearoutRemaining) },
    perAm,
  };
}

// "Clearout ~2 weeks left at current pace" — turns a number into a decision.
function runwayWords(usedThisMonth, remaining) {
  if (remaining == null) return 'remaining balance unknown';
  if (!usedThisMonth) return `${remaining} left; no usage yet this month`;
  const dayOfMonth = new Date().getUTCDate();
  const perDay = usedThisMonth / Math.max(dayOfMonth, 1);
  if (perDay <= 0) return `${remaining} left`;
  const days = remaining / perDay;
  if (days < 7) return `${remaining} left — under a week at current pace`;
  if (days < 30) return `${remaining} left — ~${Math.round(days / 7)} week(s) at current pace`;
  return `${remaining} left — comfortable (${Math.round(days)} days at current pace)`;
}
