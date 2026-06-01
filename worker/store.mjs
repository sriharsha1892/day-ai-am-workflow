// Worker store. Two backends:
//   1. Upstash Redis (used when KV_REST_API_URL + KV_REST_API_TOKEN are present — set
//      automatically when you provision Vercel KV or wire up Upstash directly).
//   2. Disk-backed JSON in worker/data/*.json (local dev fallback; auto-/tmp on Vercel).
//
// Redis layout:
//   idem:{key}                  -> JSON value (30 day TTL)
//   account-keys:{domain}       -> SET of idempotency keys for that domain
//   pending:{domain}            -> LIST of pending-sync entries (newest at tail)
//
// Public API (all async):
//   recordIdempotency(key, value)
//   lookupIdempotency(key)
//   getIdempotencyForAccount(canonicalDomain) -> array of stored values
//   queuePendingSync(entry)               // entry.canonicalDomain required
//   pendingForAccount(canonicalDomain)    -> array
//   drainPendingByKey(idempotencyKey)
//
// The disk fallback writes via a queued promise chain so concurrent calls don't
// step on each other; the Redis backend uses Upstash's REST API which is naturally
// atomic per command.

import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

const IDEM_TTL_SECONDS = 30 * 86_400;

let backend = null;

function pickBackend() {
  if (backend) return backend;

  const kvUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    backend = createRedisBackend(kvUrl, kvToken);
  } else {
    backend = createDiskBackend();
  }
  return backend;
}

function createRedisBackend(url, token) {
  const redis = new Redis({ url, token });
  return {
    kind: 'redis',
    async recordIdempotency(key, value) {
      const domain = extractDomain(key, value);
      const payload = JSON.stringify(value);
      // Pipeline: set the value with TTL and add the key to the account's set.
      await Promise.all([
        redis.set(`idem:${key}`, payload, { ex: IDEM_TTL_SECONDS }),
        domain ? redis.sadd(`account-keys:${domain}`, key) : Promise.resolve(),
      ]);
    },
    async lookupIdempotency(key) {
      const raw = await redis.get(`idem:${key}`);
      if (!raw) return undefined;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },
    async getIdempotencyForAccount(canonicalDomain) {
      if (!canonicalDomain) return [];
      const keys = await redis.smembers(`account-keys:${canonicalDomain}`);
      if (!keys || keys.length === 0) return [];
      const values = await redis.mget(...keys.map((k) => `idem:${k}`));
      return values
        .map((v) => (typeof v === 'string' ? JSON.parse(v) : v))
        .filter(Boolean);
    },
    async queuePendingSync(entry) {
      const domain = entry.canonicalDomain ?? 'no-domain';
      await redis.rpush(`pending:${domain}`, JSON.stringify(entry));
    },
    async pendingForAccount(canonicalDomain) {
      if (!canonicalDomain) return [];
      const raw = await redis.lrange(`pending:${canonicalDomain}`, 0, -1);
      return raw
        .map((v) => (typeof v === 'string' ? JSON.parse(v) : v))
        .filter(Boolean);
    },
    async drainPendingByKey(idempotencyKey) {
      // Redis lrem requires the exact stringified value. Scan only the keys we know about.
      // For pilot scale we can afford to scan all pending:* lists; in production we'd
      // index pending entries by idempotency key directly.
      const cursor = '0';
      const seenDomains = new Set();
      let nextCursor = cursor;
      do {
        const result = await redis.scan(nextCursor, { match: 'pending:*', count: 100 });
        nextCursor = String(result[0] ?? '0');
        for (const key of result[1] ?? []) {
          const domain = key.replace(/^pending:/, '');
          if (seenDomains.has(domain)) continue;
          seenDomains.add(domain);
          const entries = await redis.lrange(key, 0, -1);
          for (const raw of entries) {
            const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (entry?.idempotencyKey === idempotencyKey) {
              await redis.lrem(key, 1, raw);
            }
          }
        }
      } while (nextCursor !== '0');
    },
    async allPending() {
      const out = [];
      let nextCursor = '0';
      do {
        const result = await redis.scan(nextCursor, { match: 'pending:*', count: 100 });
        nextCursor = String(result[0] ?? '0');
        for (const key of result[1] ?? []) {
          const entries = await redis.lrange(key, 0, -1);
          for (const raw of entries) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
        }
      } while (nextCursor !== '0');
      return out;
    },
  };
}

function createDiskBackend() {
  const root = path.resolve(
    process.env.WORKER_STORE_DIR ?? (process.env.VERCEL ? '/tmp/myra-worker-store' : 'worker/data'),
  );
  fs.mkdirSync(root, { recursive: true });
  const idemPath = path.join(root, 'idempotency.json');
  const pendingPath = path.join(root, 'pending-sync.json');

  const idempotency = new Map();
  if (fs.existsSync(idemPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(idemPath, 'utf8'));
      for (const [k, v] of Object.entries(data)) idempotency.set(k, v);
    } catch {
      /* ignore corrupt store */
    }
  }
  let pending = [];
  if (fs.existsSync(pendingPath)) {
    try {
      pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    } catch {
      pending = [];
    }
  }

  let writeQueue = Promise.resolve();
  const enqueue = (fn) => {
    writeQueue = writeQueue.then(fn).catch((error) => {
      process.stderr.write(`[worker/store] disk write failed: ${error.message}\n`);
    });
    return writeQueue;
  };

  const flushIdem = () =>
    enqueue(async () => {
      fs.writeFileSync(idemPath, JSON.stringify(Object.fromEntries(idempotency), null, 2));
    });

  const flushPending = () =>
    enqueue(async () => {
      fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
    });

  return {
    kind: 'disk',
    async recordIdempotency(key, value) {
      idempotency.set(key, value);
      await flushIdem();
    },
    async lookupIdempotency(key) {
      return idempotency.get(key);
    },
    async getIdempotencyForAccount(canonicalDomain) {
      if (!canonicalDomain) return [];
      return [...idempotency.values()].filter((v) =>
        v.idempotencyKey?.includes(canonicalDomain),
      );
    },
    async queuePendingSync(entry) {
      pending.push(entry);
      await flushPending();
    },
    async pendingForAccount(canonicalDomain) {
      if (!canonicalDomain) return [...pending];
      return pending.filter((e) => e.canonicalDomain === canonicalDomain);
    },
    async drainPendingByKey(idempotencyKey) {
      pending = pending.filter((e) => e.idempotencyKey !== idempotencyKey);
      await flushPending();
    },
    async allPending() {
      return [...pending];
    },
  };
}

function extractDomain(key, value) {
  if (value?.canonicalDomain) return value.canonicalDomain;
  // Fallback: idempotency keys have shape "<verb>.<domain>.<date>.<hash>"
  const parts = String(key).split('.');
  if (parts.length >= 4) return parts.slice(1, -2).join('.');
  return null;
}

// Public API — async wrappers over the chosen backend.
export async function recordIdempotency(key, value) {
  return pickBackend().recordIdempotency(key, value);
}

export async function lookupIdempotency(key) {
  return pickBackend().lookupIdempotency(key);
}

export async function getIdempotencyForAccount(canonicalDomain) {
  return pickBackend().getIdempotencyForAccount(canonicalDomain);
}

export async function queuePendingSync(entry) {
  return pickBackend().queuePendingSync(entry);
}

export async function pendingForAccount(canonicalDomain) {
  return pickBackend().pendingForAccount(canonicalDomain);
}

export async function drainPendingByKey(idempotencyKey) {
  return pickBackend().drainPendingByKey(idempotencyKey);
}

export async function allPending() {
  return pickBackend().allPending();
}

export function backendKind() {
  return pickBackend().kind;
}
