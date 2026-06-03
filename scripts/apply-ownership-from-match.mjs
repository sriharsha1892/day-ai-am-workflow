#!/usr/bin/env node
// apply-ownership-from-match.mjs — W4-4B (companion): tag Day.ai orgs with AM ownership
// based on NAME-MATCH against master-account-list.csv.
//
// The original apply-org-ownership.mjs matches by domain. Since the master CSV currently
// has 0 explicit domains (all 178 rows are status=domain_pending), the domain-match script
// produces 0 hits. This script uses the pre-computed name-match results from the W4-4D audit.
//
// Reads:
//   templates/org-cleanup-reports/cull-matched-to-master.csv  (111 rows: domain → master_account_name)
//   templates/master-account-list.csv                          (master_account_name → am_email)
//   templates/day-ai-workspace-ids.json                        (AM Account List option UUIDs)
//
// Writes via /v1/day-ai/write action=org-update-tags: for each matched (domain, master_name)
// pair, looks up the AM from master CSV and sets AM Account List on the Day.ai org.
//
// Usage:
//   node scripts/apply-ownership-from-match.mjs --dry-run
//   node scripts/apply-ownership-from-match.mjs                    # live

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, canonicalDomain, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MATCH_CSV = path.join(REPO_ROOT, 'templates', 'org-cleanup-reports', 'cull-matched-to-master.csv');
const MASTER_CSV = path.join(REPO_ROOT, 'templates', 'master-account-list.csv');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPROVING_AM = 'harsha@ask-myra.ai';

if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);
if (!fs.existsSync(MATCH_CSV)) fail(`Match CSV not found: ${MATCH_CSV} — re-run W4-4D audit to regenerate.`);
if (!fs.existsSync(MASTER_CSV)) fail(`Master CSV not found: ${MASTER_CSV}`);

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const amAccountList = ids?.customProperties?.amAccountList;
if (!amAccountList?.id || !amAccountList?.options) {
  fail('templates/day-ai-workspace-ids.json missing customProperties.amAccountList — re-run W4-4A.');
}

// Build: master_account_name → am_email + am_name
const masterByName = {}; // lowercased name → {am_email, am_name}
{
  const text = fs.readFileSync(MASTER_CSV, 'utf8');
  const rows = parseCsv(text);
  for (const row of rows) {
    const name = (row.account_name || '').trim();
    if (!name) continue;
    masterByName[name.toLowerCase()] = {
      am_email: (row.am_email || '').trim(),
      am_name: (row.am_name || '').trim(),
    };
  }
}

// Map am_email local-part → AM Account List option UUID
function emailToOptionKey(email) {
  return String(email || '').toLowerCase().trim().split('@')[0];
}
function resolveOptionId(amEmail) {
  const key = emailToOptionKey(amEmail);
  return amAccountList.options[key] ?? null;
}

// Read match CSV
const matches = parseCsv(fs.readFileSync(MATCH_CSV, 'utf8'));
console.log(`# apply-ownership-from-match ${DRY_RUN ? '(DRY RUN)' : ''}`);
console.log(`# Matches to process: ${matches.length}\n`);

const tally = {};
let attempted = 0, ok = 0, errored = 0, skipped = 0;

for (const [i, row] of matches.entries()) {
  const lineNo = i + 2;
  const domain = canonicalDomain((row.domain || '').trim());
  const masterName = (row.master_account_name || '').trim();
  if (!domain || !masterName) {
    skipped++;
    continue;
  }

  const masterEntry = masterByName[masterName.toLowerCase()];
  if (!masterEntry?.am_email) {
    console.warn(`  L${lineNo} ${domain}: SKIP — master entry "${masterName}" not found or has no am_email`);
    skipped++;
    continue;
  }

  const amName = masterEntry.am_name || emailToOptionKey(masterEntry.am_email);
  tally[amName] ??= { ok: 0, error: 0 };

  const optionId = resolveOptionId(masterEntry.am_email);
  if (!optionId) {
    console.warn(`  L${lineNo} ${domain}: SKIP — no AM Account List option for "${masterEntry.am_email}"`);
    tally[amName].error++;
    errored++;
    continue;
  }

  attempted++;
  const idempotencyKey = buildIdempotencyKey({
    action: 'org-update-tags',
    canonicalDomain: domain,
    extra: `am:${amName}`,
  });
  const payload = {
    action: 'org-update-tags',
    approvingAm: APPROVING_AM,
    canonicalDomain: domain,
    idempotencyKey,
    retry: false,
    customProperties: [
      {
        propertyId: amAccountList.id,
        value: optionId,
        reasoning: `W4-4B name-match: Day.ai "${row.name || domain}" → master "${masterName}" → owned by ${amName} (${masterEntry.am_email}). Match type: ${row.match_type}.`,
      },
    ],
  };

  if (DRY_RUN) {
    console.log(`  ${(i + 1).toString().padStart(3, ' ')}/${matches.length}  ${domain.padEnd(36)} -> ${amName}  (${row.match_type})`);
    tally[amName].ok++;
    ok++;
    continue;
  }

  const result = await callWorker('v1/day-ai/write', payload);
  if (result?.ok ?? result?.success) {
    console.log(`  ${(i + 1).toString().padStart(3, ' ')}/${matches.length}  ${domain.padEnd(36)} -> ${amName}`);
    tally[amName].ok++;
    ok++;
  } else {
    console.warn(`  ${(i + 1).toString().padStart(3, ' ')}/${matches.length}  ${domain.padEnd(36)} FAIL — ${safe(result)}`);
    tally[amName].error++;
    errored++;
  }
}

console.log(`\n# Per-AM tally`);
for (const [am, t] of Object.entries(tally)) {
  console.log(`  ${am.padEnd(20)} ok=${t.ok}  error=${t.error}`);
}
console.log(`\n# Totals: attempted=${attempted}  ok=${ok}  skipped=${skipped}  errored=${errored}`);
if (errored > 0) process.exit(1);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    header.forEach((key, idx) => { row[key] = (cells[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur.length === 0) { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}
function safe(r) {
  if (!r) return '(no response)';
  if (typeof r === 'string') return r.slice(0, 200);
  return (r.error || r.message || JSON.stringify(r)).slice(0, 200);
}
function fail(msg) { process.stderr.write(`FAIL ${msg}\n`); process.exit(1); }
