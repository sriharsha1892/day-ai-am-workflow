#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const checks = [];

checks.push(checkFile('AGENTS.md'));
checks.push(checkFile('workflow/config/packs.json'));
checks.push(checkCommand('codex', ['--version'], 'Codex CLI'));
checks.push(checkCommand('codex', ['mcp', 'get', 'myra'], 'myRA worker MCP server'));
checks.push(checkNoActiveDayAi());

let ok = true;
for (const check of checks) {
  const status = check.ok ? 'OK' : 'FAIL';
  console.log(`${status}: ${check.label}`);
  if (!check.ok && check.detail) console.log(`  ${check.detail}`);
  ok = ok && check.ok;
}

if (!ok) {
  console.log('\nRe-run your myRA one-click installer (myra-setup-<you>.cmd), then restart Codex or open a fresh session.');
  process.exit(1);
}

console.log('\nCodex workflow setup looks ready.');

function checkFile(path) {
  return {
    label: `${path} exists`,
    ok: fs.existsSync(path),
  };
}

// SoR-by-default: the worker must be the ONLY path to Day AI. A direct `day-ai` MCP server bypasses
// it, so its ABSENCE is the healthy state (the installer comments any legacy block out).
function checkNoActiveDayAi() {
  const result = spawnSync('codex', ['mcp', 'get', 'day-ai'], { encoding: 'utf8', stdio: 'pipe' });
  const present = result.status === 0;
  return {
    label: 'No direct day-ai MCP server (Day AI routes through the worker)',
    ok: !present,
    detail: present
      ? 'A direct "day-ai" MCP server is active — it bypasses the worker safeguards. Re-run your myRA installer to disable it.'
      : undefined,
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

