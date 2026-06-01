// Behavioral proof that the one-click installer keeps Day AI the system of record BY DEFAULT:
// when an AM's ~/.codex/config.toml already has a legacy DIRECT Day AI MCP block (from the old
// `codex mcp add day-ai`), the installer's config-merge must COMMENT IT OUT so the myRA worker is
// the sole Day AI path — while preserving the active [mcp_servers.myra] block, other servers, and
// the [windows] sandbox fix, and staying idempotent on re-run.
//
// This runs the ACTUAL PowerShell merge section extracted from templates/myra-setup.ps1.tmpl
// (not a reimplementation) via `pwsh`, so the test can't drift from what ships in the .cmd.
// If pwsh is unavailable, the test SKIPS (the offline guard in installer.mjs still asserts the
// neutralizer regex ships in the decoded payload).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, assert } from './lib.mjs';

const hasPwsh = spawnSync('pwsh', ['--version'], { encoding: 'utf8' }).status === 0;
if (!hasPwsh) {
  // No pwsh on this box: still give behavioral coverage by deriving the header-matcher from the
  // SHIPPED template regex and asserting it matches every legacy day-ai key form (bare / double- /
  // single-quoted) but NOT a similarly-named server. (The full merge is exercised where pwsh exists.)
  const tplRaw = fs.readFileSync(path.resolve('templates/myra-setup.ps1.tmpl'), 'utf8');
  const m = tplRaw.match(/\^\\\[mcp_servers\\\.(\(\?:[^)]*\))\\\]/);
  if (!m) {
    console.error('  FAIL  config-merge: could not extract the neutralizer alternation from the template');
    process.exit(1);
  }
  const alt = m[1].replace(/''/g, "'"); // PowerShell '' -> ' inside the single-quoted regex literal
  const headerRe = new RegExp('^\\[mcp_servers\\.' + alt + '\\]', 'm');
  let ok = true;
  for (const h of ['[mcp_servers.day-ai]', '[mcp_servers."day-ai"]', "[mcp_servers.'day-ai']"]) {
    if (!headerRe.test(h)) { console.error('  FAIL  neutralizer should match ' + h); ok = false; }
  }
  for (const h of ['[mcp_servers.day-ai-staging]', '[mcp_servers.myra]']) {
    if (headerRe.test(h)) { console.error('  FAIL  neutralizer should NOT match ' + h); ok = false; }
  }
  console.log(ok ? '  OK  (pwsh absent) neutralizer header-match coverage — bare/double/single-quoted' : '  FAIL  header-match coverage');
  process.exit(ok ? 0 : 1);
}

// Build a runnable PowerShell = the EXACT "# 2) Write / merge" section from the template,
// with the codex-check (step 1) and network verify (step 3) omitted.
const tpl = fs.readFileSync(path.resolve('templates/myra-setup.ps1.tmpl'), 'utf8');
const rendered = tpl
  .replaceAll('{{TOKEN}}', 'tok_test')
  .replaceAll('{{URL}}', 'https://worker.test')
  .replaceAll('{{EMAIL}}', 'a@b.com')
  .replaceAll('{{NAME}}', 'Tester');
const startIdx = rendered.indexOf('# 2) Write / merge');
const endIdx = rendered.indexOf('# 3) Verify');
if (startIdx < 0 || endIdx < 0) throw new Error('could not locate the merge section markers in the template');
const mergeSection = rendered.slice(startIdx, endIdx);
const runnable = `$ErrorActionPreference = 'Stop'\n$token = 'tok_test'\n$url   = 'https://worker.test'\n${mergeSection}`;

const psPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'myra-merge-')), 'merge.ps1');
fs.writeFileSync(psPath, runnable);

function freshHome(configToml) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myra-home-'));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), configToml);
  return home;
}
function runMerge(home) {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', psPath], {
    env: { ...process.env, USERPROFILE: home },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`pwsh merge failed: ${r.stderr || r.stdout}`);
  return fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').replace(/^﻿/, '');
}

const FIXTURE = [
  '[windows]',
  'sandbox = "unelevated"',
  '',
  '[mcp_servers.day-ai]',
  'url = "https://day.ai/api/mcp"',
  '',
  '[mcp_servers.myra]',
  'url = "https://old.example/mcp"',
  'http_headers = { Authorization = "Bearer old" }',
  '',
  '[mcp_servers.other]',
  'url = "https://other.test/mcp"',
  '',
].join('\r\n');

const results = [];

results.push(
  await test('legacy [mcp_servers.day-ai] is commented out; myRA worker becomes the sole Day AI path', () => {
    const out = runMerge(freshHome(FIXTURE));
    // legacy block neutralized: NO active day-ai header remains (every such line is "# "-prefixed)
    assert.ok(!/^\[mcp_servers\."?day-ai"?\]/m.test(out), 'no ACTIVE [mcp_servers.day-ai] header survives');
    assert.ok(out.includes('# [mcp_servers.day-ai]'), 'legacy header is commented out');
    assert.ok(out.includes('# url = "https://day.ai/api/mcp"'), 'legacy url line is commented out');
    assert.ok(out.includes('legacy direct Day AI MCP disabled'), 'stamps the disabled note');
    // exactly one ACTIVE myra block, pointing at the worker
    const activeMyra = (out.match(/^\[mcp_servers\.myra\]/gm) || []).length;
    assert.equal(activeMyra, 1, 'exactly one active [mcp_servers.myra] block');
    assert.ok(out.includes('url = "https://worker.test/mcp"'), 'active myra block points at the worker');
    assert.ok(!out.includes('https://old.example/mcp'), 'stale myra url is gone');
    // unrelated servers + sandbox fix preserved (boundary correctness)
    assert.ok(/^\[mcp_servers\.other\]/m.test(out), 'unrelated [mcp_servers.other] left intact');
    assert.ok(out.includes('sandbox = "unelevated"'), '[windows] sandbox fix intact');
  }),
);

results.push(
  await test('merge is idempotent — re-running converges (no double-comment, no duplicate myra)', () => {
    const home = freshHome(FIXTURE);
    const first = runMerge(home);
    const second = runMerge(home);
    assert.equal(second.trimEnd(), first.trimEnd(), 'second run is byte-identical to the first');
    assert.equal((second.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'still exactly one active myra block');
    assert.ok(!/^# # \[mcp_servers\.day-ai\]/m.test(second), 'legacy block is not double-commented');
  }),
);

results.push(
  await test('quoted hyphen-key form [mcp_servers."day-ai"] is also neutralized', () => {
    const quoted = ['[mcp_servers."day-ai"]', 'url = "https://day.ai/api/mcp"', ''].join('\r\n');
    const out = runMerge(freshHome(quoted));
    assert.ok(!/^\[mcp_servers\."day-ai"\]/m.test(out), 'no ACTIVE quoted day-ai header survives');
    assert.ok(out.includes('# [mcp_servers."day-ai"]'), 'quoted legacy header is commented out');
    assert.equal((out.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'worker block added');
  }),
);

results.push(
  await test('legacy day-ai block as the LAST section is neutralized (end-of-file boundary)', () => {
    const lastBlock = ['[windows]', 'sandbox = "unelevated"', '', '[mcp_servers.day-ai]', 'url = "https://day.ai/api/mcp"', ''].join('\r\n');
    const out = runMerge(freshHome(lastBlock));
    assert.ok(!/^\[mcp_servers\."?day-ai"?\]/m.test(out), 'no ACTIVE day-ai header at EOF survives');
    assert.ok(out.includes('# [mcp_servers.day-ai]'), 'EOF day-ai block is commented');
    assert.equal((out.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'worker block appended exactly once');
  }),
);

results.push(
  await test('similarly-named [mcp_servers.day-ai-staging] is NOT falsely neutralized', () => {
    const mixed = ['[mcp_servers.day-ai]', 'url = "https://day.ai/api/mcp"', '', '[mcp_servers.day-ai-staging]', 'url = "https://staging.day.ai/api/mcp"', ''].join('\r\n');
    const out = runMerge(freshHome(mixed));
    assert.ok(/^\[mcp_servers\.day-ai-staging\]/m.test(out), 'day-ai-staging stays ACTIVE (no false positive)');
    assert.ok(out.includes('# [mcp_servers.day-ai]'), 'the real day-ai block is commented');
    assert.ok(!out.includes('# [mcp_servers.day-ai-staging]'), 'day-ai-staging is not commented');
  }),
);

results.push(
  await test('LF-only line endings are handled (no stray CR, day-ai neutralized)', () => {
    const lf = ['[mcp_servers.day-ai]', 'url = "https://day.ai/api/mcp"', '', '[mcp_servers.other]', 'url = "https://other.test/mcp"', ''].join('\n');
    const out = runMerge(freshHome(lf));
    assert.ok(!/^\[mcp_servers\."?day-ai"?\]/m.test(out), 'LF-only day-ai header neutralized');
    assert.ok(/^\[mcp_servers\.other\]/m.test(out), 'LF-only other server intact');
    assert.equal((out.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'worker block added once');
  }),
);

results.push(
  await test("single-quoted literal key [mcp_servers.'day-ai'] is also neutralized", () => {
    const sq = ["[mcp_servers.'day-ai']", 'url = "https://day.ai/api/mcp"', '', '[mcp_servers.other]', 'url = "https://other.test/mcp"', ''].join('\r\n');
    const out = runMerge(freshHome(sq));
    assert.ok(!/^\[mcp_servers\.'day-ai'\]/m.test(out), 'no ACTIVE single-quoted day-ai header survives');
    assert.ok(out.includes("# [mcp_servers.'day-ai']"), 'single-quoted legacy header commented out');
    assert.ok(/^\[mcp_servers\.other\]/m.test(out), 'unrelated server intact');
    assert.equal((out.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'worker block added once');
  }),
);

results.push(
  await test('a re-introduced active day-ai block (stray setup:codex) is re-neutralized on next install', () => {
    const home = freshHome(FIXTURE);
    runMerge(home); // first install: legacy day-ai commented, worker block added
    // simulate something re-adding an ACTIVE direct day-ai server afterwards (the re-intro vector)
    fs.appendFileSync(path.join(home, '.codex', 'config.toml'), '\r\n[mcp_servers.day-ai]\r\nurl = "https://day.ai/api/mcp"\r\n');
    const out = runMerge(home); // re-running the installer must restore the SoR invariant
    assert.ok(!/^\[mcp_servers\."?day-ai"?\]/m.test(out), 'no ACTIVE day-ai header survives the next install');
    assert.equal((out.match(/^\[mcp_servers\.myra\]/gm) || []).length, 1, 'still exactly one worker block');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
