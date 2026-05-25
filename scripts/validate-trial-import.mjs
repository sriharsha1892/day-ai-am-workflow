#!/usr/bin/env node

import fs from 'node:fs';

const requiredHeaders = [
  'account_domain',
  'account_name',
  'trial_start_date',
  'trial_status',
  'users_invited',
  'active_users_7d',
  'research_runs',
  'exports',
  'shares',
  'last_activity_at',
  'notes',
];

const numericHeaders = new Set([
  'users_invited',
  'active_users_7d',
  'research_runs',
  'exports',
  'shares',
]);

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/validate-trial-import.mjs <csv-file>');
  process.exit(2);
}

const raw = fs.readFileSync(filePath, 'utf8').trim();
if (!raw) {
  console.error('CSV is empty.');
  process.exit(1);
}

const rows = parseCsv(raw);
const headers = rows[0] ?? [];
const missing = requiredHeaders.filter((header) => !headers.includes(header));

if (missing.length > 0) {
  console.error(`Missing required columns: ${missing.join(', ')}`);
  process.exit(1);
}

const errors = [];
for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, rows[index][columnIndex] ?? '']));

  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(row.account_domain)) {
    errors.push(`Row ${rowNumber}: account_domain must be a domain, got "${row.account_domain}"`);
  }

  if (!row.account_name.trim()) {
    errors.push(`Row ${rowNumber}: account_name is required`);
  }

  for (const header of numericHeaders) {
    if (row[header] !== '' && (!Number.isInteger(Number(row[header])) || Number(row[header]) < 0)) {
      errors.push(`Row ${rowNumber}: ${header} must be a non-negative integer`);
    }
  }

  for (const header of ['trial_start_date', 'last_activity_at']) {
    if (row[header] && Number.isNaN(Date.parse(row[header]))) {
      errors.push(`Row ${rowNumber}: ${header} must be date-like, got "${row[header]}"`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${rows.length - 1} trial usage row(s) validated.`);

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

