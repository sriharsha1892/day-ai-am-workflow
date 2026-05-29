// Clearout provider. Email verification on AM-selected emails only.
// Auth: Bearer fallback to raw token (mirrors scripts/clearout-probe.mjs).
// Verdicts are cached 30d (worker/cache.mjs) so re-verifying the same address is free and the
// system can answer "verified when?"; verification runs with bounded concurrency, not serially.

import { cached, clearoutKey, TTL } from '../cache.mjs';

function baseUrl() {
  return (process.env.CLEAROUT_BASE_URL || 'https://api.clearout.io').replace(/\/+$/, '');
}

function token() {
  const t = process.env.CLEAROUT_API_TOKEN;
  if (!t) throw new Error('Missing CLEAROUT_API_TOKEN');
  return t;
}

async function clearoutFetch(path, init = {}) {
  const url = `${baseUrl()}${path}`;
  const attempts = [`Bearer ${token()}`, token()];
  let lastError;
  for (const authHeader of attempts) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      if (response.ok) {
        return text ? JSON.parse(text) : {};
      }
      lastError = new Error(`Clearout ${response.status}: ${safeMessage(text)} (${authHeader.startsWith('Bearer') ? 'bearer' : 'raw'})`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Clearout: unknown error');
}

export async function probe() {
  const data = await clearoutFetch('/v2/email_verify/getcredits', { method: 'GET' });
  const credits =
    data?.available_credits ??
    data?.availableCredits ??
    data?.credits ??
    data?.data?.available_credits ??
    data?.data?.availableCredits ??
    data?.data?.credits;
  return { ok: true, credits };
}

export async function clearoutVerify({ emails = [], approvingAm, reason, refresh = false, concurrency = 5 }) {
  if (emails.length === 0) {
    return { status: 'no_data', verified: 0, risky: 0, invalid: 0, results: [], creditsConsumed: 0, servedFromCache: 0 };
  }

  let creditsConsumed = 0;
  let servedFromCache = 0;

  const verifyOne = async (email) => {
    const res = await cached(
      clearoutKey(email),
      TTL.clearout,
      async () => {
        const data = await clearoutFetch('/v2/email_verify/instant', {
          method: 'POST',
          body: JSON.stringify({ email, timeout: 15000 }),
        });
        const verdict = data?.data?.status ?? data?.status;
        return {
          email,
          status: mapStatus(verdict),
          clearoutReason: data?.data?.sub_status ?? null,
          verifiedAt: new Date().toISOString(),
        };
      },
      // Never cache a transport failure — only real verdicts get the 30d TTL.
      { refresh, shouldCache: (v) => v && v.status !== 'failed' },
    ).catch((error) => ({ value: { email, status: 'failed', clearoutReason: error.message, verifiedAt: null }, fromCache: false, cachedAt: null }));

    if (res.fromCache) servedFromCache += 1;
    else if (res.value.status !== 'failed') creditsConsumed += 1;

    return { ...res.value, verifiedAt: res.value.verifiedAt ?? res.cachedAt, cached: res.fromCache };
  };

  const results = await runPool(emails, concurrency, verifyOne);

  const verified = results.filter((r) => r.status === 'verified').length;
  const risky = results.filter((r) => r.status === 'risky').length;
  const invalid = results.filter((r) => r.status === 'invalid').length;
  const allFailed = results.length > 0 && results.every((r) => r.status === 'failed');

  if (creditsConsumed) {
    const { recordUsage } = await import('../credits.mjs');
    await recordUsage(approvingAm, 'clearout', creditsConsumed);
  }

  return {
    status: allFailed ? 'failed' : 'ok',
    verified,
    risky,
    invalid,
    creditsConsumed,
    servedFromCache,
    results,
    approvingAm,
    reason,
    headlineReason: `${verified} verified, ${risky} risky, ${invalid} invalid (cost: ${creditsConsumed} credit${creditsConsumed === 1 ? '' : 's'}${servedFromCache ? `, ${servedFromCache} from cache` : ''}).`,
  };
}

// Bounded concurrency so a large selection respects Clearout limits without a slow serial loop.
async function runPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function mapStatus(verdict) {
  const v = String(verdict ?? '').toLowerCase();
  if (v === 'valid' || v === 'verified' || v === 'safe_to_send') return 'verified';
  if (v === 'risky' || v === 'accept_all' || v === 'unknown') return 'risky';
  if (v === 'invalid' || v === 'undeliverable' || v === 'rejected_email') return 'invalid';
  return 'risky';
}

function safeMessage(text) {
  if (!text) return 'no body';
  try {
    const data = JSON.parse(text);
    return String(data.message ?? data.error ?? data.errors ?? '').slice(0, 300);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 300);
  }
}
