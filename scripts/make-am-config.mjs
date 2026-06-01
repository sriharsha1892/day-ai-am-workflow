#!/usr/bin/env node
// Generate an AM's manual Codex config snippet: .tokens/myra-config-<am>.toml — the [windows]
// sandbox fix + the [mcp_servers.myra] block with the AM's bearer token. The AM pastes it into
// ~/.codex/config.toml and restarts Codex. No installer/executable runs (AV/firewall friendly).
//
// The snippet contains the bearer token -> it is a SECRET. Written under .tokens/ (gitignored,
// 0600); deliver via 1Password Send, never email/Slack.
//
// Usage: node scripts/make-am-config.mjs --am satish@ask-myra.ai [--url <worker>] [--token <tok>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, loadLocalEnv, envPath } from './env-utils.mjs';
import { workerBaseUrl, usingDefaultWorkerBase } from './worker-url.mjs';

// Exported for tests: the config.toml blocks the AM pastes by hand.
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
    console.error('Missing --am <email>. e.g. node scripts/make-am-config.mjs --am satish@ask-myra.ai');
    process.exit(1);
  }
  const url = args.url ?? workerBaseUrl();
  if (!args.url && usingDefaultWorkerBase()) {
    console.warn(`WARNING: WORKER_BASE_URL is not set — using the default host ${url}. Set WORKER_BASE_URL if the worker lives elsewhere.`);
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
  const cfgPath = path.join(outDir, `myra-config-${slug}.toml`);
  fs.writeFileSync(cfgPath, buildConfigSnippet({ token, url }), { mode: 0o600 });
  fs.chmodSync(cfgPath, 0o600);
  console.log('OK config snippet written (SECRET — embeds the bearer token):');
  console.log(`   ${cfgPath}`);
  console.log(`\nShare it with ${amEmail} (1Password Send / secure). They paste the blocks into ~/.codex/config.toml and restart Codex.`);
}
