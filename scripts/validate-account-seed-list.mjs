#!/usr/bin/env node

import fs from 'node:fs';

const filePath = process.argv[2] ?? 'templates/am-account-seed-list.csv';
const rosterPath = process.argv[3] ?? 'templates/am-roster.csv';

const rows = parseCsv(fs.readFileSync(filePath, 'utf8').trim());
const headers = rows[0] ?? [];
const requiredHeaders = ['am_email', 'am_name', 'account_name', 'domain', 'status', 'notes'];
const errors = [];

for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`Missing required column: ${header}`);
}

const rosterRows = parseCsv(fs.readFileSync(rosterPath, 'utf8').trim());
const rosterHeaders = rosterRows[0] ?? [];
const roster = new Map(
  rosterRows.slice(1)
    .map((row) => Object.fromEntries(rosterHeaders.map((header, index) => [header, clean(row[index] ?? '')])))
    .filter((row) => row.am_email)
    .map((row) => [row.am_email, row.am_name])
);

const seen = new Set();
const counts = new Map();
let verifyCount = 0;

for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(rows[index][columnIndex] ?? '')]));
  if (Object.values(row).every((value) => value === '')) continue;

  if (!isEmail(row.am_email)) errors.push(`Row ${rowNumber}: am_email must be valid`);
  if (!roster.has(row.am_email)) errors.push(`Row ${rowNumber}: am_email is not in AM roster`);
  if (roster.has(row.am_email) && roster.get(row.am_email) !== row.am_name) {
    errors.push(`Row ${rowNumber}: am_name does not match roster for ${row.am_email}`);
  }
  if (!row.account_name) errors.push(`Row ${rowNumber}: account_name is required`);
  if (row.domain && !isDomain(row.domain)) errors.push(`Row ${rowNumber}: domain must be valid when provided`);
  if (!['domain_pending', 'ready_for_intake', 'hold'].includes(row.status)) {
    errors.push(`Row ${rowNumber}: status must be domain_pending, ready_for_intake, or hold`);
  }

  const key = `${row.am_email.toLowerCase()}|${row.account_name.toLowerCase()}`;
  if (seen.has(key)) errors.push(`Row ${rowNumber}: duplicate AM/account assignment`);
  seen.add(key);

  counts.set(row.am_name, (counts.get(row.am_name) ?? 0) + 1);
  if (/verify/i.test(row.notes)) verifyCount += 1;
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${Math.max(rows.length - 1, 0)} seed assignment row(s) validated.`);
for (const [amName, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${amName}: ${count}`);
}
if (verifyCount > 0) {
  console.log(`Review recommended: ${verifyCount} row(s) have spelling/full-name verification notes.`);
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

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isDomain(value) {
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
