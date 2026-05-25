#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const filePath = process.argv[2] ?? 'templates/am-account-assignments.csv';
const packPath = process.argv[3] ?? 'workflow/config/packs.json';

const validation = spawnSync(
  process.execPath,
  ['scripts/validate-account-assignments.mjs', filePath, packPath],
  { encoding: 'utf8' }
);

if (validation.status !== 0) {
  process.stderr.write(validation.stderr || validation.stdout);
  process.exit(validation.status ?? 1);
}

const rows = await readRows(filePath);
const headers = rows[0];
const assignments = rows.slice(1)
  .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? '')])))
  .filter((row) => Object.values(row).some(Boolean));

const grouped = new Map();
for (const assignment of assignments) {
  const key = `${assignment.am_name} <${assignment.am_email}>`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(assignment);
}

console.log(`# Account Provisioning Preview\n`);
console.log(`Source: ${filePath}`);
console.log(`Assignments: ${assignments.length}`);
console.log(`AMs: ${grouped.size}\n`);

for (const [am, amAssignments] of grouped.entries()) {
  console.log(`## ${am}`);
  for (const assignment of amAssignments) {
    const parts = [
      `/account-intake account_name="${escapeArg(assignment.account_name)}"`,
      `domain="${escapeArg(assignment.domain)}"`,
      assignment.aliases ? `aliases="${escapeArg(assignment.aliases)}"` : '',
      assignment.parent_company ? `parent_company="${escapeArg(assignment.parent_company)}"` : '',
      `owner_email="${escapeArg(assignment.am_email)}"`,
      assignment.persona_pack ? `persona_pack="${escapeArg(assignment.persona_pack)}"` : '',
      assignment.cadence_pack ? `cadence_pack="${escapeArg(assignment.cadence_pack)}"` : '',
      assignment.channel_pack ? `channel_pack="${escapeArg(assignment.channel_pack)}"` : '',
    ].filter(Boolean);
    console.log(`- ${assignment.account_name} (${assignment.domain})`);
    console.log(`  ${parts.join(' ')}`);
  }
  console.log('');
}

console.log('Copy the generated /account-intake commands into a fresh Codex session from this workspace to create Day AI intake shells.');

async function readRows(targetPath) {
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === '.xlsx') {
    const result = spawnSync('python3', ['scripts/read-xlsx.py', targetPath], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(result.stderr || 'Unable to read .xlsx file. Export as CSV and try again.');
    }
    return JSON.parse(result.stdout);
  }
  return parseCsv(fs.readFileSync(targetPath, 'utf8').trim());
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

function clean(value) {
  return String(value).trim();
}

function escapeArg(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
