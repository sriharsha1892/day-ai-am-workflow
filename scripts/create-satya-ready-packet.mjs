#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const readyPath = process.argv[2] ?? 'templates/satya-ready-accounts.csv';
const outputRoot = process.argv[3] ?? '/private/tmp/day-ai-am-rollout/satya-ready-packet';
const validation = spawnSync(
  process.execPath,
  ['scripts/validate-ready-account-packet.mjs', readyPath, 'satya@ask-myra.ai', '25'],
  { encoding: 'utf8' }
);

if (validation.status !== 0) {
  process.stderr.write(validation.stderr || validation.stdout);
  process.exit(validation.status ?? 1);
}

const rows = parseCsv(fs.readFileSync(readyPath, 'utf8').trim());
const headers = rows[0] ?? [];
const accounts = rows.slice(1)
  .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? '')])))
  .filter((row) => row.account_name);

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const packetRows = [
  ['account_name', 'domain', 'priority', 'domain_confidence', 'domain_source_url', 'admin_notes'],
  ...accounts.map((account) => [
    account.account_name,
    account.domain,
    account.priority,
    account.domain_confidence,
    account.domain_source_url,
    account.admin_notes,
  ]),
];

fs.writeFileSync(path.join(outputRoot, 'MY_ACCOUNTS.csv'), stringifyCsv(packetRows));
fs.writeFileSync(path.join(outputRoot, 'START_HERE.md'), starterMarkdown(accounts));
fs.copyFileSync('AM_TOUR.md', path.join(outputRoot, 'AM_TOUR.md'));

console.log(`Created Satya ready packet in ${outputRoot}`);
console.log(`- Ready accounts: ${accounts.length}`);
console.log(`- First recommended account: ${accounts[0].account_name} (${accounts[0].domain})`);

function starterMarkdown(accounts) {
  return `# Satya AM Ready Packet

This packet contains only domain-confirmed accounts for Satya's myRA Day AI guided tour.

## Files

- \`MY_ACCOUNTS.csv\`: your ready account queue.
- \`AM_TOUR.md\`: how Codex should guide the workflow.

## Setup

1. Unzip the shared workflow distribution.
2. Place or keep this packet nearby.
3. Open Terminal inside the unzipped workflow folder.
4. Run:

\`\`\`bash
npm install
npm run setup:codex
npm run doctor:codex
\`\`\`

5. Open Codex from the workflow folder.
6. Start with:

\`\`\`text
Start my AM guided tour. Use my account packet, show my priority queue, recommend the first account, and pause after each checkpoint before writing to Day AI.
\`\`\`

## First Recommended Account

\`\`\`text
/account-intake account_name="${accounts[0].account_name}" domain="${accounts[0].domain}" owner_email="satya@ask-myra.ai"
\`\`\`

## Important Guardrails

- Codex should create Day AI context, tasks, and drafts only after checkpoint approval.
- Codex should not send emails.
- Codex should not write to Freshsales.
- Codex should not create canonical contacts without approval.
`;
}

function parseCsv(text) {
  if (!text) return [];
  const result = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      result.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  result.push(row);
  return result.filter((parsedRow) => parsedRow.some((value) => value.length > 0));
}

function stringifyCsv(rows) {
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function clean(value) {
  return String(value).trim();
}
