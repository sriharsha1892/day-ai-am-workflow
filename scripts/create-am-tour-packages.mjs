#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outputRoot = process.argv[2] ?? '/private/tmp/day-ai-am-tour-v2';
const rosterPath = 'templates/am-roster.csv';
const seedPath = 'templates/am-account-seed-list.csv';
const satyaReadyPath = 'templates/satya-ready-accounts.csv';
const satyaReviewPath = 'templates/satya-identity-review.csv';
const activeContactsPath = process.env.ACTIVE_CONTACTS_PATH ?? 'templates/am-active-contacts.csv';
const python = process.env.PYTHON ?? 'python3';

const filesToCopy = [
  'AGENTS.md',
  'AM_TOUR.md',
  'README.md',
  'package.json',
];
const dirsToCopy = [
  'workflow',
  'scripts',
  'templates',
  'docs',
];

const roster = readObjects(rosterPath);
const seedRows = readObjects(seedPath);
const satyaReady = readObjects(satyaReadyPath);
const satyaReview = readObjects(satyaReviewPath);
const activeContacts = fs.existsSync(activeContactsPath) ? readObjects(activeContactsPath) : [];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const generated = [];
for (const am of roster) {
  const slug = slugify(am.am_name);
  const packageName = `${slug}-myra-am-tour`;
  const packageDir = path.join(outputRoot, packageName);
  fs.mkdirSync(packageDir, { recursive: true });

  for (const file of filesToCopy) {
    fs.copyFileSync(file, path.join(packageDir, path.basename(file)));
  }
  for (const dir of dirsToCopy) {
    copyDir(dir, path.join(packageDir, dir));
  }

  const accounts = buildAccountsForAm(am, seedRows, satyaReady, satyaReview);
  const contacts = buildContactsForAm(am, activeContacts);
  const packet = buildPacket(am, accounts, contacts);
  fs.writeFileSync(path.join(packageDir, 'account-packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(path.join(packageDir, 'START_HERE.md'), startHere(packet));

  const workbookResult = spawnSync(
    python,
    ['scripts/write-am-workbook.py', path.join(packageDir, 'account-packet.json'), path.join(packageDir, 'MY_ACCOUNTS.xlsx')],
    { encoding: 'utf8' }
  );
  if (workbookResult.status !== 0) {
    process.stderr.write(workbookResult.stderr || workbookResult.stdout);
    process.exit(workbookResult.status ?? 1);
  }

  const zipPath = path.join(outputRoot, `${packageName}.zip`);
  const zipResult = spawnSync('zip', ['-qr', zipPath, packageName], { cwd: outputRoot, encoding: 'utf8' });
  if (zipResult.status !== 0) {
    process.stderr.write(zipResult.stderr || zipResult.stdout);
    process.exit(zipResult.status ?? 1);
  }

  generated.push({
    am: am.am_name,
    email: am.am_email,
    zipPath,
    ready: accounts.filter((account) => account.status === 'ready_for_intake').length,
    pending: accounts.filter((account) => account.status === 'domain_pending').length,
    review: accounts.filter((account) => account.status === 'identity_review').length,
    hold: accounts.filter((account) => account.status === 'hold').length,
  });
}

console.log(`Created AM tour packages in ${outputRoot}`);
for (const item of generated) {
  console.log(`- ${item.am}: ${item.zipPath}`);
  console.log(`  ready=${item.ready} pending=${item.pending} review=${item.review} hold=${item.hold}`);
}

function buildAccountsForAm(am, seeds, readyRows, reviewRows) {
  if (am.am_email === 'satya@ask-myra.ai') {
    return [
      ...readyRows.map((row) => ({
        accountName: row.account_name,
        domain: row.domain,
        priority: row.priority || 'P2',
        status: 'ready_for_intake',
        domainConfidence: row.domain_confidence || 'high',
        domainSourceUrl: row.domain_source_url,
        notes: row.admin_notes,
        nextAction: 'Run account intake',
      })),
      ...reviewRows.map((row) => ({
        accountName: row.account_name,
        domain: row.possible_domain,
        priority: 'P3',
        status: 'identity_review',
        domainConfidence: row.possible_domain ? 'low' : '',
        domainSourceUrl: '',
        notes: `${row.review_reason}${row.admin_notes ? `; ${row.admin_notes}` : ''}`,
        nextAction: 'Admin identity review required',
      })),
    ];
  }

  return seeds
    .filter((row) => row.am_email === am.am_email)
    .map((row) => ({
      accountName: row.account_name,
      domain: row.domain,
      priority: row.priority || 'P2',
      status: normalizeStatus(row.status),
      domainConfidence: row.domain ? 'medium' : '',
      domainSourceUrl: '',
      notes: row.notes,
      nextAction: row.domain ? 'Run account intake' : 'Confirm domain before intake',
    }));
}

function buildContactsForAm(am, contacts) {
  return contacts
    .filter((contact) => contact.am_email === am.am_email)
    .map((contact) => ({
      accountName: contact.account_name,
      accountDomain: contact.account_domain,
      contactName: contact.contact_name,
      email: contact.email,
      title: contact.title,
      roleBucket: contact.role_bucket,
      linkedinUrl: contact.linkedin_url,
      phone: contact.phone,
      sourceSystem: contact.source_system || 'import',
      sourceContactId: contact.source_contact_id,
      relationshipStatus: contact.relationship_status,
      lastTouchAt: contact.last_touch_at,
      lastTouchChannel: contact.last_touch_channel,
      nextStep: contact.next_step,
      selectedByAm: parseBoolean(contact.selected_by_am),
      notes: contact.notes,
    }));
}

function buildPacket(am, accounts, activeContacts) {
  const sorted = [...accounts].sort((a, b) => {
    const statusRank = statusOrder(a.status) - statusOrder(b.status);
    if (statusRank !== 0) return statusRank;
    return priorityOrder(a.priority) - priorityOrder(b.priority);
  });
  const recommended = sorted.find((account) => account.status === 'ready_for_intake') ?? sorted[0] ?? null;
  const contactsByAccount = new Map();
  const unassignedContacts = [];
  for (const contact of activeContacts) {
    const key = accountKey(contact.accountDomain, contact.accountName);
    if (!key) {
      unassignedContacts.push(contact);
      continue;
    }
    if (!contactsByAccount.has(key)) contactsByAccount.set(key, []);
    contactsByAccount.get(key).push(contact);
  }
  return {
    version: '2.0',
    generatedAt: new Date().toISOString(),
    am: {
      name: am.am_name,
      email: am.am_email,
    },
    tour: {
      startPrompt: 'Start my myRA AM tour.',
      checkpointMode: true,
      recommendedFirstAccount: recommended?.accountName ?? null,
      recommendedFirstDomain: recommended?.domain ?? null,
    },
    summary: {
      total: accounts.length,
      readyForIntake: accounts.filter((account) => account.status === 'ready_for_intake').length,
      domainPending: accounts.filter((account) => account.status === 'domain_pending').length,
      identityReview: accounts.filter((account) => account.status === 'identity_review').length,
      hold: accounts.filter((account) => account.status === 'hold').length,
      activeContacts: activeContacts.length,
      unassignedActiveContacts: unassignedContacts.length,
    },
    accounts: sorted.map((account) => ({
      ...account,
      ownerEmail: am.am_email,
      activeContacts: contactsByAccount.get(accountKey(account.domain, account.accountName)) ?? [],
      intakeCommand: account.status === 'ready_for_intake'
        ? `/account-intake account_name="${escapePrompt(account.accountName)}" domain="${escapePrompt(account.domain)}" owner_email="${am.am_email}"`
        : '',
    })),
    activeContacts,
    connectorAccess: {
      model: 'centralized_admin_runtime',
      amKeysRequired: false,
      providers: {
        freshsales: {
          enabled: true,
          mode: 'read_only',
          shortcuts: ['/freshsales-lookup', '/account-intake', '/map-contacts'],
        },
        apollo: {
          enabled: true,
          mode: 'net_new_search_selective_enrichment',
          shortcuts: ['/source-new-contacts', '/map-contacts'],
        },
        clearout: {
          enabled: true,
          mode: 'selected_email_verification',
          shortcuts: ['/verify-contact-email', '/source-new-contacts'],
        },
      },
      fallback: 'Codex should create a Day AI connector request or pause with the exact payload; never ask the AM for API keys.',
    },
    guardrails: [
      'No external sends.',
      'No Freshsales writes.',
      'No Apollo writes or sequences.',
      'No provider API keys in this package.',
      'No canonical Day AI People without AM approval.',
      'Show Day AI handoff receipts before and after writes.',
    ],
  };
}

function startHere(packet) {
  const recommended = packet.tour.recommendedFirstAccount
    ? `${packet.tour.recommendedFirstAccount}${packet.tour.recommendedFirstDomain ? ` (${packet.tour.recommendedFirstDomain})` : ''}`
    : 'No ready account yet';
  return `# ${packet.am.name} myRA AM Tour

Open Codex in this folder and say:

\`\`\`text
Start my myRA AM tour.
\`\`\`

Expected setup time: under 10 minutes.

Codex will:

- Check Day AI MCP access.
- Load \`account-packet.json\` for speed.
- Use \`MY_ACCOUNTS.xlsx\` as your cockpit.
- Show your queue and recommend the next account.
- Pause before Day AI writes.
- Show Day AI handoff receipts.
- Request Freshsales/Apollo/Clearout evidence through centralized connectors when needed.

Recommended first account: ${recommended}

If stuck, say:

\`\`\`text
Fix my Day AI connection.
Resume my myRA AM tour.
Show what has been saved to Day AI.
Show accounts needing domains.
\`\`\`
`;
}

function readObjects(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8').trim());
  const headers = rows[0] ?? [];
  return rows.slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? '')])))
    .filter((row) => Object.values(row).some(Boolean));
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.env')) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath);
  }
}

function normalizeStatus(status) {
  if (status === 'ready_for_am' || status === 'ready_for_intake') return 'ready_for_intake';
  if (status === 'identity_review') return 'identity_review';
  if (status === 'hold') return 'hold';
  return 'domain_pending';
}

function statusOrder(status) {
  return {
    ready_for_intake: 0,
    domain_pending: 1,
    identity_review: 2,
    hold: 3,
  }[status] ?? 9;
}

function priorityOrder(priority) {
  return { P1: 0, P2: 1, P3: 2 }[priority] ?? 9;
}

function accountKey(domain, name) {
  return (domain || name || '').toLowerCase().trim();
}

function parseBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'no', '0'].includes(normalized)) return false;
  return false;
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

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapePrompt(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
