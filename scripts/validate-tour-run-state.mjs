#!/usr/bin/env node
// Validates tour-run-state.json files against workflow/schemas/tour-run-state.schema.json.
// Walks am-package/* for any tour-run-state.json files and a tour-run-state-index.json per AM.
// No external schema-validator dep — uses a tiny presence + enum check sufficient for our shape.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const root = args[0] ?? process.env.AM_PACKAGE_DIR ?? 'am-package';

const VALID_RUN_STATUS = new Set([
  'dry_run_complete',
  'production_pending_approval',
  'production_running',
  'production_saved',
  'pending_sync',
  'blocked',
]);

const VALID_STATION_STATUS = new Set([
  'not_started',
  'in_progress',
  'complete',
  'skipped',
  'blocked',
]);

const errors = [];
let stateCount = 0;
let indexCount = 0;

if (!fs.existsSync(root)) {
  console.log(`OK: ${root} does not exist yet; no tour-run-state files to validate.`);
  process.exit(0);
}

for (const amEntry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!amEntry.isDirectory()) continue;
  const amDir = path.join(root, amEntry.name);

  const indexPath = path.join(amDir, 'tour-run-state-index.json');
  if (fs.existsSync(indexPath)) {
    indexCount += 1;
    validateIndex(indexPath);
  }

  for (const inner of fs.readdirSync(amDir, { withFileTypes: true })) {
    if (!inner.isDirectory()) continue;
    const statePath = path.join(amDir, inner.name, 'tour-run-state.json');
    if (!fs.existsSync(statePath)) continue;
    stateCount += 1;
    validateState(statePath);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(
  `OK: ${stateCount} tour-run-state.json file(s) and ${indexCount} tour-run-state-index.json file(s) validated.`,
);

function validateState(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${filePath}: invalid JSON - ${error.message}`);
    return;
  }
  required(filePath, data, 'version');
  required(filePath, data, 'account.canonicalDomain');
  required(filePath, data, 'account.displayName');
  required(filePath, data, 'am.email');
  required(filePath, data, 'runStatus');
  if (data.runStatus && !VALID_RUN_STATUS.has(data.runStatus)) {
    errors.push(`${filePath}: invalid runStatus "${data.runStatus}"`);
  }
  if (!Array.isArray(data.stations)) {
    errors.push(`${filePath}: stations must be an array`);
    return;
  }
  for (const [i, station] of data.stations.entries()) {
    if (!station.id) errors.push(`${filePath}: stations[${i}].id missing`);
    if (!station.status) errors.push(`${filePath}: stations[${i}].status missing`);
    if (station.status && !VALID_STATION_STATUS.has(station.status)) {
      errors.push(`${filePath}: stations[${i}].status invalid "${station.status}"`);
    }
  }
  if (data.pendingSync && Array.isArray(data.pendingSync)) {
    for (const [i, entry] of data.pendingSync.entries()) {
      for (const f of ['attemptedWrite', 'idempotencyKey', 'reason', 'retryPrompt']) {
        if (!entry[f]) errors.push(`${filePath}: pendingSync[${i}].${f} missing`);
      }
    }
  }
}

function validateIndex(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${filePath}: invalid JSON - ${error.message}`);
    return;
  }
  required(filePath, data, 'version');
  required(filePath, data, 'am.email');
  if (!Array.isArray(data.entries)) {
    errors.push(`${filePath}: entries must be an array`);
    return;
  }
  for (const [i, entry] of data.entries.entries()) {
    if (!entry.canonicalDomain) errors.push(`${filePath}: entries[${i}].canonicalDomain missing`);
    if (entry.runStatus && !VALID_RUN_STATUS.has(entry.runStatus)) {
      errors.push(`${filePath}: entries[${i}].runStatus invalid "${entry.runStatus}"`);
    }
  }
}

function required(filePath, data, dotPath) {
  const value = dotPath.split('.').reduce((acc, k) => acc?.[k], data);
  if (value === undefined || value === null || value === '') {
    errors.push(`${filePath}: missing ${dotPath}`);
  }
}
