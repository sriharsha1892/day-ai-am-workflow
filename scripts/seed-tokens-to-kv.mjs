#!/usr/bin/env node
// One-time (idempotent) seed: copy the existing WORKER_BEARER_TOKENS env map into KV as
// am-token:{sha256(token)} -> amEmail, so the 3 live AMs (satya/satish/harsha) authenticate via the
// new KV path after the api/mcp.mjs change. The env-var map stays as a fallback (do NOT delete it
// from Vercel during the pilot). Run after deploy:  npm run seed:tokens

import { applyEnv, loadLocalEnv, envPath } from './env-utils.mjs';
import * as kv from '../worker/kv.mjs';
import { amTokenKey } from '../worker/token-hash.mjs';

applyEnv(loadLocalEnv(envPath));

const raw = process.env.WORKER_BEARER_TOKENS ?? '';
if (!raw.trim()) {
  console.error('WORKER_BEARER_TOKENS is empty in .env.local — nothing to seed. (run `vercel env pull`)');
  process.exit(1);
}
console.log(`Backend: ${process.env.KV_REST_API_URL ? 'Upstash KV' : 'disk fallback (worker/data/kv)'}`);

let seeded = 0;
for (const pair of raw.split(',')) {
  const idx = pair.indexOf(':');
  if (idx === -1) continue;
  const email = pair.slice(0, idx).trim();
  const token = pair.slice(idx + 1).trim();
  if (!email || !token) continue;
  await kv.set(amTokenKey(token), email);
  console.log(`  seeded ${email}`);
  seeded += 1;
}
console.log(`\nDone — ${seeded} token(s) now resolve via KV. (Env-var fallback preserved.)`);
