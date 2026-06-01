// The AM manual-config generator: the snippet must carry the myra server block (URL + /mcp),
// the bearer token in the auth header, and the Windows sandbox fix.

import { test, assert } from './lib.mjs';
import { buildConfigSnippet } from '../../scripts/make-am-config.mjs';

const results = [];

results.push(
  await test('buildConfigSnippet emits the myra server block + sandbox fix + token', () => {
    const snip = buildConfigSnippet({ token: 'tok_demo_123', url: 'https://myra-am-worker.vercel.app/' });
    assert.ok(snip.includes('[mcp_servers.myra]'), 'myra server block');
    assert.ok(snip.includes('url = "https://myra-am-worker.vercel.app/mcp"'), 'normalized url + /mcp (no //)');
    assert.ok(snip.includes('Authorization = "Bearer tok_demo_123"'), 'token in the auth header');
    assert.ok(snip.includes('sandbox = "unelevated"'), 'sandbox fix included');
    assert.ok(snip.includes('[mcp_servers.day-ai]'), 'reminds the AM to delete any legacy day-ai block');
  }),
);

results.push(
  await test('trailing slashes in the url are normalized', () => {
    const snip = buildConfigSnippet({ token: 't', url: 'https://x.app///' });
    assert.ok(snip.includes('url = "https://x.app/mcp"'), 'no // before /mcp');
  }),
);

const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);
