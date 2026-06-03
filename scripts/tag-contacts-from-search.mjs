#!/usr/bin/env node
// tag-contacts-from-search.mjs — W4-4I: tag contacts with AM Account List
// inherited from their member organization's AM tag.
//
// INPUT: a saved Day.ai search_objects response (JSON) for native_organization
// with includeRelationships:true and AM Account List in properties. Each org's
// `relationships` array includes its member contacts.
//
// LOGIC:
//   For each org in the response:
//     - Read the org's "AM Account List" property (e.g., "Sudeshana")
//     - Map AM name → contact-side AM Account List option UUID (from workspace-ids.json)
//     - For each member contact (relationship type "has member/employee" or
//       relationship name "member"), call worker contact-update-tags with the
//       AM Account List property + option
//
// Idempotent — same idempotency key per (contact_id × AM option). Re-running
// against the same input file is a safe no-op for already-tagged contacts.
//
// Usage:
//   node scripts/tag-contacts-from-search.mjs --search-file=<path> --dry-run
//   node scripts/tag-contacts-from-search.mjs --search-file=<path> --apply

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdempotencyKey, callWorker, parseArgs } from './worker-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IDS_PATH = path.join(REPO_ROOT, 'templates', 'day-ai-workspace-ids.json');

const args = parseArgs(process.argv);
const DRY_RUN = Boolean(args['dry-run']);
const APPLY = Boolean(args.apply);
const SEARCH_FILE = args['search-file'];
const APPROVING_AM = 'harsha@ask-myra.ai';

if (!DRY_RUN && !APPLY) fail('Pass --dry-run or --apply.');
if (!SEARCH_FILE) fail('Pass --search-file=<path> to the saved search_objects JSON.');
if (!fs.existsSync(SEARCH_FILE)) fail(`Search file not found: ${SEARCH_FILE}`);
if (!fs.existsSync(IDS_PATH)) fail(`Workspace IDs file not found: ${IDS_PATH}`);

const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
const contactAm = ids?.customProperties?.contactAmAccountList;
if (!contactAm?.id || !contactAm?.options) {
  fail('workspace-ids.json missing customProperties.contactAmAccountList — re-run W4-4I property creation.');
}

// AM display name → contact-side option UUID
const AM_TO_OPTION = {
  'Satya Focus': contactAm.options.satyaFocus,
  'Satya':       contactAm.options.satya,
  'Satish':      contactAm.options.satish,
  'Sudeshana':   contactAm.options.sudeshana,
  'Kirandeep':   contactAm.options.kirandeep,
  'Vijay':       contactAm.options.vijay,
  'Nikita':      contactAm.options.nikita,
};

// Parse the MCP envelope (a tool-result wrapper) OR a raw search response.
const fileText = fs.readFileSync(SEARCH_FILE, 'utf8');
let response;
try {
  const parsed = JSON.parse(fileText);
  // If it's an array of {type:'text', text:...}, unwrap.
  if (Array.isArray(parsed) && parsed[0]?.text) {
    response = JSON.parse(parsed[0].text);
  } else {
    response = parsed;
  }
} catch (e) {
  fail(`Could not parse JSON from ${SEARCH_FILE}: ${e.message}`);
}

const orgs = response?.native_organization?.results ?? [];
console.log(`# tag-contacts-from-search ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);
console.log(`# Source: ${path.basename(SEARCH_FILE)}`);
console.log(`# Orgs in file: ${orgs.length}\n`);

// Extract (contact_id, am_option) pairs, deduplicating
const pairs = new Map(); // contact_id → am_option_id (first wins on dupes)
for (const org of orgs) {
  const amList = org?.properties?.['AM Account List'];
  if (!Array.isArray(amList) || !amList.length) continue;
  const amName = amList[0]; // pick first if multi
  const optionId = AM_TO_OPTION[amName];
  if (!optionId) {
    console.warn(`  org ${org.objectId}: unknown AM "${amName}" — skipping`);
    continue;
  }
  for (const rel of org.relationships ?? []) {
    if (rel.objectType !== 'native_contact') continue;
    const contactId = rel.objectId;
    if (!contactId) continue;
    if (!pairs.has(contactId)) {
      pairs.set(contactId, { amOption: optionId, amName, fromOrg: org.objectId });
    }
  }
}

console.log(`# Unique contacts to tag: ${pairs.size}\n`);

let ok = 0, errored = 0;
let i = 0;
for (const [contactId, { amOption, amName, fromOrg }] of pairs) {
  i++;
  const idempotencyKey = buildIdempotencyKey({
    action: 'contact-update-tags',
    canonicalDomain: contactId,
    extra: `am:${amName}`,
  });
  const payload = {
    action: 'contact-update-tags',
    approvingAm: APPROVING_AM,
    canonicalDomain: (contactId.includes('@') ? contactId.split('@')[1] : contactId),
    contactEmail: contactId, // handler uses this as objectId; works for email OR UUID
    idempotencyKey,
    retry: false,
    customProperties: [
      {
        propertyId: contactAm.id,
        value: amOption,
        reasoning: `W4-4I inherit: contact is member of ${fromOrg} (tagged ${amName}).`,
      },
    ],
  };

  if (DRY_RUN) {
    console.log(`  ${i.toString().padStart(4)}/${pairs.size}  ${contactId.padEnd(50).slice(0,50)}  -> ${amName}  (from ${fromOrg})`);
    ok++;
    continue;
  }

  const result = await callWorker('v1/day-ai/write', payload);
  if (result?.ok ?? result?.success) {
    console.log(`  ${i.toString().padStart(4)}/${pairs.size}  ${contactId.padEnd(50).slice(0,50)}  -> ${amName}`);
    ok++;
  } else {
    console.warn(`  ${i.toString().padStart(4)}/${pairs.size}  ${contactId.padEnd(50).slice(0,50)}  FAIL — ${safe(result)}`);
    errored++;
  }
}

console.log(`\n# Totals: ok=${ok}  error=${errored}`);
if (errored > 0) process.exit(1);

function safe(r) {
  if (!r) return '(no response)';
  if (typeof r === 'string') return r.slice(0, 200);
  return (r.error || r.message || JSON.stringify(r)).slice(0, 200);
}
function fail(msg) { process.stderr.write(`FAIL ${msg}\n`); process.exit(1); }
