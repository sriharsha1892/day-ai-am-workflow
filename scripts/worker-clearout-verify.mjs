#!/usr/bin/env node
// /v1/clearout/verify — selective Clearout verification on AM-selected emails.
// Consumes Clearout credits; AM approval and approving-am email required.

import {
  callWorker,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const emailsRaw = requireArg(args, 'emails');
const emails = String(emailsRaw)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const approvingAm = requireArg(args, 'approving-am');
const reason = args.reason;
const accountName = args['account-name'];
const domain = args.domain;

if (emails.length === 0) {
  process.stderr.write('No emails provided. Pass --emails "a@x.com,b@y.com,..."\n');
  process.exit(1);
}

const result = await callWorker('v1/clearout/verify', {
  emails,
  approvingAm,
  reason,
  accountName,
  domain,
});

exitForResult(result);
