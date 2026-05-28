#!/usr/bin/env node
// Local-only end-of-tour roll-up. Aggregates the day's tour-run-state changes for one AM into:
//   - a brief stdout summary Codex will speak to the AM
//   - a digest file at am-package/<am>/digests/<date>.md
// Trigger: AM types "bye", "wrap up", "end tour", "/end-tour", etc.
// Configured by workflow/config/ux-guidance.json endOfTour.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './worker-client.mjs';

const args = parseArgs(process.argv);
const amEmail = args.am ?? process.env.AM_EMAIL;
const amPackageDir = args['am-package-dir'] ?? process.env.AM_PACKAGE_DIR ?? 'am-package';
const date = args.date ?? new Date().toISOString().slice(0, 10);

if (!amEmail) {
  process.stderr.write('Missing --am or AM_EMAIL env var.\n');
  process.exit(1);
}

const amDir = path.join(amPackageDir, amEmail);
if (!fs.existsSync(amDir)) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, summary: 'No tour activity for this AM yet.' }, null, 2)}\n`,
  );
  process.exit(0);
}

const today = new Date(`${date}T00:00:00.000Z`);
const todayEnd = new Date(today);
todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

let accountsTouched = 0;
let contactsApproved = 0;
let draftsCreated = 0;
let actionsCreated = 0;
const blockers = [];
const completedToday = [];

for (const entry of fs.readdirSync(amDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const statePath = path.join(amDir, entry.name, 'tour-run-state.json');
  if (!fs.existsSync(statePath)) continue;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const lastTouched = state.lastTouchedAt ? new Date(state.lastTouchedAt) : null;
  if (!lastTouched || lastTouched < today || lastTouched >= todayEnd) continue;

  accountsTouched += 1;

  for (const station of state.stations ?? []) {
    if (station.status === 'complete') {
      completedToday.push({ account: state.account?.displayName, station: station.id });
      for (const record of station.dayAiRecordIds ?? []) {
        if (record.type === 'person') contactsApproved += 1;
        if (record.type === 'draft') draftsCreated += 1;
        if (record.type === 'action') actionsCreated += 1;
      }
    }
  }

  if (state.runStatus === 'blocked' || state.runStatus === 'pending_sync') {
    const color = state.runStatus === 'pending_sync' ? 'Red' : 'Yellow';
    const reason = state.pendingSync?.[0]?.reason ?? state.stations?.slice(-1)[0]?.blockerReason ?? state.runStatus;
    blockers.push({
      account: state.account?.displayName,
      color,
      reason,
      retryPrompt: state.pendingSync?.[0]?.retryPrompt,
    });
  }
}

// Pick next-session resume from the per-AM index if it exists.
const indexPath = path.join(amDir, 'tour-run-state-index.json');
let nextResume = null;
if (fs.existsSync(indexPath)) {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const eligible = (index.entries ?? []).filter(
    (e) => e.runStatus && e.runStatus !== 'production_saved',
  );
  if (eligible.length > 0) nextResume = eligible[0];
}

const summaryParts = [
  `Today: ${accountsTouched} account${accountsTouched === 1 ? '' : 's'} touched,`,
  `${contactsApproved} contact${contactsApproved === 1 ? '' : 's'} approved,`,
  `${draftsCreated} draft${draftsCreated === 1 ? '' : 's'},`,
  `${actionsCreated} action${actionsCreated === 1 ? '' : 's'} created.`,
];
const summary = summaryParts.join(' ');

let blockerLine = '';
if (blockers.length > 0) {
  blockerLine = `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}: ` +
    blockers
      .map((b) => `${b.account} (${b.color} - ${b.reason})`)
      .join(', ');
}

const nextPrompt = nextResume
  ? `Resume tomorrow with ${nextResume.displayName}?`
  : null;

const digestLines = [
  `# Tour digest - ${date}`,
  '',
  `AM: ${amEmail}`,
  '',
  `## Summary`,
  '',
  summary,
  '',
];
if (blockerLine) {
  digestLines.push(`## Blockers`, '');
  for (const b of blockers) {
    digestLines.push(`- ${b.account}: ${b.color} - ${b.reason}`);
    if (b.retryPrompt) digestLines.push(`  - Retry: ${b.retryPrompt}`);
  }
  digestLines.push('');
}
digestLines.push(`## Completed stations`, '');
for (const c of completedToday) {
  digestLines.push(`- ${c.account}: ${c.station}`);
}
digestLines.push('');
if (nextPrompt) {
  digestLines.push(`## Next session`, '', nextPrompt, '');
}

const digestDir = path.join(amDir, 'digests');
fs.mkdirSync(digestDir, { recursive: true });
const digestPath = path.join(digestDir, `${date}.md`);
fs.writeFileSync(digestPath, digestLines.join('\n'));

const out = {
  ok: true,
  am: amEmail,
  date,
  summary,
  blockers,
  nextPrompt,
  digestPath,
  counts: { accountsTouched, contactsApproved, draftsCreated, actionsCreated },
};

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
