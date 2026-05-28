#!/usr/bin/env node

import fs from 'node:fs';

const files = process.argv.slice(2);
const inputFiles = files.length > 0
  ? files
  : [
      'templates/am-account-seed-list.csv',
      'templates/satya-ready-accounts.csv',
      'templates/satya-identity-review.csv',
    ];

const rows = [];
for (const file of inputFiles) {
  if (!fs.existsSync(file)) continue;
  const parsed = parseCsv(fs.readFileSync(file, 'utf8').trim());
  const headers = parsed[0] ?? [];
  for (let index = 1; index < parsed.length; index += 1) {
    const row = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(parsed[index][columnIndex] ?? '')]));
    if (!row.account_name) continue;
    rows.push({
      file,
      rowNumber: index + 1,
      amEmail: row.am_email,
      accountName: row.account_name,
      domain: row.domain || row.possible_domain,
      status: row.status || (file.includes('identity-review') ? 'identity_review' : ''),
    });
  }
}

const exactDomain = new Map();
const nameKeys = new Map();
const warnings = [];

for (const row of rows) {
  const domainKey = canonicalDomain(row.domain);
  const nameKey = normalizedName(row.accountName);

  if (domainKey) {
    pushMap(exactDomain, domainKey, row);
  }
  if (nameKey) {
    pushMap(nameKeys, nameKey, row);
  }
}

for (const [domain, matches] of exactDomain.entries()) {
  const distinctAccounts = new Set(matches.map((match) => `${match.amEmail}|${match.accountName}`));
  if (distinctAccounts.size > 1) {
    warnings.push(`Duplicate domain candidate "${domain}": ${formatMatches(matches)}`);
  }
}

for (const [name, matches] of nameKeys.entries()) {
  const domains = new Set(matches.map((match) => canonicalDomain(match.domain)).filter(Boolean));
  if (matches.length > 1 && domains.size > 1) {
    warnings.push(`Same normalized account name with different domains "${name}": ${formatMatches(matches)}`);
  }
}

if (warnings.length > 0) {
  console.log('Review recommended: possible duplicate/variant organizations found.');
  for (const warning of warnings) console.log(`- ${warning}`);
} else {
  console.log(`OK: ${rows.length} account row(s) scanned; no obvious duplicate org candidates found.`);
}

function pushMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function formatMatches(matches) {
  return matches.map((match) => `${match.file}:${match.rowNumber} ${match.accountName} <${match.amEmail || 'no-am'}>`).join('; ');
}

function canonicalDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function normalizedName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|company|co|group|holdings|holding)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
