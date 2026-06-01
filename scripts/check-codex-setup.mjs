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
  console.log('\nPaste your myRA config snippet into ~/.codex/config.toml (see docs/am-onboarding-manual.md), then restart Codex.');
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
// it, so its ABSENCE is the healthy state (onboarding adds only the myra block; delete any legacy day-ai block by hand).
function checkNoActiveDayAi() {
  const result = spawnSync('codex', ['mcp', 'get', 'day-ai'], { encoding: 'utf8', stdio: 'pipe' });
  const present = result.status === 0;
  return {
    label: 'No direct day-ai MCP server (Day AI routes through the worker)',
    ok: !present,
    detail: present
      ? 'A direct "day-ai" MCP server is active — it bypasses the worker safeguards. Delete the [mcp_servers.day-ai] block from ~/.codex/config.toml.'
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

