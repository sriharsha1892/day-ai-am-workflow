// Converts the "Day AI is system of record by default" policy into a regression GATE: no script may
// re-introduce a direct day-ai MCP server (the path that bypasses the worker's idempotency /
// approvedBy / pending-sync safeguards), and the doctor must verify the worker is present and a
// direct day-ai server is absent. Complements config-merge.mjs (which proves the installer comments
// any legacy block out).

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from './lib.mjs';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const results = [];

results.push(
  await test('setup-codex.mjs no longer RUNS `codex mcp add` (deprecated to a notice)', () => {
    const s = read('scripts/setup-codex.mjs');
    assert.ok(!/(spawnSync|run)\(\s*['"]codex['"]\s*,\s*\[\s*['"]mcp['"]\s*,\s*['"]add['"]/.test(s), 'must not spawn `codex mcp add ...`');
  }),
);

results.push(
  await test('no active `codex mcp add day-ai` anywhere in scripts/ (comments allowed)', () => {
    const offenders = [];
    for (const file of fs.readdirSync(path.resolve('scripts')).filter((f) => f.endsWith('.mjs'))) {
      const lines = read(path.join('scripts', file)).split('\n');
      lines.forEach((ln, i) => {
        if (ln.trim().startsWith('//')) return; // comment / deprecation note
        if (/\bmcp['"\s,]+add\b/.test(ln) && /day-ai/.test(ln)) offenders.push(`scripts/${file}:${i + 1}`);
      });
    }
    assert.equal(offenders.length, 0, `active day-ai add found: ${offenders.join(', ')}`);
  }),
);

results.push(
  await test('doctor verifies the myRA worker is present AND a direct day-ai server is absent', () => {
    const d = read('scripts/check-codex-setup.mjs');
    assert.ok(/['"]mcp['"]\s*,\s*['"]get['"]\s*,\s*['"]myra['"]/.test(d), 'doctor checks the myra worker server');
    assert.ok(/checkNoActiveDayAi/.test(d), 'doctor checks for absence of an active day-ai server');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
