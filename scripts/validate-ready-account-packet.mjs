#!/usr/bin/env node

import fs from 'node:fs';

const filePath = process.argv[2] ?? 'templates/satya-ready-accounts.csv';
const expectedOwner = process.argv[3] ?? '';
const expectedCount = Number(process.argv[4] ?? 0);

const requiredHeaders = [
  'am_email',
  'am_name',
  'account_name',
  'domain',
  'priority',
  'domain_confidence',
  'domain_source_url',
  'admin_notes',
];

const rows = parseCsv(fs.readFileSync(filePath, 'utf8').trim());
const headers = rows[0] ?? [];
const errors = [];
const seenAccounts = new Set();
const heldAccounts = new Set(['andco', 'apwinner', 'kalyani group']);

for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`Missing required column: ${header}`);
}

let count = 0;
for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(rows[index][columnIndex] ?? '')]));
  if (Object.values(row).every((value) => value === '')) continue;
  count += 1;

  if (!isEmail(row.am_email)) errors.push(`Row ${rowNumber}: am_email must be valid`);
  if (expectedOwner && row.am_email !== expectedOwner) {
    errors.push(`Row ${rowNumber}: am_email must be ${expectedOwner}`);
  }
  if (!row.am_name) errors.push(`Row ${rowNumber}: am_name is required`);
  if (!row.account_name) errors.push(`Row ${rowNumber}: account_name is required`);
  if (!isDomain(row.domain)) errors.push(`Row ${rowNumber}: domain must be valid`);
  if (!['P1', 'P2', 'P3'].includes(row.priority)) errors.push(`Row ${rowNumber}: priority must be P1, P2, or P3`);
  if (!['high', 'medium', 'low'].includes(row.domain_confidence)) {
    errors.push(`Row ${rowNumber}: domain_confidence must be high, medium, or low`);
  }
  for (const sourceUrl of row.domain_source_url.split(';').map((value) => value.trim()).filter(Boolean)) {
    if (!/^https?:\/\/.+/i.test(sourceUrl)) errors.push(`Row ${rowNumber}: domain_source_url must contain URL(s)`);
  }

  const accountKey = row.account_name.toLowerCase();
  if (heldAccounts.has(accountKey)) errors.push(`Row ${rowNumber}: held account "${row.account_name}" must not be in ready packet`);
  if (seenAccounts.has(accountKey)) errors.push(`Row ${rowNumber}: duplicate account_name "${row.account_name}"`);
  seenAccounts.add(accountKey);
}

if (expectedCount > 0 && count !== expectedCount) {
  errors.push(`Expected ${expectedCount} ready account row(s), found ${count}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${count} ready account row(s) validated in ${filePath}.`);

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

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isDomain(value) {
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
