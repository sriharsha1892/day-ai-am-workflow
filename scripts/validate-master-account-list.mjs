#!/usr/bin/env node
// Validate templates/master-account-list.csv: required columns, status enum, pack names vs packs.json,
// duplicate domain across AMs. Supersedes validate-account-seed-list + validate-account-assignments.
// Wired into validate:all.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';

const MASTER = 'templates/master-account-list.csv';
const STATUSES = new Set(['ready_for_intake', 'domain_pending', 'identity_review', 'hold']);

if (!fs.existsSync(path.resolve(MASTER))) {
  console.log(`OK: ${MASTER} not present yet (run accounts:load to derive it from the seed).`);
  process.exit(0);
}

const packs = JSON.parse(fs.readFileSync(path.resolve('workflow/config/packs.json'), 'utf8'));
const personaPacks = new Set(Object.keys(packs.personaPacks ?? {}));
const cadencePacks = new Set(Object.keys(packs.cadencePacks ?? {}));
const channelPacks = new Set(Object.keys(packs.channelPacks ?? {}));

const { rows } = parseCsv(fs.readFileSync(path.resolve(MASTER), 'utf8'));
const errors = [];
const warnings = [];
const domainOwners = {};

rows.forEach((r, i) => {
  const where = `row ${i + 2} (${r.account_name || '?'})`;
  if (!r.am_email || !r.am_email.includes('@')) errors.push(`${where}: invalid am_email "${r.am_email}"`);
  if (!r.account_name) errors.push(`${where}: missing account_name`);
  if (r.status && !STATUSES.has(r.status)) errors.push(`${where}: invalid status "${r.status}"`);
  if (r.persona_pack && !personaPacks.has(r.persona_pack)) warnings.push(`${where}: unknown persona_pack "${r.persona_pack}"`);
  if (r.cadence_pack && !cadencePacks.has(r.cadence_pack)) warnings.push(`${where}: unknown cadence_pack "${r.cadence_pack}"`);
  if (r.channel_pack && !channelPacks.has(r.channel_pack)) warnings.push(`${where}: unknown channel_pack "${r.channel_pack}"`);
  if (r.status === 'ready_for_intake' && !r.domain) errors.push(`${where}: ready_for_intake requires a domain`);
  if (r.domain) {
    const d = r.domain.toLowerCase();
    (domainOwners[d] ??= new Set()).add(r.am_email);
  }
});

for (const [domain, ams] of Object.entries(domainOwners)) {
  if (ams.size > 1) errors.push(`domain ${domain} assigned to multiple AMs: ${[...ams].join(', ')}`);
}

if (warnings.length) {
  console.warn(`${warnings.length} warning(s):`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}
if (errors.length) {
  console.error(`${errors.length} error(s):`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log(`OK: ${rows.length} master-account-list row(s) validated.`);
