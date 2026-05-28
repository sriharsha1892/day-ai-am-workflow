#!/usr/bin/env node
// Test harness. Runs every script under scripts/tests/ in sequence, captures pass/fail counts,
// exits non-zero if anything failed. Each test script self-reports and exits 0/1.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testsDir = path.resolve('scripts/tests');
const tests = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs' && f !== 'lib.mjs')
  .sort();

console.log(`# myRA AM workflow tests`);
console.log(`Running ${tests.length} test file(s)\n`);

let failed = 0;
const summary = [];

for (const file of tests) {
  console.log(`-- ${file} --`);
  const start = Date.now();
  const result = spawnSync('node', [path.join(testsDir, file)], { stdio: 'inherit', encoding: 'utf8' });
  const ms = Date.now() - start;
  const ok = result.status === 0;
  if (!ok) failed += 1;
  summary.push({ file, ok, ms });
  console.log('');
}

console.log(`# Summary`);
for (const s of summary) {
  console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.file}  (${s.ms}ms)`);
}
console.log('');
console.log(`${summary.length - failed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);
