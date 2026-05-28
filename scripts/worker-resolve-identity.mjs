#!/usr/bin/env node
// /v1/identity/resolve — runs the canonical 6-tier org resolution decision through the hosted worker.
// Invoked by /org-resolution and /account-intake.

import {
  buildIdempotencyKey,
  callWorker,
  canonicalDomain,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const accountName = requireArg(args, 'account');
const domain = canonicalDomain(requireArg(args, 'domain'));
const ownerEmail = args['owner-email'];
const aliases = csv(args.aliases);
const parentCompany = args['parent-company'];
const freshsalesAccountIds = csv(args['freshsales-account-ids']);
const apolloOrganizationId = args['apollo-organization-id'];

const idempotencyKey = buildIdempotencyKey({
  action: 'resolve-identity',
  canonicalDomain: domain,
});

const result = await callWorker('v1/identity/resolve', {
  accountName,
  canonicalDomain: domain,
  ownerEmail,
  aliases,
  parentCompany,
  freshsalesAccountIds,
  apolloOrganizationId,
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
