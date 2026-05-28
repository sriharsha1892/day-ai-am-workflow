// Worker store. Disk-backed JSON in v1 (worker/data/*.json) — protects against duplicate Day AI
// Organization creation on retry. Idempotency-key -> { type, id, name, link, approvingAm, writtenAt }.
// Pending-sync queue persists across worker restarts so AMs can retry after recovery.
// Swap to Postgres later by replacing this module.

import fs from 'node:fs';
import path from 'node:path';

let store = null;
let storeDir = null;
let idempotencyPath = null;
let pendingPath = null;
let writeQueue = Promise.resolve();

function init() {
  if (store) return;
  // Vercel: filesystem is read-only except /tmp. Fall back automatically.
  const requested = process.env.WORKER_STORE_DIR ?? (process.env.VERCEL ? '/tmp/myra-worker-store' : 'worker/data');
  storeDir = path.resolve(requested);
  fs.mkdirSync(storeDir, { recursive: true });
  idempotencyPath = path.join(storeDir, 'idempotency.json');
  pendingPath = path.join(storeDir, 'pending-sync.json');

  const idempotency = new Map();
  if (fs.existsSync(idempotencyPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(idempotencyPath, 'utf8'));
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

  store = { idempotency, pending };
}

export function getStore() {
  init();
  return store;
}

export function recordIdempotency(key, value) {
  init();
  store.idempotency.set(key, value);
  enqueueWrite(persistIdempotency);
}

export function lookupIdempotency(key) {
  init();
  return store.idempotency.get(key);
}

export function queuePendingSync(entry) {
  init();
  store.pending.push(entry);
  enqueueWrite(persistPending);
}

export function drainPendingByKey(key) {
  init();
  store.pending = store.pending.filter((e) => e.idempotencyKey !== key);
  enqueueWrite(persistPending);
}

export function pendingForAccount(canonicalDomain) {
  init();
  return store.pending.filter((e) => e.canonicalDomain === canonicalDomain);
}

function enqueueWrite(fn) {
  writeQueue = writeQueue.then(fn).catch((error) => {
    process.stderr.write(`[worker/store] write failed: ${error.message}\n`);
  });
}

async function persistIdempotency() {
  const obj = Object.fromEntries(store.idempotency);
  fs.writeFileSync(idempotencyPath, JSON.stringify(obj, null, 2));
}

async function persistPending() {
  fs.writeFileSync(pendingPath, JSON.stringify(store.pending, null, 2));
}
