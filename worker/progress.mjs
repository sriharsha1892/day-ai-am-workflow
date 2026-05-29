// Per-account outreach progress. Records which contacts an AM has worked (email verdict, credits)
// so that (1) the unified receipt reflects REAL Apollo-enrich + Clearout-verify state instead of
// hardcoded zeros, (2) the already-contacted guard can see prior myRA work, and (3) cross-session
// resume knows an account has outreach in flight. Telemetry-grade: best-effort, never blocks a loop.

import * as kv from './kv.mjs';

const TTL_SECONDS = 90 * 86_400;
const key = (domain) => `outreach:${String(domain).toLowerCase()}`;

export async function getOutreachProgress(canonicalDomain) {
  if (!canonicalDomain) return null;
  return (await kv.get(key(canonicalDomain)).catch(() => null)) ?? null;
}

export async function recordContactWorked(canonicalDomain, entry) {
  if (!canonicalDomain) return;
  const id = entry.contactId || entry.email || entry.name;
  if (!id) return;
  try {
    const cur = (await kv.get(key(canonicalDomain))) ?? { contacts: {}, updatedAt: null };
    cur.contacts = cur.contacts ?? {};
    cur.contacts[id] = {
      name: entry.name ?? null,
      email: entry.email ?? null,
      emailVerdict: entry.emailVerdict ?? null,
      creditsApollo: entry.creditsApollo ?? 0,
      creditsClearout: entry.creditsClearout ?? 0,
      workedAt: new Date().toISOString(),
    };
    cur.updatedAt = new Date().toISOString();
    await kv.set(key(canonicalDomain), cur, { ttlSeconds: TTL_SECONDS });
  } catch {
    /* best-effort */
  }
}

// "Have we already worked this contact in myRA?" — matched by email first, then name.
export async function findWorkedContact(canonicalDomain, { email, name } = {}) {
  const p = await getOutreachProgress(canonicalDomain);
  if (!p?.contacts) return null;
  const lowerEmail = email ? String(email).toLowerCase() : null;
  const lowerName = name ? String(name).toLowerCase() : null;
  for (const c of Object.values(p.contacts)) {
    if (lowerEmail && c.email && c.email.toLowerCase() === lowerEmail) return c;
    if (lowerName && c.name && c.name.toLowerCase() === lowerName) return c;
  }
  return null;
}

export function summarize(progress) {
  const contacts = progress?.contacts ? Object.values(progress.contacts) : [];
  const verdicts = contacts.map((c) => c.emailVerdict);
  return {
    contactsWorked: contacts.length,
    verified: verdicts.filter((v) => v === 'verified').length,
    risky: verdicts.filter((v) => v === 'risky').length,
    invalid: verdicts.filter((v) => v === 'invalid').length,
    creditsApollo: contacts.reduce((n, c) => n + (c.creditsApollo ?? 0), 0),
    creditsClearout: contacts.reduce((n, c) => n + (c.creditsClearout ?? 0), 0),
    updatedAt: progress?.updatedAt ?? null,
  };
}
