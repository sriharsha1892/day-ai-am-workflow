#!/usr/bin/env node
// Issue a worker bearer token for an AM, update .env.local + Vercel env, and stage redeploy.
//
// Usage:
//   npm run issue-am-token -- --am satya@ask-myra.ai
//   npm run issue-am-token -- --am satish@ask-myra.ai --prefix tok_satish --redeploy
//   npm run issue-am-token -- --am old@ask-myra.ai --revoke   # remove without issuing a new one
//
// What it does:
//   1. Generates a 24-byte hex token prefixed `tok_<short>_<hex>` (or --prefix override).
//   2. Updates WORKER_BEARER_TOKENS in `.env.local` (line-replace if the AM already had one).
//   3. Updates WORKER_BEARER_TOKENS on Vercel (production + preview environments).
//   4. Writes the token to `.tokens/<email>.txt` (mode 0600; .gitignored).
//   5. Optionally redeploys to production (`--redeploy`).
//   6. Prints a 1Password Send / Bitwarden Send-friendly handoff line.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyEnv, loadLocalEnv, envPath } from './env-utils.mjs';

applyEnv(loadLocalEnv(envPath));

const args = parseArgs(process.argv);
const amEmail = required(args, 'am');
const prefix = args.prefix ?? `tok_${shortFromEmail(amEmail)}`;
const revoke = Boolean(args.revoke);
const skipVercel = Boolean(args['skip-vercel']);
const redeploy = Boolean(args.redeploy);

const token = revoke ? null : `${prefix}_${crypto.randomBytes(24).toString('hex')}`;

const envFile = path.resolve('.env.local');
if (!fs.existsSync(envFile)) {
  fail(`${envFile} not found. Create it first with WORKER_BEARER_TOKENS=<existing pairs>.`);
}

const updatedEnvLine = updateLocalEnv(envFile, amEmail, token);
if (!skipVercel) {
  pushToVercel(updatedEnvLine);
}
if (token) {
  persistTokenFile(amEmail, token);
}
if (redeploy) {
  redeployProd();
}

print(amEmail, token, revoke);

function updateLocalEnv(file, email, newToken) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith('WORKER_BEARER_TOKENS='));
  const pairs = new Map();
  if (idx !== -1) {
    const value = lines[idx].slice('WORKER_BEARER_TOKENS='.length);
    for (const pair of value.split(',')) {
      const [e, t] = pair.split(':');
      if (e && t) pairs.set(e.trim(), t.trim());
    }
  }
  if (newToken === null) pairs.delete(email);
  else pairs.set(email, newToken);

  const newValue = [...pairs.entries()].map(([e, t]) => `${e}:${t}`).join(',');
  const newLine = `WORKER_BEARER_TOKENS=${newValue}`;
  if (idx === -1) lines.push(newLine);
  else lines[idx] = newLine;

  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return newValue;
}

function pushToVercel(newValue) {
  for (const target of ['production', 'preview']) {
    const rm = spawnSync('vercel', ['env', 'rm', 'WORKER_BEARER_TOKENS', target, '--yes'], {
      encoding: 'utf8',
    });
    if (rm.status !== 0 && !/does not exist|no environment variable/i.test(rm.stderr + rm.stdout)) {
      process.stderr.write(`vercel env rm ${target} failed: ${rm.stderr}\n`);
    }
    const add = spawnSync(
      'vercel',
      ['env', 'add', 'WORKER_BEARER_TOKENS', target, '--force', '--sensitive'],
      { input: newValue, encoding: 'utf8' },
    );
    if (add.status !== 0) {
      fail(`vercel env add ${target} failed: ${add.stderr}`);
    }
    process.stdout.write(`OK Vercel ${target} updated.\n`);
  }
}

function persistTokenFile(email, t) {
  const dir = path.resolve('.tokens');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(dir, `${email}.txt`);
  fs.writeFileSync(tokenPath, `${t}\n`, { mode: 0o600 });
  fs.chmodSync(tokenPath, 0o600);
  process.stdout.write(`OK local backup: ${tokenPath}\n`);
}

function redeployProd() {
  process.stdout.write('Redeploying production so the new token map takes effect…\n');
  const result = spawnSync('vercel', ['--prod', '--yes'], { stdio: 'inherit' });
  if (result.status !== 0) fail('vercel --prod failed');
}

function print(email, t, isRevoke) {
  process.stdout.write('\n=================================\n');
  if (isRevoke) {
    process.stdout.write(`Revoked ${email} from WORKER_BEARER_TOKENS.\n`);
    process.stdout.write('Redeploy production for the change to take effect: vercel --prod --yes\n');
    return;
  }
  process.stdout.write(`Issued token for ${email}.\n\n`);
  process.stdout.write(`  Token: ${t}\n\n`);
  process.stdout.write('Next steps:\n');
  process.stdout.write('  1. Send to the AM via 1Password Send or Bitwarden Send (one-time view).\n');
  process.stdout.write('  2. Point them at docs/satya-handoff.md (or the AM-specific equivalent).\n');
  if (!skipVercel) {
    process.stdout.write('  3. Vercel env vars updated. Redeploy: vercel --prod --yes (or re-run with --redeploy)\n');
  }
}

function parseArgs(argv) {
  const out = {};
  const list = argv.slice(2);
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const next = list[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(a, name) {
  if (!a[name] || a[name] === true) fail(`Missing --${name}`);
  return a[name];
}

function shortFromEmail(email) {
  return String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}
