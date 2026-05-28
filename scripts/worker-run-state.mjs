#!/usr/bin/env node
// Local-only runtime state manager. Reads/writes:
//   - per-account: am-package/<am>/<account>/tour-run-state.json
//   - per-AM index: am-package/<am>/tour-run-state-index.json
// Subcommands:
//   get             --account <domain> [--am <email>]
//   set             --account <domain> --status <runStatus> [--am <email>]
//   mark-station    --account <domain> --station <id> --status <status>
//                   [--day-ai-record-ids <json>] [--idempotency-key <key>] [--blocker-reason <text>]
//   queue-pending-sync --account <domain> --attempted-write <verb> --idempotency-key <key>
//                      --reason <text> --retry-prompt <text>
//   index           [--am <email>]           # rebuild index across all account states
//   next-resume     [--am <email>]           # return highest-priority unfinished canonical_domain

import fs from 'node:fs';
import path from 'node:path';
import { canonicalDomain, parseArgs, requireArg } from './worker-client.mjs';

const PRIORITY_ORDER = ['P1', 'P2', 'P3'];
// Status priority: pending_sync and blocked sort first (they need attention),
// then production_pending_approval / production_running, then dry_run_complete.
// production_saved is "done" and is excluded from next-resume.
const STATUS_PRIORITY = {
  pending_sync: 0,
  blocked: 1,
  production_pending_approval: 2,
  production_running: 3,
  dry_run_complete: 4,
};

const args = parseArgs(process.argv);
const subcommand = args._positional?.[0];
const amEmail = args.am ?? process.env.AM_EMAIL;
const amPackageDir = args['am-package-dir'] ?? process.env.AM_PACKAGE_DIR ?? 'am-package';

if (!subcommand) {
  process.stderr.write(
    'Usage: worker-run-state <subcommand> [--am <email>] [--account <domain>] [...args]\n' +
      'Subcommands: get | set | mark-station | queue-pending-sync | index | next-resume\n',
  );
  process.exit(1);
}

if (!amEmail) {
  process.stderr.write('Missing --am or AM_EMAIL env var.\n');
  process.exit(1);
}

const amDir = path.join(amPackageDir, amEmail);
const indexPath = path.join(amDir, 'tour-run-state-index.json');

const handlers = {
  get,
  set: setStatus,
  'mark-station': markStation,
  'queue-pending-sync': queuePendingSync,
  index: rebuildIndex,
  'next-resume': nextResume,
};

const handler = handlers[subcommand];
if (!handler) {
  process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
  process.exit(1);
}

try {
  await handler();
} catch (error) {
  process.stderr.write(`worker-run-state ${subcommand} failed: ${error.message}\n`);
  process.exit(1);
}

function statePathFor(account) {
  return path.join(amDir, account, 'tour-run-state.json');
}

function readState(account) {
  const p = statePathFor(account);
  if (!fs.existsSync(p)) {
    return {
      version: '3.1',
      account: { canonicalDomain: account, displayName: account },
      am: { email: amEmail },
      runStatus: 'dry_run_complete',
      stations: [],
      pendingSync: [],
    };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeState(account, state) {
  const p = statePathFor(account);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.lastTouchedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
  rebuildIndexSync();
  return p;
}

function get() {
  const account = canonicalDomain(requireArg(args, 'account'));
  const state = readState(account);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

function setStatus() {
  const account = canonicalDomain(requireArg(args, 'account'));
  const status = requireArg(args, 'status');
  const state = readState(account);
  state.runStatus = status;
  const filePath = writeState(account, state);
  process.stdout.write(
    `${JSON.stringify({ ok: true, account, runStatus: status, path: filePath }, null, 2)}\n`,
  );
}

function markStation() {
  const account = canonicalDomain(requireArg(args, 'account'));
  const stationId = requireArg(args, 'station');
  const stationStatus = requireArg(args, 'status');

  const state = readState(account);
  const existing = state.stations?.find((s) => s.id === stationId);
  const now = new Date().toISOString();
  const station =
    existing ??
    {
      id: stationId,
      status: 'not_started',
      startedAt: now,
    };

  station.status = stationStatus;
  if (stationStatus === 'in_progress' && !station.startedAt) station.startedAt = now;
  if (stationStatus === 'complete') station.completedAt = now;
  if (args['idempotency-key']) station.idempotencyKey = args['idempotency-key'];
  if (args['day-ai-record-ids']) station.dayAiRecordIds = JSON.parse(args['day-ai-record-ids']);
  if (args['blocker-reason']) station.blockerReason = args['blocker-reason'];

  if (!existing) {
    state.stations = [...(state.stations ?? []), station];
  }

  const filePath = writeState(account, state);
  process.stdout.write(
    `${JSON.stringify({ ok: true, account, station, path: filePath }, null, 2)}\n`,
  );
}

function queuePendingSync() {
  const account = canonicalDomain(requireArg(args, 'account'));
  const entry = {
    attemptedWrite: requireArg(args, 'attempted-write'),
    idempotencyKey: requireArg(args, 'idempotency-key'),
    reason: requireArg(args, 'reason'),
    retryPrompt: args['retry-prompt'] ?? 'Retry pending Day AI sync for this account using the same idempotency key.',
    duplicateSafetyNote:
      args['duplicate-safety-note'] ??
      'Codex has not created a duplicate record. The retry will reuse this idempotency key.',
    firstAttemptAt: new Date().toISOString(),
  };

  const state = readState(account);
  state.pendingSync = [...(state.pendingSync ?? []), entry];
  state.runStatus = 'pending_sync';
  const filePath = writeState(account, state);
  process.stdout.write(
    `${JSON.stringify({ ok: true, account, entry, path: filePath }, null, 2)}\n`,
  );
}

function rebuildIndex() {
  const index = rebuildIndexSync();
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}

function rebuildIndexSync() {
  if (!fs.existsSync(amDir)) {
    return { am: { email: amEmail }, entries: [] };
  }

  const entries = [];
  for (const entry of fs.readdirSync(amDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(amDir, entry.name, 'tour-run-state.json');
    if (!fs.existsSync(statePath)) continue;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    entries.push({
      canonicalDomain: state.account?.canonicalDomain ?? entry.name,
      displayName: state.account?.displayName ?? entry.name,
      priority: state.account?.priority,
      runStatus: state.runStatus,
      lastTouchedAt: state.lastTouchedAt,
      lastReceiptPath: state.lastReceipt?.localPath,
      lastReceiptColor: state.lastReceipt?.color,
      nextActionHint: state.lastReceipt?.nextAction ?? state.stations?.slice(-1)[0]?.blockerReason,
      blockerCount: (state.pendingSync?.length ?? 0) + (state.runStatus === 'blocked' ? 1 : 0),
    });
  }

  const index = {
    version: '3.1',
    am: { email: amEmail },
    generatedAt: new Date().toISOString(),
    entries,
  };

  fs.mkdirSync(amDir, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return index;
}

function nextResume() {
  const index = rebuildIndexSync();
  const eligible = index.entries.filter((e) => e.runStatus && e.runStatus !== 'production_saved');
  if (eligible.length === 0) {
    process.stdout.write(`${JSON.stringify({ ok: true, resume: null }, null, 2)}\n`);
    return;
  }

  eligible.sort((a, b) => {
    const ap = STATUS_PRIORITY[a.runStatus] ?? 5;
    const bp = STATUS_PRIORITY[b.runStatus] ?? 5;
    if (ap !== bp) return ap - bp;
    const apri = PRIORITY_ORDER.indexOf(a.priority);
    const bpri = PRIORITY_ORDER.indexOf(b.priority);
    if (apri !== -1 && bpri !== -1 && apri !== bpri) return apri - bpri;
    if (a.lastTouchedAt && b.lastTouchedAt) {
      return new Date(b.lastTouchedAt) - new Date(a.lastTouchedAt);
    }
    return 0;
  });

  const chosen = eligible[0];
  process.stdout.write(`${JSON.stringify({ ok: true, resume: chosen }, null, 2)}\n`);
}
