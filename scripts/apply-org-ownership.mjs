#!/usr/bin/env node
// apply-org-ownership.mjs — W4-4B: tag every Day.ai org in master-account-list.csv
// with the right AM via the "AM Account List" custom property.
//
// Reads:
//   templates/master-account-list.csv         (source of truth: 178 rows)
//   templates/day-ai-workspace-ids.json       (property + option UUIDs)
//
// Writes (via worker HTTP path /v1/day-ai/write action=org-update-tags):
//   For each CSV row with a non-blank domain whose status ≠ domain_pending:
//     - search Day.ai for native_organization by domain
//     - if found: set AM Account List to the AM's option UUID
//     - if not found: log to templates/org-cleanup-reports/in-csv-not-in-dayai.csv
//
// Three side-effect reports under templates/org-cleanup-reports/:
//   needs-domain.csv            — CSV rows missing a domain (must be resolved manually)
//   in-csv-not-in-dayai.csv     — CSV rows whose domain has no Day.ai org match
//   ownerless-in-dayai.csv      — Day.ai orgs with AM Account List = null AND domain not in CSV
//
// Usage:
//   node scripts/apply-org-ownership.mjs --dry-run
//   node scripts/apply-org-ownership.mjs                    # live writes
//
// Idempotent — re-running with the same CSV is safe (org-update-tags accepts identical
// customProperty values without creating duplicates).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, canonicalDomain, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(REPO_ROOT, 'templates', 'master-account-list.csv');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');
const REPORTS_DIR = path.join(REPO_ROOT, 'templates', 'org-cleanup-reports');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPROVING_AM = 'harsha@ask-myra.ai'; // admin-scope cleanup; attribution to admin

// ---------- Load config ----------

if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);
if (!fs.existsSync(CSV_PATH)) fail(`Source-of-truth CSV not found: ${CSV_PATH}`);
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const amAccountList = ids?.customProperties?.amAccountList;
if (!amAccountList?.id || !amAccountList?.options) {
  fail('templates/day-ai-workspace-ids.json missing customProperties.amAccountList — re-run W4-4A.');
}

// Email-local-part → option-key mapping (e.g., satya@ask-myra.ai -> "satya")
function emailToOptionKey(email) {
  return String(email || '').toLowerCase().trim().split('@')[0];
}

function resolveOptionId(amEmail) {
  const key = emailToOptionKey(amEmail);
  const id = amAccountList.options[key];
  if (!id) throw new Error(`No AM Account List option for "${key}" (from ${amEmail}). Add via extend-am-options or addOptions.`);
  return id;
}

// ---------- Read CSV ----------

const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
console.log(`# apply-org-ownership ${DRY_RUN ? '(DRY RUN)' : ''}`);
console.log(`# CSV: ${rows.length} rows  workspace: ask-myra.ai\n`);

// CSV-side tally
const tally = {};
const needsDomain = []; // {am_email, am_name, account_name, notes}
const notInDayAi = []; // {am_email, am_name, account_name, domain}
const csvDomains = new Set();

let attempted = 0, ok = 0, miss = 0, errored = 0;

for (const [i, row] of rows.entries()) {
  const lineNo = i + 2;
  const amEmail = (row.am_email || '').trim();
  const amName = (row.am_name || '').trim();
  const accountName = (row.account_name || '').trim();
  const status = (row.status || '').trim().toLowerCase();
  const domain = canonicalDomain((row.domain || '').trim() || '');

  if (!amEmail) { console.warn(`  L${lineNo}: skipped — empty am_email`); continue; }
  tally[amName] ??= { needsDomain: 0, matched: 0, notInDayAi: 0, error: 0 };

  // Skip rows with blank domain or status=domain_pending — report only
  if (!domain || status === 'domain_pending') {
    needsDomain.push({ am_email: amEmail, am_name: amName, account_name: accountName, notes: row.notes || '' });
    tally[amName].needsDomain++;
    continue;
  }

  csvDomains.add(domain);
  let optionId;
  try {
    optionId = resolveOptionId(amEmail);
  } catch (e) {
    console.warn(`  L${lineNo} ${domain}: ${e.message}`);
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
        reasoning: `W4-4B cleanup: master-account-list.csv assigns ${domain} to ${amName} (${amEmail}).`,
      },
    ],
  };

  if (DRY_RUN) {
    console.log(`  L${lineNo} ${domain}: [dry] -> ${amName}  key=${idempotencyKey}`);
    tally[amName].matched++;
    ok++;
    continue;
  }

  const result = await callWorker('v1/day-ai/write', payload);
  // org-update-tags fails (not just returns "not found") if the org doesn't exist in Day.ai.
  // We treat any error containing "not found" or "does not exist" as a miss-in-dayai, not a hard failure.
  if (result?.ok ?? result?.success) {
    tally[amName].matched++;
    ok++;
  } else {
    const msg = safe(result);
    if (/not\s*found|does\s*not\s*exist|404/i.test(msg)) {
      notInDayAi.push({ am_email: amEmail, am_name: amName, account_name: accountName, domain });
      tally[amName].notInDayAi++;
      miss++;
    } else {
      console.warn(`  L${lineNo} ${domain}: FAIL — ${msg}`);
      tally[amName].error++;
      errored++;
    }
  }
}

// ---------- Reverse pass: find Day.ai orgs that are unowned + not in CSV ----------

const ownerlessInDayAi = [];
if (!DRY_RUN) {
  console.log('\n# Reverse pass: scanning Day.ai for ownerless orgs not in CSV...');
  // Page through native_organization, propertiesToReturn includes amAccountList propertyId
  let cursor = undefined;
  let scanned = 0;
  do {
    const queryPayload = {
      action: 'search-orgs-page', // not a real worker action; we use the read path differently
    };
    // Use callWorker on a direct read endpoint isn't exposed. Fall back to a single broad search.
    // The simpler path: callWorker doesn't expose search; do the reverse-pass via local MCP if available,
    // otherwise skip the reverse pass and log a note for the runbook to run separately.
    console.log('  Reverse pass needs Day.ai MCP read access (not exposed via worker /v1/day-ai/write).');
    console.log('  Run separately: scripts/find-ownerless-orgs.mjs (TODO) or use day.ai UI: "Unassigned — needs owner" view.');
    break;
  } while (cursor);
}

// ---------- Write reports ----------

writeCsv(path.join(REPORTS_DIR, 'needs-domain.csv'),
  ['am_email', 'am_name', 'account_name', 'notes'],
  needsDomain);
writeCsv(path.join(REPORTS_DIR, 'in-csv-not-in-dayai.csv'),
  ['am_email', 'am_name', 'account_name', 'domain'],
  notInDayAi);
writeCsv(path.join(REPORTS_DIR, 'ownerless-in-dayai.csv'),
  ['domain', 'name', 'createdAt'],
  ownerlessInDayAi);

// ---------- Summary ----------

console.log('\n# Per-AM tally');
for (const [am, t] of Object.entries(tally)) {
  console.log(`  ${am.padEnd(20)} matched=${t.matched}  needsDomain=${t.needsDomain}  notInDayAi=${t.notInDayAi}  error=${t.error}`);
}
console.log(`\n# Totals: attempted=${attempted}  ok=${ok}  miss=${miss}  error=${errored}`);
console.log(`# Reports written to: ${REPORTS_DIR}`);
console.log(`#   needs-domain.csv:        ${needsDomain.length} rows`);
console.log(`#   in-csv-not-in-dayai.csv: ${notInDayAi.length} rows`);
console.log(`#   ownerless-in-dayai.csv:  ${ownerlessInDayAi.length} rows (reverse-pass not yet implemented — see note above)`);

if (errored > 0) {
  console.log('\nRe-run the script — idempotency keys mean successful writes are skipped and failures retry cleanly.');
  process.exit(1);
}

// ---------- Helpers ----------

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

function writeCsv(filePath, columns, rows) {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c] ?? '')).join(',')).join('\n');
  fs.writeFileSync(filePath, body.length ? `${header}\n${body}\n` : `${header}\n`);
}
function csvCell(v) {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function safe(result) {
  if (!result) return '(no response)';
  if (typeof result === 'string') return result.slice(0, 200);
  return (result.error || result.message || JSON.stringify(result)).slice(0, 200);
}

function fail(msg) {
  process.stderr.write(`FAIL ${msg}\n`);
  process.exit(1);
}
