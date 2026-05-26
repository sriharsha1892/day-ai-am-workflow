#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const filePath = process.argv[2] ?? 'templates/am-active-contacts.csv';
const rosterPath = process.argv[3] ?? 'templates/am-roster.csv';

const requiredHeaders = [
  'am_email',
  'am_name',
  'contact_name',
  'source_system',
];
const optionalHeaders = [
  'account_name',
  'account_domain',
  'email',
  'title',
  'role_bucket',
  'linkedin_url',
  'phone',
  'source_contact_id',
  'relationship_status',
  'last_touch_at',
  'last_touch_channel',
  'next_step',
  'selected_by_am',
  'notes',
];
const sourceSystems = new Set(['freshsales', 'day_ai', 'apollo', 'manual', 'import']);
const channels = new Set(['', 'email', 'call', 'linkedin', 'whatsapp', 'demo', 'trial', 'internal']);
const booleans = new Set(['', 'true', 'false', 'yes', 'no', '1', '0']);

const rows = await readRows(filePath);
const headers = rows[0] ?? [];
const errors = [];

for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`Missing required column: ${header}`);
}
for (const header of optionalHeaders) {
  if (!headers.includes(header)) console.warn(`Warning: optional column "${header}" is absent.`);
}

const rosterRows = await readRows(rosterPath);
const rosterHeaders = rosterRows[0] ?? [];
const roster = new Map(
  rosterRows.slice(1)
    .map((row) => Object.fromEntries(rosterHeaders.map((header, index) => [header, clean(row[index] ?? '')])))
    .filter((row) => row.am_email)
    .map((row) => [row.am_email, row.am_name])
);

const seen = new Set();
let count = 0;
for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(rows[index][columnIndex] ?? '')]));
  if (Object.values(row).every((value) => value === '')) continue;
  count += 1;

  if (!isEmail(row.am_email)) errors.push(`Row ${rowNumber}: am_email must be valid`);
  if (!roster.has(row.am_email)) errors.push(`Row ${rowNumber}: am_email is not in AM roster`);
  if (roster.has(row.am_email) && roster.get(row.am_email) !== row.am_name) {
    errors.push(`Row ${rowNumber}: am_name does not match roster for ${row.am_email}`);
  }
  if (row.account_domain && !isDomain(row.account_domain)) errors.push(`Row ${rowNumber}: account_domain must be valid when provided`);
  if (!row.contact_name) errors.push(`Row ${rowNumber}: contact_name is required`);
  if (row.email && !isEmail(row.email)) errors.push(`Row ${rowNumber}: email must be valid when provided`);
  if (!sourceSystems.has(row.source_system)) {
    errors.push(`Row ${rowNumber}: source_system must be one of ${[...sourceSystems].join(', ')}`);
  }
  if (row.last_touch_at && Number.isNaN(Date.parse(row.last_touch_at))) {
    errors.push(`Row ${rowNumber}: last_touch_at must be date-like when provided`);
  }
  if (!channels.has((row.last_touch_channel || '').toLowerCase())) {
    errors.push(`Row ${rowNumber}: last_touch_channel must be a supported channel when provided`);
  }
  if (!booleans.has((row.selected_by_am || '').toLowerCase())) {
    errors.push(`Row ${rowNumber}: selected_by_am must be true/false/yes/no/1/0 when provided`);
  }

  const key = [
    row.am_email.toLowerCase(),
    (row.account_domain || row.account_name || 'unassigned').toLowerCase(),
    (row.email || row.linkedin_url || row.contact_name).toLowerCase(),
  ].join('|');
  if (seen.has(key)) errors.push(`Row ${rowNumber}: duplicate active contact assignment`);
  seen.add(key);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${count} active contact row(s) validated.`);

async function readRows(targetPath) {
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === '.xlsx') {
    const result = spawnSync('python3', ['scripts/read-xlsx.py', targetPath], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(result.stderr || 'Unable to read .xlsx file. Export as CSV and try again.');
    }
    return JSON.parse(result.stdout);
  }
  const raw = fs.readFileSync(targetPath, 'utf8').trim();
  if (!raw) return [];
  return parseCsv(raw);
}

function parseCsv(text) {
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

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isDomain(value) {
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
