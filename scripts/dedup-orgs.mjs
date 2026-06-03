#!/usr/bin/env node
// dedup-orgs.mjs — W4-4C: soft-dedup Day.ai orgs by archiving aliases.
//
// IMPORTANT LIMITATION: Day.ai's create_or_update_relationship MCP tool does NOT support
// org-to-org `canonical`/`alias` relationships (only person→org, person→meeting,
// opp→meeting, and context-note links). True relationship-based dedup is not programmatically
// writable. This script uses the next-best approach: archive the alias domains via
// Account Status = Archive. The canonical stays Active. View filters hide the aliases.
//
// User-visible result is equivalent: one entry per real org appears in default views.
// True canonical/alias linkage (if Day.ai needs it for AI inference) requires manual UI work,
// documented in the org-hygiene runbook as a follow-up step.
//
// Reads:
//   templates/org-dedup-clusters.json (canonical + aliases per cluster)
//   templates/day-ai-workspace-ids.json (Archive option UUID)
//
// Writes via /v1/day-ai/write action=org-update-tags: for each alias, sets
// Account Status = Archive. Canonical is untouched. Idempotent.
//
// Usage:
//   node scripts/dedup-orgs.mjs --dry-run
//   node scripts/dedup-orgs.mjs --apply

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, canonicalDomain, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');
const CLUSTERS_PATH = path.join(REPO_ROOT, 'templates', 'org-dedup-clusters.json');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPLY = Boolean(args.apply);
const APPROVING_AM = 'harsha@ask-myra.ai';

if (!DRY_RUN && !APPLY) {
  fail('Pass --dry-run (preview) or --apply (set Account Status=Archive on each alias).');
}

if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);
if (!fs.existsSync(CLUSTERS_PATH)) fail(`Dedup clusters file not found: ${CLUSTERS_PATH}`);

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const accountStatus = ids?.customProperties?.accountStatus;
if (!accountStatus?.options?.archive) fail('workspace-ids.json missing customProperties.accountStatus.options.archive');

const { clusters } = JSON.parse(fs.readFileSync(CLUSTERS_PATH, 'utf8'));
if (!Array.isArray(clusters) || !clusters.length) fail('templates/org-dedup-clusters.json has no clusters');

console.log(`# dedup-orgs ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);
console.log(`# Clusters: ${clusters.length}  total aliases to archive: ${clusters.reduce((n, c) => n + (c.aliases?.length ?? 0), 0)}\n`);

let attempted = 0, ok = 0, errored = 0;

for (const [ci, cluster] of clusters.entries()) {
  const canonical = canonicalDomain(cluster.canonical);
  const aliases = (cluster.aliases || []).map((d) => canonicalDomain(d)).filter(Boolean);
  if (!canonical || !aliases.length) {
    console.warn(`  cluster #${ci + 1}: skipped — missing canonical or empty aliases`);
    continue;
  }

  console.log(`\n## cluster #${ci + 1}: canonical=${canonical}  (${cluster.reason || 'no reason recorded'})`);

  for (const alias of aliases) {
    attempted++;
    const idempotencyKey = buildIdempotencyKey({
      action: 'org-update-tags',
      canonicalDomain: alias,
      extra: `dedup-alias-of:${canonical}`,
    });
    const payload = {
      action: 'org-update-tags',
      approvingAm: APPROVING_AM,
      canonicalDomain: alias,
      idempotencyKey,
      retry: false,
      customProperties: [
        {
          propertyId: accountStatus.id,
          value: accountStatus.options.archive,
          reasoning: `W4-4C dedup: alias of canonical ${canonical} (${cluster.reason || 'no reason recorded'}).`,
        },
      ],
    };

    if (DRY_RUN) {
      console.log(`    ${alias.padEnd(40)} [dry] -> Archive (alias of ${canonical})  key=${idempotencyKey}`);
      ok++;
      continue;
    }

    const result = await callWorker('v1/day-ai/write', payload);
    if (result?.ok ?? result?.success) {
      console.log(`    ${alias.padEnd(40)} -> Archive`);
      ok++;
    } else {
      console.warn(`    ${alias.padEnd(40)} FAIL — ${safe(result)}`);
      errored++;
    }
  }
}

console.log(`\n# Totals: attempted=${attempted}  ok=${ok}  error=${errored}`);
console.log('\n# Note: Day.ai canonical/alias relationships are NOT writable via MCP.');
console.log('#       For TRUE relationship-based dedup (if needed for AI inference), use the Day.ai UI:');
console.log('#       open each alias org, find the "merge into canonical" or equivalent action.');
console.log('#       This script handles the view-level dedup via Account Status = Archive only.');

if (errored > 0) process.exit(1);

// ---------- Helpers ----------

function safe(result) {
  if (!result) return '(no response)';
  if (typeof result === 'string') return result.slice(0, 200);
  return (result.error || result.message || JSON.stringify(result)).slice(0, 200);
}

function fail(msg) {
  process.stderr.write(`FAIL ${msg}\n`);
  process.exit(1);
}
