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
  // Delivery = a readable .ps1 + a TINY .cmd launcher that runs it.
  // WHY: the previous single `powershell -EncodedCommand <base64>` line was ~10 KB — over cmd.exe's
  // hard 8191-char line limit, so the .cmd silently failed to run ("nothing happens"). A tiny
  // launcher has no long line, and shipping the plain .ps1 (no base64/iex) is also less likely to
  // trip corporate AV and is inspectable. The two files travel together in the zip; the launcher
  // resolves the .ps1 next to itself via %~dp0.
  const slug = amEmail.split('@')[0].replace(/[^a-z0-9]/gi, '') || 'am';
  const psFileName = `myra-setup-${slug}.ps1`;
  const cmd = [
    '@echo off',
    `title myRA setup - ${amEmail}`,
    `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${psFileName}"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
  return { cmd, ps, psFileName };
}

// Manual onboarding (no .cmd, no executable) — for machines where AV/firewall blocks the installer.
// Returns the config.toml blocks the AM pastes by hand.
export function buildConfigSnippet({ token, url }) {
  const cleanUrl = String(url).replace(/\/+$/, '');
  return [
    '# myRA — paste these blocks into your Codex config file, then restart Codex.',
    '#   Windows:  %USERPROFILE%\\.codex\\config.toml   (e.g. C:\\Users\\You\\.codex\\config.toml)',
    '#   Mac:      ~/.codex/config.toml',
    '# If the file already exists, MERGE these in (keep any other [mcp_servers.*] you have).',
    '# If you see an old [mcp_servers.day-ai] block, delete it — myRA goes through the server below.',
    '',
    '[windows]',
    'sandbox = "unelevated"',
    '',
    '[mcp_servers.myra]',
    `url = "${cleanUrl}/mcp"`,
    `http_headers = { Authorization = "Bearer ${token}" }`,
    '',
  ].join('\n');
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
  const outDir = path.resolve('.tokens');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const slug = amEmail.split('@')[0].replace(/[^a-z0-9]/gi, '') || 'am';

  // Manual path (--manual / --config): emit a paste-able config.toml snippet, NO .cmd/.ps1. Use when
  // corporate AV/firewall blocks running the installer — manual setup runs no executable.
  if (args.manual || args.config) {
    const cfgPath = path.join(outDir, `myra-config-${slug}.toml`);
    fs.writeFileSync(cfgPath, buildConfigSnippet({ token, url }), { mode: 0o600 });
    fs.chmodSync(cfgPath, 0o600);
    console.log('OK manual config snippet written (SECRET — embeds the bearer token):');
    console.log(`   ${cfgPath}`);
    console.log(`\nShare it with ${amEmail} (1Password Send / secure). They paste the blocks into their Codex config.toml and restart Codex. No .cmd needed.`);
    process.exit(0);
  }

  const { cmd, ps, psFileName } = buildInstaller({ amEmail, token, url, name: typeof args.name === 'string' ? args.name : undefined });
  // The .ps1 (the actual script) and the .cmd launcher MUST ship together (zip both).
  const psPath = path.join(outDir, psFileName);
  fs.writeFileSync(psPath, ps, { mode: 0o600 });
  fs.chmodSync(psPath, 0o600);
  const outPath = path.join(outDir, `myra-setup-${slug}.cmd`);
  fs.writeFileSync(outPath, cmd, { mode: 0o600 });
  fs.chmodSync(outPath, 0o600);
  console.log('OK installer written (SECRET — embeds the bearer token). Two files, zip BOTH together:');
  console.log(`   ${outPath}`);
  console.log(`   ${psPath}`);
  console.log(`\nSend the zip to ${amEmail} via 1Password Send. They unzip (keep both files together) and double-click the .cmd.`);
}
