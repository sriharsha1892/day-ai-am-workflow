#!/usr/bin/env node
// backfill-accounts.mjs — Two-pass Day AI backfill for historical AM books.
//
// Pass A: ensure every account each AM has touched exists as a native_organization.
// Pass B: for in-funnel rows (engagement != researched-only), ensure a native_opportunity
//          exists in the right pipeline + stage with the AM as owner.
//
// Reads:
//   - templates/day-ai-workspace-ids.json — pipeline + stage IDs (must be populated)
//   - templates/am-backfill-*.csv          — per-AM books (one per AM)
//
// CSV format (header required):
//   am,domain,engagement,first_touch_date,last_touch_date,notes
//
// engagement enum:
//   researched-only  -> Pass A only (org, no opp)
//   cold             -> New Business / Connection
//   in-conversation  -> New Business / Discovery
//   trial-active     -> New Business / Trial Active
//   demo             -> New Business / Demo / Pilot
//   negotiation      -> New Business / Negotiation
//   closed-won       -> New Business / Closed Won
//   closed-lost      -> New Business / Closed Lost
//   churned          -> Expansion    / Closed Lost (churned variant)
//
// Idempotency: org keys are domain-scoped, opp keys are (domain × AM) scoped.
// Safe to re-run; the worker rejects duplicate creates with the same key.
//
// Limitation: this backfill does NOT set the Pitched Since or AM Owner Source custom
// properties on opportunities at create-time, because the worker's opportunity-create
// handler does not yet pass customProperties through to the MCP call. Those values
// will be filled in by Day.ai's AI auto-enrichment (both properties are aiManaged:true
// and the AI reads emails/meetings) once Task #11 extends the handler. If you need
// them set deterministically from the CSV, re-run a patch script after the handler
// extension lands.
//
// Usage:
//   node scripts/backfill-accounts.mjs --dry-run            # preview only
//   node scripts/backfill-accounts.mjs --am=satya           # one AM
//   node scripts/backfill-accounts.mjs --csv=templates/am-backfill-satya.csv
//   node scripts/backfill-accounts.mjs                      # all AMs, live writes
//
// Required env: WORKER_BASE_URL (or set up via worker-client.mjs's resolution)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildIdempotencyKey,
  callWorker,
  canonicalDomain,
  parseArgs,
} from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');

const AM_EMAILS = {
  harsha: 'harsha@ask-myra.ai',
  satya: 'satya@ask-myra.ai',
  satish: 'satish@ask-myra.ai',
  sudeshana: 'sudeshana@ask-myra.ai',
  kirandeep: 'kirandeep@ask-myra.ai',
  vijay: 'vijay@ask-myra.ai',
  nikita: 'nikita@ask-myra.ai',
};

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const ONLY_AM = args.am ? String(args.am).toLowerCase() : null;
const SPECIFIC_CSV = args.csv ? String(args.csv) : null;

// ---------- Load workspace IDs ----------

if (!fs.existsSync(IDS_PATH)) {
  fail(`Workspace IDs file not found: ${IDS_PATH}`);
}
const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));

const newBusiness = ids?.pipelines?.newBusinessOutbound ?? {};
const expansion = ids?.pipelines?.expansion ?? {};

if (!newBusiness.id || !expansion.id) {
  fail(
    'Pipeline IDs are not populated in templates/day-ai-workspace-ids.json. ' +
    'Create the two pipelines in Day.ai UI first (New Business – Outbound + Expansion), ' +
    'then re-run the workspace-id sync.',
  );
}

const requiredStages = {
  'new-business.connection':      newBusiness.stages?.connection,
  'new-business.discovery':       newBusiness.stages?.discovery,
  'new-business.demoWalkthrough': newBusiness.stages?.demoWalkthrough,
  'new-business.trialActive':     newBusiness.stages?.trialActive,
  'new-business.negotiation':     newBusiness.stages?.negotiation,
  'new-business.closedWon':       newBusiness.stages?.closedWon,
  'new-business.closedLost':      newBusiness.stages?.closedLost,
  'expansion.churned':            expansion.stages?.churned,
};
const missingStages = Object.entries(requiredStages).filter(([, v]) => !v).map(([k]) => k);
if (missingStages.length) {
  fail(`Stage IDs missing in workspace-ids.json: ${missingStages.join(', ')}`);
}

// NB: New Business – Outbound stage order is Connection → Discovery → Demo/Walkthrough → Trial Active
// → Negotiation → Closed Won/Lost. (Demo BEFORE Trial — enterprise MI/Strategy selling motion.)
// CSV `engagement` column maps directly to the stage the account is currently at.
const ENGAGEMENT_TO_STAGE = {
  cold:              { pipelineId: newBusiness.id, stageId: newBusiness.stages.connection,      label: 'Connection' },
  'in-conversation': { pipelineId: newBusiness.id, stageId: newBusiness.stages.discovery,       label: 'Discovery' },
  demo:              { pipelineId: newBusiness.id, stageId: newBusiness.stages.demoWalkthrough, label: 'Demo / Walkthrough' },
  'trial-active':    { pipelineId: newBusiness.id, stageId: newBusiness.stages.trialActive,     label: 'Trial Active' },
  negotiation:       { pipelineId: newBusiness.id, stageId: newBusiness.stages.negotiation,     label: 'Negotiation' },
  'closed-won':      { pipelineId: newBusiness.id, stageId: newBusiness.stages.closedWon,       label: 'Closed Won' },
  'closed-lost':     { pipelineId: newBusiness.id, stageId: newBusiness.stages.closedLost,      label: 'Closed Lost' },
  churned:           { pipelineId: expansion.id,   stageId: expansion.stages.churned,           label: 'Churned (expansion)' },
};

const VALID_ENGAGEMENTS = new Set([...Object.keys(ENGAGEMENT_TO_STAGE), 'researched-only']);

// ---------- Discover CSVs ----------

const csvPaths = SPECIFIC_CSV
  ? [path.resolve(SPECIFIC_CSV)]
  : fs.readdirSync(TEMPLATES_DIR)
      .filter((f) => /^am-backfill-[a-z]+\.csv$/i.test(f))
      .map((f) => path.join(TEMPLATES_DIR, f));

if (!csvPaths.length) {
  fail(`No backfill CSVs found. Expected templates/am-backfill-<name>.csv files (or pass --csv=path).`);
}

const filteredCsvs = ONLY_AM
  ? csvPaths.filter((p) => path.basename(p, '.csv').toLowerCase().endsWith(ONLY_AM))
  : csvPaths;

if (!filteredCsvs.length) {
  fail(`--am=${ONLY_AM} did not match any of: ${csvPaths.map((p) => path.basename(p)).join(', ')}`);
}

console.log(`# backfill-accounts ${DRY_RUN ? '(DRY RUN)' : ''}`);
console.log(`# CSVs: ${filteredCsvs.length}  pipelines: New Business + Expansion  workspace: ask-myra.ai\n`);

// ---------- Execute ----------

let grandOrgsAttempted = 0, grandOrgsOk = 0, grandOrgsFail = 0;
let grandOppsAttempted = 0, grandOppsOk = 0, grandOppsFail = 0;

for (const csvPath of filteredCsvs) {
  const amName = inferAmFromFilename(csvPath);
  const amEmail = AM_EMAILS[amName];
  if (!amEmail) {
    console.warn(`SKIP ${path.basename(csvPath)}: unknown AM "${amName}". Expected one of: ${Object.keys(AM_EMAILS).join(', ')}.\n`);
    continue;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  console.log(`## ${amName} (${amEmail}) — ${rows.length} rows from ${path.basename(csvPath)}`);

  let orgsAttempted = 0, orgsOk = 0, orgsFail = 0;
  let oppsAttempted = 0, oppsOk = 0, oppsFail = 0;

  for (const [i, row] of rows.entries()) {
    const lineNo = i + 2; // CSV header is line 1
    const domain = canonicalDomain(row.domain || '');
    if (!domain) {
      console.warn(`  L${lineNo}: skipped — empty/invalid domain`);
      continue;
    }
    const engagement = (row.engagement || '').trim().toLowerCase();
    if (!VALID_ENGAGEMENTS.has(engagement)) {
      console.warn(`  L${lineNo} ${domain}: skipped — invalid engagement "${row.engagement}"`);
      continue;
    }

    // -------- Pass A: org-create --------
    orgsAttempted++;
    const orgKey = buildIdempotencyKey({
      action: 'backfill-org',
      canonicalDomain: domain,
      extra: '',
    });
    const orgPayload = {
      action: 'org-create',
      approvingAm: amEmail,
      canonicalDomain: domain,
      idempotencyKey: orgKey,
      retry: false,
      accountName: domain, // worker will fall back to domain if no name available
    };

    if (DRY_RUN) {
      console.log(`  L${lineNo} ${domain}: [dry] org-create  key=${orgKey}`);
      orgsOk++;
    } else {
      const result = await callWorker('v1/day-ai/write', orgPayload);
      if (result?.ok ?? result?.success) {
        orgsOk++;
      } else {
        orgsFail++;
        console.warn(`  L${lineNo} ${domain}: org-create FAIL — ${safe(result)}`);
        continue; // don't try to create opp without org
      }
    }

    // -------- Pass B: opportunity-create (skip researched-only) --------
    if (engagement === 'researched-only') continue;

    const stage = ENGAGEMENT_TO_STAGE[engagement];
    oppsAttempted++;
    const oppKey = buildIdempotencyKey({
      action: 'backfill-opp',
      canonicalDomain: domain,
      extra: amEmail,
    });
    const oppPayload = {
      action: 'opportunity-create',
      approvingAm: amEmail,
      canonicalDomain: domain,
      idempotencyKey: oppKey,
      retry: false,
      title: `${domainToOrgName(domain)} — ${pipelineNameFor(stage.pipelineId)}`,
      stageId: stage.stageId,
      ownerEmail: amEmail,
      // NOTE: customProperties (Pitched Since, AM Owner Source) intentionally omitted
      // — worker handler doesn't pass them through yet. See script header.
    };

    if (DRY_RUN) {
      console.log(`  L${lineNo} ${domain}: [dry] opp-create   stage=${stage.label}  key=${oppKey}`);
      oppsOk++;
    } else {
      const result = await callWorker('v1/day-ai/write', oppPayload);
      if (result?.ok ?? result?.success) {
        oppsOk++;
      } else {
        oppsFail++;
        console.warn(`  L${lineNo} ${domain}: opp-create FAIL — ${safe(result)}`);
      }
    }
  }

  console.log(
    `   = ${amName}: ${orgsOk}/${orgsAttempted} orgs OK (${orgsFail} fail), ` +
    `${oppsOk}/${oppsAttempted} opps OK (${oppsFail} fail)\n`,
  );

  grandOrgsAttempted += orgsAttempted; grandOrgsOk += orgsOk; grandOrgsFail += orgsFail;
  grandOppsAttempted += oppsAttempted; grandOppsOk += oppsOk; grandOppsFail += oppsFail;
}

console.log('# TOTAL');
console.log(`  Orgs: ${grandOrgsOk}/${grandOrgsAttempted} OK, ${grandOrgsFail} fail`);
console.log(`  Opps: ${grandOppsOk}/${grandOppsAttempted} OK, ${grandOppsFail} fail`);

if (grandOrgsFail + grandOppsFail > 0) {
  console.log('\nRe-run the script — idempotency keys mean successful writes are skipped and failures retry cleanly.');
  process.exit(1);
}

// ---------- Helpers ----------

function inferAmFromFilename(filePath) {
  const m = /^am-backfill-([a-z]+)\.csv$/i.exec(path.basename(filePath));
  return m ? m[1].toLowerCase() : '';
}

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

// Minimal CSV splitter: handles double-quoted fields with commas inside.
// Not a full RFC 4180 parser, but adequate for AM books with simple notes.
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

function domainToOrgName(domain) {
  // "acme.com" -> "Acme"; best-effort, used only as a fallback opp title.
  const base = String(domain).split('.')[0] || domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function pipelineNameFor(pipelineId) {
  if (pipelineId === newBusiness.id) return 'myRA New Business';
  if (pipelineId === expansion.id) return 'myRA Expansion';
  return 'myRA';
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
