#!/usr/bin/env node
// archive-orphan-contacts.mjs — W4-4H: archive Day.ai contacts that are orphans
// (no org link, no opp link, no recent gmail thread, no recent meeting/calendar event).
//
// Same input-file pattern as archive-bare-shells.mjs (W4-4D):
//   templates/org-cleanup-reports/orphan-contact-candidates.csv (one column: `email`)
//
// Generate the candidate list by running a Day.ai MCP audit:
//   For each native_contact, check:
//     - member relationship to any native_organization is empty
//     - related relationship to any native_opportunity is empty
//     - no native_gmailthread referencing the contact's email in last 90 days
//     - no native_meetingrecording / native_calendarevent referencing contact in last 90 days
//
// Usage:
//   node scripts/archive-orphan-contacts.mjs --dry-run
//   node scripts/archive-orphan-contacts.mjs --apply

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');
const CANDIDATES_CSV = path.join(REPO_ROOT, 'templates', 'org-cleanup-reports', 'orphan-contact-candidates.csv');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPLY = Boolean(args.apply);
const APPROVING_AM = 'harsha@ask-myra.ai';

if (!DRY_RUN && !APPLY) {
  fail('Pass --dry-run (preview the list) or --apply (set Contact Status=Archive on each).');
}

if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);
if (!fs.existsSync(CANDIDATES_CSV)) {
  fail(
    `Candidate list not found: ${CANDIDATES_CSV}\n` +
    `Generate it first (Day.ai MCP audit): find contacts where member relationship to org is empty\n` +
    `AND related opp relationship is empty AND no gmail thread in last 90 days AND no meeting/calendar\n` +
    `event in last 90 days. Export emails as a one-column CSV with header "email".`,
  );
}

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const contactStatus = ids?.customProperties?.contactStatus;
if (!contactStatus?.options?.archive) fail('workspace-ids.json missing customProperties.contactStatus.options.archive');

const rows = parseCsv(fs.readFileSync(CANDIDATES_CSV, 'utf8'));
const emails = rows.map((r) => (r.email || '').trim().toLowerCase()).filter(Boolean);

console.log(`# archive-orphan-contacts ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);
console.log(`# Candidates: ${emails.length} contacts from ${path.basename(CANDIDATES_CSV)}\n`);

let attempted = 0, ok = 0, errored = 0;

for (const [i, email] of emails.entries()) {
  attempted++;
  const idempotencyKey = buildIdempotencyKey({
    action: 'contact-update-tags',
    canonicalDomain: email, // contact key is email; we slot it into the same buildIdempotencyKey shape
    extra: 'status:archive',
  });
  const payload = {
    action: 'contact-update-tags',
    approvingAm: APPROVING_AM,
    canonicalDomain: email.split('@')[1] || email, // worker dispatcher expects canonicalDomain; pass email's domain
    contactEmail: email,
    idempotencyKey,
    retry: false,
    customProperties: [
      {
        propertyId: contactStatus.id,
        value: contactStatus.options.archive,
        reasoning: 'W4-4H cleanup: orphan contact (no org, no opp, no recent thread/meeting in 90 days).',
      },
    ],
  };

  if (DRY_RUN) {
    console.log(`  ${(i + 1).toString().padStart(4, ' ')}/${emails.length}  ${email}  [dry] -> Archive  key=${idempotencyKey}`);
    ok++;
    continue;
  }

  const result = await callWorker('v1/day-ai/write', payload);
  if (result?.ok ?? result?.success) {
    console.log(`  ${(i + 1).toString().padStart(4, ' ')}/${emails.length}  ${email}  -> Archive`);
    ok++;
  } else {
    console.warn(`  ${(i + 1).toString().padStart(4, ' ')}/${emails.length}  ${email}  FAIL — ${safe(result)}`);
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
