#!/usr/bin/env node
// Generate a ONE-double-click Windows installer (myra-setup-<am>.cmd) for an AM who has never used
// Codex. Double-clicking it: checks Codex, writes ~/.codex/config.toml (token + [windows]
// sandbox="unelevated"), and verifies against the worker — the AM never sees a token, TOML, or the
// sandbox error. The PowerShell is embedded as a base64 -EncodedCommand so there are zero quoting
// issues and corporate script-execution policy is bypassed for this one run.
//
// The .cmd contains the bearer token -> it is a SECRET. It is written under .tokens/ (gitignored,
// 0600); deliver it via 1Password Send (one-time view), never email/Slack.
//
// Usage: node scripts/make-am-installer.mjs --am satish@ask-myra.ai [--name Satish] [--url <worker>] [--token <tok>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, loadLocalEnv, envPath } from './env-utils.mjs';
import { workerBaseUrl, usingDefaultWorkerBase } from './worker-url.mjs';

const TEMPLATE = 'templates/myra-setup.ps1.tmpl';

// Exported for tests: returns the .cmd text + the interpolated PowerShell.
export function buildInstaller({ amEmail, token, url, name }) {
  const cleanUrl = String(url).replace(/\/+$/, '');
  const ps = fs
    .readFileSync(path.resolve(TEMPLATE), 'utf8')
    .replaceAll('{{TOKEN}}', token)
    .replaceAll('{{URL}}', cleanUrl)
    .replaceAll('{{EMAIL}}', amEmail)
    .replaceAll('{{NAME}}', name ?? amEmail.split('@')[0]);
  // PowerShell -EncodedCommand expects base64 of UTF-16LE.
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const cmd = [
    '@echo off',
    `title myRA setup - ${amEmail}`,
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    '',
  ].join('\r\n');
  return { cmd, ps, encoded };
}

function parseArgs(argv) {
  const out = {};
  const list = argv.slice(2);
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (!t.startsWith('--')) continue;
    const next = list[i + 1];
    if (!next || next.startsWith('--')) out[t.slice(2)] = true;
    else { out[t.slice(2)] = next; i += 1; }
  }
  return out;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  applyEnv(loadLocalEnv(envPath));
  const args = parseArgs(process.argv);
  const amEmail = args.am;
  if (!amEmail || amEmail === true) {
    console.error('Missing --am <email>. e.g. node scripts/make-am-installer.mjs --am satish@ask-myra.ai');
    process.exit(1);
  }
  const url = args.url ?? workerBaseUrl();
  if (!args.url && usingDefaultWorkerBase()) {
    console.warn(`WARNING: WORKER_BASE_URL is not set — building the installer against the default host ${url}. Set WORKER_BASE_URL if the worker lives elsewhere.`);
  }
  let token = typeof args.token === 'string' ? args.token : null;
  if (!token) {
    const tokenFile = path.resolve('.tokens', `${amEmail}.txt`);
    if (!fs.existsSync(tokenFile)) {
      console.error(`No token on file for ${amEmail}. First run:  npm run issue-am-token -- --am ${amEmail}`);
      process.exit(1);
    }
    token = fs.readFileSync(tokenFile, 'utf8').trim();
  }
  const { cmd } = buildInstaller({ amEmail, token, url, name: typeof args.name === 'string' ? args.name : undefined });
  const outDir = path.resolve('.tokens');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const slug = amEmail.split('@')[0].replace(/[^a-z0-9]/gi, '') || 'am';
  const outPath = path.join(outDir, `myra-setup-${slug}.cmd`);
  fs.writeFileSync(outPath, cmd, { mode: 0o600 });
  fs.chmodSync(outPath, 0o600);
  console.log('OK installer written (SECRET — it embeds the bearer token):');
  console.log(`   ${outPath}`);
  console.log(`\nSend it to ${amEmail} via 1Password Send (one-time). They double-click it — done.`);
}
