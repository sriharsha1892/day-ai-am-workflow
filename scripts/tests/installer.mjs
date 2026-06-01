// The one-click Windows installer generator: the .cmd must double-click cleanly and embed the
// correct PowerShell (token, worker URL, sandbox fix, verification) as a base64 EncodedCommand.

import { test, assert } from './lib.mjs';
import { buildInstaller } from '../../scripts/make-am-installer.mjs';

const results = [];

results.push(
  await test('buildInstaller emits a double-clickable .cmd with an EncodedCommand', () => {
    const { cmd } = buildInstaller({ amEmail: 'satish@ask-myra.ai', token: 'tok_demo_123', url: 'https://myra-am-worker.vercel.app/', name: 'Satish' });
    assert.ok(cmd.startsWith('@echo off'), 'cmd starts with @echo off (double-clickable)');
    assert.ok(/-ExecutionPolicy Bypass -EncodedCommand /.test(cmd), 'bypasses script policy via EncodedCommand');
    assert.ok(!/\n/.test(cmd.split('EncodedCommand ')[1].trim().split('\r\n')[0].replace(/=+$/, '')) , 'encoded command is one line');
  }),
);

results.push(
  await test('decoded PowerShell carries token + URL + sandbox fix + verification', () => {
    const { cmd } = buildInstaller({ amEmail: 'satish@ask-myra.ai', token: 'tok_demo_123', url: 'https://myra-am-worker.vercel.app', name: 'Satish' });
    const b64 = cmd.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
    const ps = Buffer.from(b64, 'base64').toString('utf16le');
    assert.ok(ps.includes('tok_demo_123'), 'token baked in');
    assert.ok(ps.includes('https://myra-am-worker.vercel.app'), 'worker url baked in');
    assert.ok(ps.includes('satish@ask-myra.ai'), 'AM email present');
    assert.ok(ps.includes('sandbox = "unelevated"'), 'pre-empts the admin-sandbox error');
    assert.ok(ps.includes('mcp_servers.myra'), 'writes the myra MCP server block');
    assert.ok(ps.includes('list_my_accounts'), 'verifies by listing accounts');
    const psCollapsed = ps.replace(/''/g, "'"); // simulate PowerShell collapsing '' -> ' in the regex literal
    assert.ok(psCollapsed.includes(`mcp_servers\\.(?:day-ai|"day-ai"|'day-ai')`), 'ships the broadened day-ai neutralizer (bare / double- / single-quoted keys)');
    assert.ok(ps.includes('legacy direct Day AI MCP disabled'), 'stamps the disabled note when commenting the legacy block');
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
