#!/usr/bin/env node
// Michelman E2E pilot orchestrator.
//
// Walks the 11 steps in the chat plan in dry-run mode, then asks the operator to flip --promote
// to production. Produces the single account-level unified receipt at the end.
//
// Usage:
//   node scripts/michelman-pilot.mjs                              # dry-run (no worker writes)
//   node scripts/michelman-pilot.mjs --promote                    # run against real worker
//   node scripts/michelman-pilot.mjs --am-package-dir /tmp/pilot  # override package root

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyEnv, loadLocalEnv } from './env-utils.mjs';
import { parseArgs } from './worker-client.mjs';

applyEnv(loadLocalEnv('.env.local'));

const args = parseArgs(process.argv);
const promote = args.promote === true || args.promote === 'true';
const amEmail = args.am ?? 'satya@ask-myra.ai';
const amPackageDir = args['am-package-dir'] ?? `/tmp/michelman-pilot`;
const seedPath = args.seed ?? path.resolve('templates/michelman-pilot.json');
const account = 'michelman.com';
const accountName = 'Michelman';

if (!fs.existsSync(seedPath)) {
  console.error(`Seed packet missing: ${seedPath}`);
  process.exit(1);
}

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
fs.mkdirSync(path.join(amPackageDir, amEmail, account), { recursive: true });
fs.writeFileSync(
  path.join(amPackageDir, amEmail, account, 'packet.json'),
  JSON.stringify(seed, null, 2),
);

console.log('# Michelman pilot');
console.log(`Mode: ${promote ? 'PRODUCTION' : 'dry-run'}`);
console.log(`AM: ${amEmail}`);
console.log(`Account: ${accountName} (${account})`);
console.log(`Package dir: ${amPackageDir}\n`);

const steps = [
  {
    n: 1,
    label: 'Resolve identity (domain-first)',
    cmd: ['worker:resolve-identity', '--', '--account', accountName, '--domain', account, '--owner-email', amEmail],
  },
  {
    n: 2,
    label: 'Freshsales evidence',
    cmd: ['worker:freshsales-evidence', '--', '--domain', account, '--account-name', accountName],
  },
  {
    n: 3,
    label: 'Apollo persona search (Recommended/Maybe/Hold)',
    cmd: ['worker:apollo-search', '--', '--domain', account, '--persona-pack', 'balanced', '--limit', '25'],
  },
  {
    n: 4,
    label: 'AM selects 2-3 contacts (simulated)',
    simulated: true,
    note: 'In real run, AM uses bulk-with-veto or numbered selection. Pilot uses synthetic IDs.',
  },
  {
    n: 5,
    label: 'Apollo enrichment for selected contacts',
    cmd: ['worker:apollo-enrich', '--', '--candidate-ids', 'CAND1,CAND2,CAND3', '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 6,
    label: 'Clearout verification of selected emails',
    cmd: ['worker:clearout-verify', '--', '--emails', 'verify1@michelman.com,verify2@michelman.com', '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 7,
    label: 'Day AI duplicate check',
    cmd: ['worker:dayai-write', '--', '--action', 'person-dedupe-check', '--canonical-domain', account, '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 8,
    label: 'Create or link Day AI Organization + Opportunity',
    cmd: ['worker:dayai-write', '--', '--action', 'opportunity-create', '--canonical-domain', account, '--stage', 'Researching', '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 9,
    label: 'Create approved Day AI People',
    cmd: ['worker:dayai-write', '--', '--action', 'person-create', '--canonical-domain', account, '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 10,
    label: 'Create cadence Actions + email Drafts',
    cmd: ['worker:dayai-write', '--', '--action', 'action-create', '--canonical-domain', account, '--channel', 'email', '--summary', 'Research-led opener', '--approving-am', amEmail],
    skipDryRun: true,
  },
  {
    n: 11,
    label: 'Produce single account-level receipt',
    cmd: ['worker:receipt', '--', '--account', account, '--am-package-dir', amPackageDir, '--approving-am', amEmail],
  },
];

const results = [];

for (const step of steps) {
  console.log(`Step ${step.n}: ${step.label}`);

  if (step.simulated) {
    console.log(`  ~ simulated ~  ${step.note}\n`);
    results.push({ step: step.n, label: step.label, status: 'simulated' });
    continue;
  }

  if (!promote && step.skipDryRun) {
    console.log(`  ~ skipped in dry-run (would consume credits or write to Day AI) ~\n`);
    results.push({ step: step.n, label: step.label, status: 'skipped_dry_run' });
    continue;
  }

  const out = runNpm(step.cmd);
  results.push({
    step: step.n,
    label: step.label,
    status: out.code === 0 ? 'ok' : 'failed',
    stdout: out.stdout.slice(0, 800),
    stderr: out.stderr.slice(0, 400),
    code: out.code,
  });
  console.log(`  exit=${out.code}`);
  if (out.code !== 0) {
    console.log(`  STDERR: ${out.stderr.slice(0, 300)}`);
    console.log('\nHard block: stopping pilot. Fix and re-run.\n');
    writeSummary({ results, promote, amEmail, account });
    process.exit(1);
  }
  console.log('');
}

writeSummary({ results, promote, amEmail, account });

console.log(promote ? 'Pilot complete (PRODUCTION).' : 'Pilot complete (dry-run). Re-run with --promote when ready.');

function runNpm(cmd) {
  const result = spawnSync('npm', ['run', ...cmd], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 0,
  };
}

function writeSummary({ results, promote, amEmail, account }) {
  const summaryPath = path.join(amPackageDir, amEmail, account, 'pilot-summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        promote,
        amEmail,
        account,
        steps: results,
      },
      null,
      2,
    ),
  );
  console.log(`\nPilot summary written to ${summaryPath}`);
}
