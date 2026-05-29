// Clearout provider. Batch email verification on AM-selected emails only.
// Auth: Bearer fallback to raw token (mirrors scripts/clearout-probe.mjs).

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

export async function clearoutVerify({ emails = [], approvingAm, reason }) {
  if (emails.length === 0) {
    return { status: 'no_data', verified: 0, risky: 0, invalid: 0, results: [], creditsConsumed: 0 };
  }

  const results = [];
  let creditsConsumed = 0;

  for (const email of emails) {
    try {
      const data = await clearoutFetch('/v2/email_verify/instant', {
        method: 'POST',
        body: JSON.stringify({ email, timeout: 15000 }),
      });
      const verdict = data?.data?.status ?? data?.status;
      results.push({
        email,
        status: mapStatus(verdict),
        clearoutReason: data?.data?.sub_status ?? null,
        verifiedAt: new Date().toISOString(),
      });
      creditsConsumed += 1;
    } catch (error) {
      results.push({ email, status: 'failed', clearoutReason: error.message });
    }
  }

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
    results,
    approvingAm,
    reason,
    headlineReason: `${verified} verified, ${risky} risky, ${invalid} invalid (cost: ${creditsConsumed} credits).`,
  };
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
