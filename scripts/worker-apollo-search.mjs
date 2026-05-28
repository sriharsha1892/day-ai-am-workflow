#!/usr/bin/env node
// /v1/apollo/search — net-new contact sourcing via Apollo, tiered Recommended/Maybe/Hold.
// Free against Apollo metadata; enrich and verify are separate scripts.

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
const personaPack = args['persona-pack'] ?? 'balanced';
const targetRoleBuckets = csv(args['target-role-buckets']);
const titleKeywords = csv(args['title-keywords']);
const limit = args.limit ? Number(args.limit) : 25;

const idempotencyKey = buildIdempotencyKey({
  action: 'apollo-search',
  canonicalDomain: domain,
  extra: personaPack,
});

const result = await callWorker('v1/apollo/search', {
  canonicalDomain: domain,
  personaPack,
  targetRoleBuckets,
  titleKeywords,
  limit,
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
