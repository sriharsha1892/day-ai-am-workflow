#!/usr/bin/env node
// /v1/freshsales/evidence — pulls existing CRM evidence for an account through the hosted worker.
// Read-only against Freshsales (worker enforces).

import {
  buildIdempotencyKey,
  callWorker,
  canonicalDomain,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const domain = canonicalDomain(requireArg(args, 'domain'));
const accountName = args['account-name'];
const aliases = csv(args.aliases);
const includeConversations = args['include-conversations'] !== 'false';
const includeNotes = args['include-notes'] !== 'false';
const maxRecords = args['max-records'] ? Number(args['max-records']) : 100;

const idempotencyKey = buildIdempotencyKey({
  action: 'freshsales-evidence',
  canonicalDomain: domain,
});

const result = await callWorker('v1/freshsales/evidence', {
  canonicalDomain: domain,
  accountName,
  aliases,
  includeConversations,
  includeNotes,
  maxRecords,
  idempotencyKey,
});

exitForResult(result);

function csv(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
