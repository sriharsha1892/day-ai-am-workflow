// Server-side tour state. Replaces the local am-package/*.json files so MCP-native
// AMs (no repo clone) keep cross-session continuity. Same dual backend as worker/store.mjs:
// Upstash Redis when KV_REST_API_URL + KV_REST_API_TOKEN are present, else disk JSON.
//
// Keys:
//   tour:{amEmail}:{canonicalDomain}  -> tour-run-state JSON
//   tour-index:{amEmail}              -> SET of canonical domains touched by this AM
//
// Public API (all async):
//   getTourState(amEmail, canonicalDomain)
//   setTourState(amEmail, {canonicalDomain, runStatus, displayName})
//   markStation(amEmail, {canonicalDomain, station, status, idempotencyKey?, dayAiRecordIds?, blockerReason?})
//   nextResume(amEmail)  -> highest-priority unfinished account or null

import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

const TTL_SECONDS = 90 * 86_400;
const STATUS_PRIORITY = {
  pending_sync: 0,
  blocked: 1,
  production_pending_approval: 2,
  production_running: 3,
  dry_run_complete: 4,
};

let backend = null;

function pickBackend() {
  if (backend) return backend;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  backend = url && token ? redisBackend(new Redis({ url, token })) : diskBackend();
  return backend;
}

function blankState(amEmail, canonicalDomain) {
  return {
    version: '3.1',
    account: { canonicalDomain, displayName: canonicalDomain },
    am: { email: amEmail },
    runStatus: 'dry_run_complete',
    stations: [],
    pendingSync: [],
    lastTouchedAt: null,
    lastReceipt: null,
  };
}

function redisBackend(redis) {
  const stateKey = (am, dom) => `tour:${am}:${dom}`;
  const indexKey = (am) => `tour-index:${am}`;
  return {
    kind: 'redis',
    async get(am, dom) {
      const raw = await redis.get(stateKey(am, dom));
      if (!raw) return blankState(am, dom);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },
    async put(am, dom, state) {
      await Promise.all([
        redis.set(stateKey(am, dom), JSON.stringify(state), { ex: TTL_SECONDS }),
        redis.sadd(indexKey(am), dom),
      ]);
    },
    async listDomains(am) {
      return (await redis.smembers(indexKey(am))) ?? [];
    },
  };
}

function diskBackend() {
  const root = path.resolve(
    process.env.WORKER_STATE_DIR ?? (process.env.VERCEL ? '/tmp/myra-tour-state' : 'worker/data/tour'),
  );
  fs.mkdirSync(root, { recursive: true });
  const fileFor = (am, dom) => path.join(root, `${encodeURIComponent(am)}__${encodeURIComponent(dom)}.json`);
  return {
    kind: 'disk',
    async get(am, dom) {
      const f = fileFor(am, dom);
      if (!fs.existsSync(f)) return blankState(am, dom);
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        return blankState(am, dom);
      }
    },
    async put(am, dom, state) {
      fs.writeFileSync(fileFor(am, dom), JSON.stringify(state, null, 2));
    },
    async listDomains(am) {
      const prefix = `${encodeURIComponent(am)}__`;
      return fs
        .readdirSync(root)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .map((f) => decodeURIComponent(f.slice(prefix.length, -'.json'.length)));
    },
  };
}

export async function getTourState(amEmail, canonicalDomain) {
  return pickBackend().get(amEmail, canonicalDomain);
}

export async function setTourState(amEmail, { canonicalDomain, runStatus, displayName }) {
  const be = pickBackend();
  const state = await be.get(amEmail, canonicalDomain);
  state.runStatus = runStatus;
  if (displayName) state.account.displayName = displayName;
  state.lastTouchedAt = new Date().toISOString();
  await be.put(amEmail, canonicalDomain, state);
  return { ok: true, canonicalDomain, runStatus };
}

export async function markStation(amEmail, { canonicalDomain, station, status, idempotencyKey, dayAiRecordIds, blockerReason }) {
  const be = pickBackend();
  const state = await be.get(amEmail, canonicalDomain);
  const now = new Date().toISOString();
  let entry = state.stations.find((s) => s.id === station);
  if (!entry) {
    entry = { id: station, status: 'not_started', startedAt: now };
    state.stations.push(entry);
  }
  entry.status = status;
  if (status === 'in_progress' && !entry.startedAt) entry.startedAt = now;
  if (status === 'complete') entry.completedAt = now;
  if (idempotencyKey) entry.idempotencyKey = idempotencyKey;
  if (dayAiRecordIds) entry.dayAiRecordIds = dayAiRecordIds;
  if (blockerReason) entry.blockerReason = blockerReason;
  state.lastTouchedAt = now;
  await be.put(amEmail, canonicalDomain, state);
  return { ok: true, canonicalDomain, station: entry };
}

export async function nextResume(amEmail) {
  const be = pickBackend();
  const domains = await be.listDomains(amEmail);
  if (!domains.length) return { ok: true, resume: null };
  const states = await Promise.all(domains.map((d) => be.get(amEmail, d)));
  const eligible = states.filter((s) => s.runStatus && s.runStatus !== 'production_saved');
  if (!eligible.length) return { ok: true, resume: null };
  eligible.sort((a, b) => {
    const ap = STATUS_PRIORITY[a.runStatus] ?? 5;
    const bp = STATUS_PRIORITY[b.runStatus] ?? 5;
    if (ap !== bp) return ap - bp;
    return new Date(b.lastTouchedAt ?? 0) - new Date(a.lastTouchedAt ?? 0);
  });
  const chosen = eligible[0];
  return {
    ok: true,
    resume: {
      canonicalDomain: chosen.account.canonicalDomain,
      displayName: chosen.account.displayName,
      runStatus: chosen.runStatus,
      nextActionHint: chosen.lastReceipt?.nextAction ?? null,
      lastReceiptColor: chosen.lastReceipt?.color ?? null,
    },
  };
}

export function stateBackendKind() {
  return pickBackend().kind;
}

// List the canonical domains an AM has any tour state for (used by team insights).
export async function listTourDomains(amEmail) {
  return pickBackend().listDomains(amEmail);
}
