#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const packageDir = process.argv[2];
if (!packageDir) {
  console.error('Usage: scripts/validate-am-tour-package.mjs <package-dir>');
  process.exit(2);
}

const requiredFiles = [
  'START_HERE.md',
  'MY_ACCOUNTS.xlsx',
  'account-packet.json',
  'AGENTS.md',
  'AM_TOUR.md',
  'workflow/shortcuts/guided-tour.md',
];

const errors = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(packageDir, file))) errors.push(`Missing ${file}`);
}

const packetPath = path.join(packageDir, 'account-packet.json');
let packet = null;
if (fs.existsSync(packetPath)) {
  packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  if (!packet.am?.email) errors.push('Missing am.email in account-packet.json');
  if (!Array.isArray(packet.accounts)) errors.push('Missing accounts[] in account-packet.json');
  if (packet.accounts?.some((account) => account.status === 'ready_for_intake' && !account.domain)) {
    errors.push('Ready account without domain');
  }
}

const zipList = spawnSync('find', [packageDir, '-name', '.env*', '-o', '-name', 'node_modules'], { encoding: 'utf8' });
if (zipList.stdout.trim()) {
  errors.push(`Forbidden package files found:\n${zipList.stdout.trim()}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${packageDir}`);
if (packet) {
  console.log(`- AM: ${packet.am.name} <${packet.am.email}>`);
  console.log(`- Accounts: ${packet.accounts.length}`);
  console.log(`- Ready: ${packet.summary.readyForIntake}`);
  console.log(`- Pending: ${packet.summary.domainPending}`);
  console.log(`- Review: ${packet.summary.identityReview}`);
}
