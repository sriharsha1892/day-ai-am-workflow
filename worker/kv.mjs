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
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
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
  };
}
