#!/usr/bin/env node
// Export the current KV assignment state back to templates/master-account-list.csv,
// so live edits (assign_accounts in Codex) can be folded back into git and re-committed.

import fs from 'node:fs';
import path from 'node:path';
import { applyEnv, loadLocalEnv } from './env-utils.mjs';
import { toCsv } from './lib/csv.mjs';

applyEnv(loadLocalEnv('.env.local'));
applyEnv(loadLocalEnv('worker/.env'));

const MASTER_HEADER = ['am_email', 'am_name', 'account_name', 'domain', 'status', 'priority', 'persona_pack', 'cadence_pack', 'channel_pack', 'notes'];
const OUT = process.argv[2] ?? 'templates/master-account-list.csv';

const { listAllAssignments } = await import('../worker/accounts.mjs');
const all = await listAllAssignments();

const rows = [];
for (const [am, accounts] of Object.entries(all.byAm)) {
  for (const a of accounts) {
    rows.push({
      am_email: am,
      am_name: a.amName ?? '',
      account_name: a.accountName,
      domain: a.domain ?? '',
      status: a.status ?? '',
      priority: a.priority ?? '',
      persona_pack: a.personaPack ?? '',
      cadence_pack: a.cadencePack ?? '',
      channel_pack: a.channelPack ?? '',
      notes: a.notes ?? '',
    });
  }
}

fs.writeFileSync(path.resolve(OUT), toCsv(MASTER_HEADER, rows));
console.log(`Dumped ${rows.length} assignments from KV to ${OUT}.`);
