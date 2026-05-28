#!/usr/bin/env node
// /v1/day-ai/write — production Day AI writes via the integration user.
// Verb-driven: org-link | org-create | opportunity-create | person-dedupe-check | person-create
//             | action-create | draft-create | review-context.
// Every write requires --approving-am. Idempotency key reused on retry; worker rejects duplicate creation.

import fs from 'node:fs';
import {
  buildIdempotencyKey,
  callWorker,
  canonicalDomain,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const action = requireArg(args, 'action');
const approvingAm = requireArg(args, 'approving-am');
const domain = args['canonical-domain'] ? canonicalDomain(args['canonical-domain']) : undefined;

const validActions = new Set([
  'org-link',
  'org-create',
  'opportunity-create',
  'person-dedupe-check',
  'person-create',
  'action-create',
  'draft-create',
  'review-context',
]);

if (!validActions.has(action)) {
  process.stderr.write(`Unknown --action "${action}". Allowed: ${[...validActions].join(', ')}\n`);
  process.exit(1);
}

const retryKey = args['retry-idempotency-key'];
const idempotencyKey =
  retryKey || args['idempotency-key'] ||
  buildIdempotencyKey({
    action,
    canonicalDomain: domain,
    extra: args['contact-email'] || args['subject'] || '',
  });

const payload = {
  action,
  approvingAm,
  canonicalDomain: domain,
  idempotencyKey,
  retry: Boolean(retryKey),
};

// Pass-through optional fields the worker may use depending on action.
for (const key of [
  'stage',
  'contact-email',
  'channel',
  'due-at',
  'summary',
  'branch-if',
  'linked-action-id',
  'subject',
  'body-html',
  'tone',
  'cta',
  'length',
  'persona-pack',
  'channel-pack',
  'reason',
  'review-task',
]) {
  if (args[key] !== undefined && args[key] !== true) {
    payload[toCamel(key)] = args[key];
  }
}

if (args.candidates) payload.candidates = readJson(args.candidates);
if (args.candidate) payload.candidate = readJson(args.candidate);
if (args.packet) payload.packet = readJson(args.packet);

const result = await callWorker('v1/day-ai/write', payload);

exitForResult(result);

function toCamel(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function readJson(filePath) {
  if (!filePath || filePath === true) return undefined;
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Could not parse ${filePath}: ${error.message}\n`);
    process.exit(1);
  }
}
