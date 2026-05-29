// Read-through response cache over kv.mjs — the seam that makes follow-up touches cheap and safe
// (provider-flow review, P1/P2). Before this, every Apollo search/enrich, Clearout verify, and
// Freshsales pull re-hit the live API on every touch; first-time and follow-up were identical.
//
// Locked TTLs (recommended defaults; env-overridable but NOT admin-exposed):
//   Apollo search 24h · Apollo enrich 24h · Freshsales evidence 1h · Clearout verdict 30d.
//
// Every cached entry stores { value, cachedAt } so callers can surface "last refreshed Xh ago"
// and offer a refresh bypass. Failures are never cached (the caller passes shouldCache).

import * as kv from './kv.mjs';

const H = 3600;
const D = 86_400;

export const TTL = {
  apolloSearch: Number(process.env.CACHE_TTL_APOLLO_SEARCH ?? 24 * H),
  apolloEnrich: Number(process.env.CACHE_TTL_APOLLO_ENRICH ?? 24 * H),
  freshsales: Number(process.env.CACHE_TTL_FRESHSALES ?? 1 * H),
  clearout: Number(process.env.CACHE_TTL_CLEAROUT ?? 30 * D),
};

export function ageHours(cachedAt) {
  if (!cachedAt) return null;
  return Math.round(((Date.now() - new Date(cachedAt).getTime()) / 3_600_000) * 10) / 10;
}

function isEntry(hit) {
  return hit && typeof hit === 'object' && Object.prototype.hasOwnProperty.call(hit, 'value');
}

// Read-through cache. producer() computes the value on a miss; shouldCache(value) decides whether
// to persist it (default: always). Returns { value, fromCache, cachedAt, ageHours }.
export async function cached(key, ttlSeconds, producer, { refresh = false, shouldCache = () => true } = {}) {
  if (!refresh) {
    const hit = await kv.get(key).catch(() => null);
    if (isEntry(hit)) {
      return { value: hit.value, fromCache: true, cachedAt: hit.cachedAt ?? null, ageHours: ageHours(hit.cachedAt) };
    }
  }
  const value = await producer();
  if (shouldCache(value)) {
    const cachedAt = new Date().toISOString();
    await kv.set(key, { value, cachedAt }, { ttlSeconds }).catch(() => {});
    return { value, fromCache: false, cachedAt, ageHours: 0 };
  }
  return { value, fromCache: false, cachedAt: null, ageHours: null };
}

// Peek a cached entry without a producer (used for credit-spend projection / short-circuits).
export async function peek(key) {
  const hit = await kv.get(key).catch(() => null);
  if (isEntry(hit)) {
    return { value: hit.value, cachedAt: hit.cachedAt ?? null, ageHours: ageHours(hit.cachedAt) };
  }
  return null;
}

export async function putEntry(key, value, ttlSeconds) {
  await kv.set(key, { value, cachedAt: new Date().toISOString() }, { ttlSeconds }).catch(() => {});
}

// --- Key builders (one place so producers and short-circuit checks agree) ---
export function clearoutKey(email) {
  return `clearout-verify:${String(email).trim().toLowerCase()}`;
}
export function enrichKey(id) {
  return `apollo-enrich:${id}`;
}
export function freshsalesKey(domain) {
  return `freshsales:evidence:${String(domain).toLowerCase()}`;
}
export function apolloSearchKey({ canonicalDomain, personaPack = 'balanced', roleBuckets = [] }) {
  return `apollo-search:${String(canonicalDomain).toLowerCase()}:${personaPack}:${[...roleBuckets].sort().join(',')}`;
}
