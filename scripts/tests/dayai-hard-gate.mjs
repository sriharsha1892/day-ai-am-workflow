// Day AI hard gate: when WORKER_BASE_URL is unset, every worker-* script must exit non-zero
// and produce a Red receipt with runStatus=blocked. No production progress allowed without worker.

import { test, assert } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
delete env.WORKER_BASE_URL;
delete env.WORKER_BEARER_TOKEN;
delete env.WORKER_LOCAL_MODE;

// Run from a clean cwd so the worker-client loadLocalEnv() can't repopulate from .env.local.
const tmpCwd = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'myra-hard-gate-'));
const scriptsDir = path.resolve('scripts');

const results = [];

for (const cmd of [
  ['node', path.join(scriptsDir, 'worker-resolve-identity.mjs'), '--account', 'X', '--domain', 'x.com'],
  ['node', path.join(scriptsDir, 'worker-freshsales-evidence.mjs'), '--domain', 'x.com'],
  ['node', path.join(scriptsDir, 'worker-apollo-search.mjs'), '--domain', 'x.com'],
]) {
  results.push(
    await test(`${path.basename(cmd[1])} blocks without worker config`, () => {
      const result = spawnSync(cmd[0], cmd.slice(1), { env, encoding: 'utf8', cwd: tmpCwd });
      assert.notEqual(result.status, 0, 'expected non-zero exit code');
      let parsed = null;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        assert.fail(`stdout was not JSON: ${result.stdout.slice(0, 200)}`);
      }
      assert.equal(parsed.ok, false);
      assert.equal(parsed.receiptColor, 'red');
      assert.equal(parsed.runStatus, 'blocked');
      assert.ok(parsed.reason?.toLowerCase().includes('worker'));
    }),
  );
}

fs.rmSync(tmpCwd, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
