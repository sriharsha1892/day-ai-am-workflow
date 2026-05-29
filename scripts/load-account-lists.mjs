#!/usr/bin/env node
// Seed the central account-assignment KV from templates/master-account-list.csv.
// If the master CSV doesn't exist yet, derive it once from templates/am-account-seed-list.csv.
//
// Usage:
//   node scripts/load-account-lists.mjs --dry-run     # parse + validate, write nothing
//   node scripts/load-account-lists.mjs               # upsert all rows into KV
//   node scripts/load-account-lists.mjs --prune       # also remove KV assignments no longer in the CSV
//
// KV creds (KV_REST_API_URL/TOKEN) come from .env.local / worker/.env, same as the worker.

import fs from 'node:fs';
import path from 'node:path';
import { applyEnv, loadLocalEnv } from './env-utils.mjs';
import { parseCsv, toCsv } from './lib/csv.mjs';

applyEnv(loadLocalEnv('.env.local'));
applyEnv(loadLocalEnv('worker/.env'));

const MASTER = 'templates/master-account-list.csv';
const SEED = 'templates/am-account-seed-list.csv';
const MASTER_HEADER = ['am_email', 'am_name', 'account_name', 'domain', 'status', 'priority', 'persona_pack', 'cadence_pack', 'channel_pack', 'notes'];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const prune = args.has('--prune');

ensureMasterExists();

const { rows } = parseCsv(fs.readFileSync(path.resolve(MASTER), 'utf8'));
if (rows.length === 0) {
  console.error('master-account-list.csv has no rows');
  process.exit(1);
}

console.log(`Loaded ${rows.length} rows from ${MASTER}`);
console.log(`Backend: ${process.env.KV_REST_API_URL ? 'Upstash KV' : 'disk fallback (worker/data/kv)'}`);

if (dryRun) {
  const byAm = {};
  for (const r of rows) byAm[r.am_email] = (byAm[r.am_email] ?? 0) + 1;
  console.log('Dry run — would assign:');
  for (const [am, n] of Object.entries(byAm)) console.log(`  ${am}: ${n}`);
  process.exit(0);
}

const { bulkSeed, listAllAssignments } = await import('../worker/accounts.mjs');

const assignRows = rows.map((r) => ({
  amEmail: r.am_email,
  amName: r.am_name,
  accountName: r.account_name,
  domain: r.domain || undefined,
  status: r.status || undefined,
  priority: r.priority || undefined,
  personaPack: r.persona_pack || undefined,
  cadencePack: r.cadence_pack || undefined,
  channelPack: r.channel_pack || undefined,
  notes: r.notes || undefined,
}));

const result = await bulkSeed(assignRows);
console.log(`Seeded ${result.written} accounts (fast bulk path).`);

if (prune) {
  // Remove any KV assignment whose accountId isn't in the CSV for that AM.
  const { assignAccounts: _a, unassignAccount } = await import('../worker/accounts.mjs');
  const csvKeys = new Set(assignRows.map((r) => `${r.amEmail}::${(r.domain ? r.domain : r.accountName)}`));
  const all = await listAllAssignments();
  let pruned = 0;
  for (const [am, accounts] of Object.entries(all.byAm)) {
    for (const a of accounts) {
      const key = `${am}::${a.domain || a.accountName}`;
      if (!csvKeys.has(key)) {
        await unassignAccount('loader@ask-myra.ai', { amEmail: am, accountId: a.accountId });
        pruned += 1;
      }
    }
  }
  console.log(`Pruned ${pruned} stale assignment(s).`);
}

const summary = await listAllAssignments();
console.log(`\nNow live: ${summary.total} assignments across ${summary.roster.length} AMs.`);
if (summary.conflicts.length) {
  console.log(`WARNING: ${summary.conflicts.length} domain owned by >1 AM:`);
  for (const c of summary.conflicts) console.log(`  ${c.domain}: ${c.ams.join(', ')}`);
}

function ensureMasterExists() {
  if (fs.existsSync(path.resolve(MASTER))) return;
  if (!fs.existsSync(path.resolve(SEED))) {
    console.error(`Neither ${MASTER} nor ${SEED} exists.`);
    process.exit(1);
  }
  console.log(`${MASTER} not found — deriving from ${SEED} (one-time).`);
  const { rows: seedRows } = parseCsv(fs.readFileSync(path.resolve(SEED), 'utf8'));
  const masterRows = seedRows.map((r) => ({
    am_email: r.am_email,
    am_name: r.am_name,
    account_name: r.account_name,
    domain: r.domain ?? '',
    status: r.status ?? 'domain_pending',
    priority: '',
    persona_pack: '',
    cadence_pack: '',
    channel_pack: '',
    notes: r.notes ?? '',
  }));
  fs.writeFileSync(path.resolve(MASTER), toCsv(MASTER_HEADER, masterRows));
  console.log(`  wrote ${masterRows.length} rows to ${MASTER}.`);
}
