#!/usr/bin/env node
// /v1/apollo/enrich — selective Apollo enrichment ONLY for AM-selected candidates.
// Consumes Apollo credits; AM approval and approving-am email required.

import {
  callWorker,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const candidateIdsRaw = requireArg(args, 'candidate-ids');
const candidateIds = String(candidateIdsRaw)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const approvingAm = requireArg(args, 'approving-am');

if (candidateIds.length === 0) {
  process.stderr.write('No candidate IDs provided. Pass --candidate-ids "id1,id2,..."\n');
  process.exit(1);
}

const result = await callWorker('v1/apollo/enrich', {
  candidateIds,
  approvingAm,
});

exitForResult(result);
