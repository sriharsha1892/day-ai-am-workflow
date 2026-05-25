#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const checks = [];

checks.push(checkFile('AGENTS.md'));
checks.push(checkFile('workflow/config/packs.json'));
checks.push(checkCommand('codex', ['--version'], 'Codex CLI'));
checks.push(checkCommand('codex', ['mcp', 'get', 'day-ai'], 'Day AI MCP'));

let ok = true;
for (const check of checks) {
  const status = check.ok ? 'OK' : 'FAIL';
  console.log(`${status}: ${check.label}`);
  if (!check.ok && check.detail) console.log(`  ${check.detail}`);
  ok = ok && check.ok;
}

if (!ok) {
  console.log('\nRun npm run setup:codex, then restart Codex or open a fresh session from this repo.');
  process.exit(1);
}

console.log('\nCodex workflow setup looks ready.');

function checkFile(path) {
  return {
    label: `${path} exists`,
    ok: fs.existsSync(path),
  };
}

function checkCommand(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  return {
    label,
    ok: result.status === 0,
    detail: result.stderr || result.stdout,
  };
}

