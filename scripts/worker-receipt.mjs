#!/usr/bin/env node
// /v1/receipt/account — produces the unified account-level receipt.
// Receipt is written both locally (am-package/<am>/<account>/receipts/<ts>.json) and to Day AI as a context page.
// Conforms to workflow/schemas/account-receipt.schema.json.

import fs from 'node:fs';
import path from 'node:path';
import {
  callWorker,
  canonicalDomain,
  exitForResult,
  parseArgs,
  requireArg,
} from './worker-client.mjs';

const args = parseArgs(process.argv);

const account = canonicalDomain(requireArg(args, 'account'));
const includeExpanded = args['include-expanded'] === 'true';
const amPackageDir = args['am-package-dir'] ?? process.env.AM_PACKAGE_DIR;
const approvingAm = args['approving-am'] ?? process.env.AM_EMAIL;

const result = await callWorker('v1/receipt/account', {
  canonicalDomain: account,
  includeExpanded,
  approvingAm,
});

if (result.ok && result.body && amPackageDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const receiptsDir = path.join(amPackageDir, account, 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });
  const localPath = path.join(receiptsDir, `${timestamp}.json`);
  fs.writeFileSync(localPath, JSON.stringify(result.body, null, 2));
  result.body.persistence = {
    ...(result.body.persistence ?? {}),
    localPath,
  };
}

exitForResult(result);
