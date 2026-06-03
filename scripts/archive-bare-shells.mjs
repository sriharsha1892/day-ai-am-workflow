#!/usr/bin/env node
// archive-bare-shells.mjs — W4-4D: archive Day.ai orgs that are "bare shells"
// (no contacts, no opportunities, no context, no warmth, no AI description).
//
// Reads:
//   templates/day-ai-workspace-ids.json
//
// Detection profile (all conditions must be true):
//   - No member relationship to any native_contact
//   - No related relationship to any native_opportunity
//   - No context page attached
//   - status/warmth = 0 (or null)
//   - aiDescription is empty
//
// Detection runs against Day.ai MCP via the worker's read endpoint. Since the worker doesn't
// currently expose a "find-bare-shell-orgs" tool, this script issues the raw MCP read calls
// through the worker's /v1/day-ai/write path (action=admin-search-orgs is NOT exposed — see note)
// OR it falls back to local Day.ai MCP if mcp__day-ai__search_objects is available.
//
// In practice: this script EXPECTS the operator to run it from a session where Day.ai MCP is
// directly accessible (e.g., via Claude with the day-ai MCP connector). If not available, it
// writes its candidate list to templates/org-cleanup-reports/bare-shell-candidates.csv from the
// user's manual export. For a fully scripted run, expand the worker to expose admin-search.
//
// For W4 v1, this script is implemented as an INPUT FILE based archiver:
//   1. Operator runs the audit query in Day.ai (via Claude MCP or UI) and exports
//      candidate domains to templates/org-cleanup-reports/bare-shell-candidates.csv
//      (one column: `domain`).
//   2. Run this script with --dry-run to verify the list.
//   3. Run with --apply to set Account Status = Archive on each.
//
// Usage:
//   node scripts/archive-bare-shells.mjs --dry-run
//   node scripts/archive-bare-shells.mjs --apply

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, canonicalDomain, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');
const CANDIDATES_CSV = process.argv.find((a) => a.startsWith('--csv='))?.split('=')[1]
  ? path.resolve(process.argv.find((a) => a.startsWith('--csv=')).split('=')[1])
  : path.join(REPO_ROOT, 'templates', 'org-cleanup-reports', 'bare-shell-candidates.csv');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPLY = Boolean(args.apply);
const APPROVING_AM = 'harsha@ask-myra.ai';

if (!DRY_RUN && !APPLY) {
  fail('Pass --dry-run (preview the list) or --apply (set Account Status=Archive on each).');
}

if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);
if (!fs.existsSync(CANDIDATES_CSV)) {
  fail(
    `Candidate list not found: ${CANDIDATES_CSV}\n` +
    `Generate it first (Day.ai MCP audit): find orgs where member relationship is empty AND\n` +
    `related opportunity is empty AND context relationship is empty AND status/warmth=0 AND\n` +
    `aiDescription is null. Export domains as a one-column CSV with header "domain".`,
  );
}

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const accountStatus = ids?.customProperties?.accountStatus;
if (!accountStatus?.options?.archive) fail('workspace-ids.json missing customProperties.accountStatus.options.archive');

const rows = parseCsv(fs.readFileSync(CANDIDATES_CSV, 'utf8'));
const domains = rows.map((r) => canonicalDomain(r.domain)).filter(Boolean);

console.log(`# archive-bare-shells ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);
console.log(`# Candidates: ${domains.length} orgs from ${path.basename(CANDIDATES_CSV)}\n`);

let attempted = 0, ok = 0, errored = 0;

for (const [i, domain] of domains.entries()) {
  attempted++;
  const idempotencyKey = buildIdempotencyKey({
    action: 'org-update-tags',
    canonicalDomain: domain,
    extra: 'status:archive',
  });
  const payload = {
    action: 'org-update-tags',
    approvingAm: APPROVING_AM,
    canonicalDomain: domain,
    idempotencyKey,
    retry: false,
    customProperties: [
      {
        propertyId: accountStatus.id,
        value: accountStatus.options.archive,
        reasoning: 'W4-4D cleanup: bare-shell org (no contacts, opps, context, warmth, or aiDescription).',
      },
    ],
  };

  if (DRY_RUN) {
    console.log(`  ${(i + 1).toString().padStart(3, ' ')}/${domains.length}  ${domain}  [dry] -> Archive  key=${idempotencyKey}`);
    ok++;
    continue;
  }

  const result = await callWorker('v1/day-ai/write', payload);
  if (result?.ok ?? result?.success) {
    console.log(`  ${(i + 1).toString().padStart(3, ' ')}/${domains.length}  ${domain}  -> Archive`);
    ok++;
  } else {
    console.warn(`  ${(i + 1).toString().padStart(3, ' ')}/${domains.length}  ${domain}  FAIL — ${safe(result)}`);
    errored++;
  }
}

console.log(`\n# Totals: attempted=${attempted}  ok=${ok}  error=${errored}`);
if (errored > 0) process.exit(1);

// ---------- Helpers ----------

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    header.forEach((key, idx) => { row[key] = (cells[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
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
