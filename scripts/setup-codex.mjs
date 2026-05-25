#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const serverName = 'day-ai';
const serverUrl = 'https://day.ai/api/mcp';

console.log('myRA AM Workflow: Codex setup');
console.log('--------------------------------');

const codexVersion = run('codex', ['--version'], { allowFailure: true });
if (codexVersion.status !== 0) {
  console.error('Codex CLI was not found. Install/open Codex first, then rerun npm run setup:codex.');
  process.exit(1);
}
process.stdout.write(codexVersion.stdout || '');

const existing = run('codex', ['mcp', 'get', serverName], { allowFailure: true });
if (existing.status !== 0) {
  console.log(`Adding Day AI MCP server: ${serverUrl}`);
  const added = run('codex', ['mcp', 'add', serverName, '--url', serverUrl], { allowFailure: true, inherit: true });
  if (added.status !== 0) {
    console.error('Failed to add Day AI MCP server. Run manually:');
    console.error(`codex mcp add ${serverName} --url ${serverUrl}`);
    process.exit(1);
  }
} else {
  console.log('Day AI MCP server already configured.');
}

console.log('\nStarting Day AI OAuth/login check.');
console.log('If a browser opens, sign in with your own Day AI account.');

const login = run('codex', ['mcp', 'login', serverName], { allowFailure: true, inherit: true });
if (login.status !== 0) {
  console.warn('\nLogin command did not complete cleanly. This can be okay if you are already authenticated.');
  console.warn('Run this manually if Day AI tools do not appear:');
  console.warn(`codex mcp login ${serverName}`);
}

const verify = run('codex', ['mcp', 'get', serverName], { allowFailure: true });
if (verify.status !== 0) {
  console.error('Day AI MCP verification failed.');
  process.exit(1);
}

console.log('\nDay AI MCP configuration:');
process.stdout.write(verify.stdout);
console.log('\nDone. Restart Codex or open a fresh Codex session from this repo folder.');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: false,
  });
}

