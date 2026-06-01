// The one-click Windows installer generator. Delivery = a readable .ps1 + a tiny .cmd launcher.
// The .cmd MUST have no line near cmd.exe's hard 8191-char limit (the old single base64
// -EncodedCommand line was ~10 KB and silently failed to run — "none of the CMD files open").

import { test, assert } from './lib.mjs';
import { buildInstaller } from '../../scripts/make-am-installer.mjs';

const results = [];

results.push(
  await test('buildInstaller emits a double-clickable .cmd launcher with NO over-limit line', () => {
    const { cmd, psFileName } = buildInstaller({ amEmail: 'satish@ask-myra.ai', token: 'tok_demo_123', url: 'https://myra-am-worker.vercel.app/', name: 'Satish' });
    assert.ok(cmd.startsWith('@echo off'), 'cmd starts with @echo off (double-clickable)');
    assert.ok(cmd.includes(`-ExecutionPolicy Bypass -File "%~dp0${psFileName}"`), 'launches the sibling .ps1 with policy bypass');
    // THE regression guard for the "none of the CMD files open" bug: cmd.exe's hard line limit is 8191.
    for (const line of cmd.split('\r\n')) {
      assert.ok(line.length < 8000, `every .cmd line must stay well under cmd.exe's 8191 limit (saw ${line.length})`);
    }
  }),
);

results.push(
  await test('the .ps1 carries token + URL + sandbox fix + verification + day-ai neutralizer', () => {
    const { ps } = buildInstaller({ amEmail: 'satish@ask-myra.ai', token: 'tok_demo_123', url: 'https://myra-am-worker.vercel.app', name: 'Satish' });
    assert.ok(ps.includes('tok_demo_123'), 'token baked in');
    assert.ok(ps.includes('https://myra-am-worker.vercel.app'), 'worker url baked in');
    assert.ok(ps.includes('satish@ask-myra.ai'), 'AM email present');
    assert.ok(ps.includes('sandbox = "unelevated"'), 'pre-empts the admin-sandbox error');
    assert.ok(ps.includes('mcp_servers.myra'), 'writes the myra MCP server block');
    assert.ok(ps.includes('list_my_accounts'), 'verifies by listing accounts');
    const psCollapsed = ps.replace(/''/g, "'");
    assert.ok(psCollapsed.includes(`mcp_servers\\.(?:day-ai|"day-ai"|'day-ai')`), 'ships the broadened day-ai neutralizer (Day AI SoR by default)');
    assert.ok(ps.includes('legacy direct Day AI MCP disabled'), 'stamps the disabled note');
    assert.ok(!ps.includes('{{'), 'no unresolved template placeholders');
  }),
);

results.push(
  await test('trailing slash in url is normalized (no // before /mcp)', () => {
    const { ps } = buildInstaller({ amEmail: 'a@b.com', token: 't', url: 'https://x.app///' });
    assert.ok(ps.includes("$url   = 'https://x.app'"), 'url trimmed of trailing slashes');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
