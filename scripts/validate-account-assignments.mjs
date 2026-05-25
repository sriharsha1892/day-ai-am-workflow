#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const requiredHeaders = ['am_email', 'am_name', 'account_name', 'domain'];
const optionalPackHeaders = ['persona_pack', 'cadence_pack', 'channel_pack'];
const filePath = process.argv[2] ?? 'templates/am-account-assignments.csv';
const packPath = process.argv[3] ?? 'workflow/config/packs.json';

const packs = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const rows = await readRows(filePath);
const headers = rows[0] ?? [];
const errors = [];
const seenDomains = new Map();

for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`Missing required column: ${header}`);
}

for (const header of optionalPackHeaders) {
  if (!headers.includes(header)) {
    console.warn(`Warning: optional pack column "${header}" is absent; assignments will fall back to Day AI/global defaults.`);
  }
}

for (let index = 1; index < rows.length; index += 1) {
  const rowNumber = index + 1;
  const row = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(rows[index][columnIndex] ?? '')]));
  if (Object.values(row).every((value) => value === '')) continue;

  if (!isEmail(row.am_email)) errors.push(`Row ${rowNumber}: am_email must be valid`);
  if (!row.am_name) errors.push(`Row ${rowNumber}: am_name is required`);
  if (!row.account_name) errors.push(`Row ${rowNumber}: account_name is required`);
  if (!isDomain(row.domain)) errors.push(`Row ${rowNumber}: domain must be valid`);

  const domainKey = row.domain.toLowerCase();
  if (seenDomains.has(domainKey)) {
    errors.push(`Row ${rowNumber}: duplicate domain "${row.domain}" also appears on row ${seenDomains.get(domainKey)}`);
  } else if (row.domain) {
    seenDomains.set(domainKey, rowNumber);
  }

  if (row.persona_pack && !packs.personaPacks[row.persona_pack]) {
    errors.push(`Row ${rowNumber}: persona_pack "${row.persona_pack}" is not defined`);
  }
  if (row.cadence_pack && !packs.cadencePacks[row.cadence_pack]) {
    errors.push(`Row ${rowNumber}: cadence_pack "${row.cadence_pack}" is not defined`);
  }
  if (row.channel_pack && !packs.channelPacks[row.channel_pack]) {
    errors.push(`Row ${rowNumber}: channel_pack "${row.channel_pack}" is not defined`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${Math.max(rows.length - 1, 0)} assignment row(s) validated.`);

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

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isDomain(value) {
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
