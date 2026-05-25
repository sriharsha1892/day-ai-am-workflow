#!/usr/bin/env node

import fs from 'node:fs';

const filePath = process.argv[2] ?? 'templates/am-roster.csv';
const rows = parseCsv(fs.readFileSync(filePath, 'utf8').trim());
const headers = rows[0] ?? [];
const requiredHeaders = ['am_email', 'am_name'];
const errors = [];
const seen = new Set();

for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`Missing required column: ${header}`);
}

for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, String(rows[index][columnIndex] ?? '').trim()]));
  if (Object.values(row).every((value) => value === '')) continue;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.am_email)) {
    errors.push(`Row ${rowNumber}: am_email must be valid`);
  }
  if (!row.am_name) {
    errors.push(`Row ${rowNumber}: am_name is required`);
  }
  const emailKey = row.am_email.toLowerCase();
  if (seen.has(emailKey)) {
    errors.push(`Row ${rowNumber}: duplicate am_email "${row.am_email}"`);
  }
  seen.add(emailKey);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${Math.max(rows.length - 1, 0)} AM roster row(s) validated.`);

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

