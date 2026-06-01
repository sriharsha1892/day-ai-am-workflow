// Shared KV primitive. One swappable backend for the whole worker:
// Upstash Redis when KV_REST_API_URL + KV_REST_API_TOKEN are set, else disk JSON (/tmp on Vercel).
//
// This is the modular storage seam — swap Upstash for any KV (Cloudflare KV, DynamoDB, Postgres)
// by reimplementing this one file; nothing else in the worker changes.
//
// API: get(key), set(key, value, {ttlSeconds}), del(key), sadd(setKey, member), smembers(setKey).
// Values are JSON-serialized transparently.

import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

let backend = null;

export function kvBackendKind() {
  return pick().kind;
}

// Top-level API — delegate to the chosen backend.
export async function get(key) {
  return pick().get(key);
}
export async function set(key, value, opts = {}) {
  return pick().set(key, value, opts);
}
export async function del(key) {
  return pick().del(key);
}
export async function sadd(setKey, member) {
  return pick().sadd(setKey, member);
}
export async function smembers(setKey) {
  return pick().smembers(setKey);
}
export async function srem(setKey, member) {
  return pick().srem(setKey, member);
}
// Batch get — one Upstash round-trip (mget) instead of N serial gets (used by listMyAccounts).
export async function mget(keys) {
  return pick().mget(keys);
}

function pick() {
  if (backend) return backend;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  backend = url && token ? redis(new Redis({ url, token })) : disk();
  return backend;
}

function redis(client) {
  return {
    kind: 'redis',
    async get(key) {
      const raw = await client.get(key);
      if (raw == null) return null;
      // @upstash/redis auto-deserializes JSON: objects/numbers come back already parsed.
      if (typeof raw !== 'string') return raw;
      // A plain STRING value (e.g. an am-token -> email map) is NOT JSON — return it as-is rather
      // than throwing on JSON.parse (which silently 401'd KV-only bearer tokens).
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    async set(key, value, opts = {}) {
      const payload = JSON.stringify(value);
      if (opts.ttlSeconds) await client.set(key, payload, { ex: opts.ttlSeconds });
      else await client.set(key, payload);
    },
    async del(key) {
      await client.del(key);
    },
    async sadd(setKey, member) {
      await client.sadd(setKey, member);
    },
    async smembers(setKey) {
      return (await client.smembers(setKey)) ?? [];
    },
    async srem(setKey, member) {
      await client.srem(setKey, member);
    },
    async mget(keys) {
      if (!keys || keys.length === 0) return [];
      const raw = await client.mget(...keys);
      return raw.map((r) => {
        if (r == null) return null;
        if (typeof r !== 'string') return r;
        try {
          return JSON.parse(r);
        } catch {
          return r;
        }
      });
    },
  };
}

function disk() {
  const root = path.resolve(
    process.env.WORKER_KV_DIR ?? (process.env.VERCEL ? '/tmp/myra-kv' : 'worker/data/kv'),
  );
  fs.mkdirSync(root, { recursive: true });
  const fileFor = (key) => path.join(root, `${encodeURIComponent(key)}.json`);
  return {
    kind: 'disk',
    async get(key) {
      const f = fileFor(key);
      if (!fs.existsSync(f)) return null;
      try {
        const { value, expiresAt } = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (expiresAt && Date.now() > expiresAt) {
          fs.rmSync(f, { force: true });
          return null;
        }
        return value;
      } catch {
        return null;
      }
    },
    async set(key, value, opts = {}) {
      const expiresAt = opts.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null;
      fs.writeFileSync(fileFor(key), JSON.stringify({ value, expiresAt }));
    },
    async del(key) {
      fs.rmSync(fileFor(key), { force: true });
    },
    async sadd(setKey, member) {
      const cur = (await this.get(setKey)) ?? [];
      if (!cur.includes(member)) {
        cur.push(member);
        await this.set(setKey, cur);
      }
    },
    async smembers(setKey) {
      return (await this.get(setKey)) ?? [];
    },
    async srem(setKey, member) {
      const cur = (await this.get(setKey)) ?? [];
      const next = cur.filter((m) => m !== member);
      await this.set(setKey, next);
    },
    async mget(keys) {
      return Promise.all((keys ?? []).map((k) => this.get(k)));
    },
  };
}
