#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const seedPath = process.argv[2] ?? 'templates/am-account-seed-list.csv';
const outputRoot = process.argv[3] ?? '/private/tmp/day-ai-am-rollout/am-packets';

const rows = parseCsv(fs.readFileSync(seedPath, 'utf8').trim());
const headers = rows[0] ?? [];
const assignments = rows.slice(1)
  .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? '')])))
  .filter((row) => row.am_email && row.account_name);

const grouped = new Map();
for (const assignment of assignments) {
  const key = `${assignment.am_name}|${assignment.am_email}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(assignment);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const [key, amAssignments] of grouped.entries()) {
  const [amName, amEmail] = key.split('|');
  const slug = slugify(amName);
  const directory = path.join(outputRoot, slug);
  fs.mkdirSync(directory, { recursive: true });

  const csvRows = [
    ['account_name', 'domain', 'status', 'notes'],
    ...amAssignments.map((assignment) => [
      assignment.account_name,
      assignment.domain,
      assignment.status,
      assignment.notes,
    ]),
  ];

  fs.writeFileSync(path.join(directory, 'MY_ACCOUNTS.csv'), stringifyCsv(csvRows));
  fs.writeFileSync(path.join(directory, 'START_HERE.md'), starterMarkdown(amName, amEmail, amAssignments.length));
}

console.log(`Created AM packets in ${outputRoot}`);
for (const [key, amAssignments] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [amName] = key.split('|');
  console.log(`- ${amName}: ${amAssignments.length} account(s)`);
}

function starterMarkdown(amName, amEmail, count) {
  return `# ${amName} AM Workflow Packet

This packet contains your assigned account seed list for the myRA Day AI AM workflow.

## Setup

1. Unzip the shared workflow zip.
2. Open Terminal inside the unzipped workflow folder.
3. Run:

\`\`\`bash
npm install
npm run setup:codex
npm run doctor:codex
\`\`\`

4. Open Codex from that workflow folder.
5. Confirm Day AI access:

\`\`\`text
Check whether Day AI MCP is available and confirm what Day AI workspace/user I am connected as.
\`\`\`

## Your Account List

- AM email: ${amEmail}
- Assigned accounts: ${count}
- File: \`MY_ACCOUNTS.csv\`

Domains are intentionally blank until admin/Freshsales enrichment is complete. Do not invent domains. Ask Codex to help research or confirm the domain before running \`/account-intake\`.

## First Pilot Command Shape

\`\`\`text
/account-intake account_name="..." domain="..." owner_email="${amEmail}"
\`\`\`
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

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
