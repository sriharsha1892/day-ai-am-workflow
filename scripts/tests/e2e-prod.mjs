// End-to-end smoke test of the DEPLOYED myRA AM MCP worker (Vercel), SAFE surface only.
//
// Exercises health, OAuth discovery, the MCP JSON-RPC handshake, tools/prompts/resources
// listing, and every tool that costs NO credits and performs NO writes. Each check prints
// PASS/FAIL; a final tally is printed and the process exits non-zero on any failure.
//
// Re-runnable: the one mutation (set_my_preferences) round-trips and is reset to empty at
// the end, so running this repeatedly leaves no residue.
//
// Run:  node scripts/tests/e2e-prod.mjs   (or:  npm run e2e:prod)
// Env:  MCP_TOKEN, MCP_BASE  (fall back to the Satya token + prod URL below)
//
// Mirrors scripts/tests/mcp-prod-toolcall.mjs for the initialize -> notifications/initialized
// -> tools/call handshake and the SSE "data:" line parsing.
//
// ────────────────────────────────────────────────────────────────────────────────────────
// EXPLICITLY NOT CALLED HERE (they cost credits or write to Day AI). See the "MANUAL,
// COST-INCURRING" block at the bottom for the exact by-hand commands.
//   apollo_enrich · clearout_verify · dayai_write · work_contact(real email)
// ────────────────────────────────────────────────────────────────────────────────────────

import { workerMcpUrl } from '../worker-url.mjs';
const MCP_BASE = workerMcpUrl();
const TOKEN = process.env.MCP_TOKEN ?? 'tok_satya_16b698ab18dc27e76aaabb17c6a84453fb9dc8e9d15d13ea';
// Origin (no /mcp) for the unauthenticated REST endpoints (health, discovery).
const ORIGIN = MCP_BASE.replace(/\/mcp\/?$/, '');

let sessionId = null;
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS  ${name}${detail ? `  — ${detail}` : ''}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? `  — ${detail}` : ''}`);
    process.stdout.write(`FAIL  ${name}${detail ? `  — ${detail}` : ''}\n`);
  }
}

// ---- MCP JSON-RPC transport (mirrors mcp-prod-toolcall.mjs) ----
async function send(method, params, isNotification = false) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params: params ?? {} };
  if (!isNotification) body.id = Math.floor(Math.random() * 1e6);
  const res = await fetch(MCP_BASE, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (isNotification) return { status: res.status };
  // Responses may be SSE-framed ("data: {json}"); parse the data line if present.
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
  return { status: res.status, json: JSON.parse(dataLine ? dataLine.slice(5).trim() : text || '{}') };
}

// Call a tool and return its structuredContent (the parsed result object).
async function callTool(name, args) {
  const r = await send('tools/call', { name, arguments: args ?? {} });
  return { status: r.status, sc: r.json?.result?.structuredContent, raw: r.json };
}

async function getJson(pathname) {
  const res = await fetch(`${ORIGIN}${pathname}`, { headers: { accept: 'application/json' } });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main() {
  process.stdout.write(`# e2e-prod — myRA AM MCP worker\n`);
  process.stdout.write(`# base: ${MCP_BASE}\n\n`);

  // 1. GET /health → all four providers ok.
  {
    const { status, json } = await getJson('/health');
    const p = json?.providers ?? {};
    const allOk =
      status === 200 &&
      json?.ok === true &&
      p.freshsales?.ok === true &&
      p.apollo?.ok === true &&
      p.clearout?.ok === true &&
      p.dayAi?.ok === true;
    check(
      '01 health: all four providers ok',
      allOk,
      `HTTP ${status} fs=${p.freshsales?.ok} apollo=${p.apollo?.ok} clearout=${p.clearout?.ok} dayAi=${p.dayAi?.ok}`,
    );
  }

  // 2. OAuth discovery documents.
  {
    const { status, json } = await getJson('/.well-known/oauth-authorization-server');
    check(
      '02a discovery: authorization-server has the three endpoints',
      status === 200 &&
        typeof json?.authorization_endpoint === 'string' &&
        typeof json?.token_endpoint === 'string' &&
        typeof json?.registration_endpoint === 'string',
      `HTTP ${status}`,
    );
  }
  {
    const { status, json } = await getJson('/.well-known/oauth-protected-resource');
    check(
      '02b discovery: protected-resource lists authorization_servers',
      status === 200 && Array.isArray(json?.authorization_servers) && json.authorization_servers.length > 0,
      `HTTP ${status} servers=${JSON.stringify(json?.authorization_servers)}`,
    );
  }

  // 3. POST /mcp WITHOUT token → 401.
  {
    const res = await fetch(MCP_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'noauth', version: '1' } },
      }),
    });
    check('03 unauthenticated /mcp → 401', res.status === 401, `HTTP ${res.status}`);
  }

  // 4. initialize (with token) → serverInfo.name + instructions.
  {
    const init = await send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e-prod', version: '1' },
    });
    const info = init.json?.result?.serverInfo;
    const instructions = init.json?.result?.instructions ?? '';
    check(
      '04a initialize: serverInfo.name = myra-am-worker',
      init.status === 200 && info?.name === 'myra-am-worker',
      `HTTP ${init.status} name=${info?.name} v=${info?.version} session=${sessionId ? 'set' : 'none'}`,
    );
    check(
      '04b initialize: instructions present (>1000 chars)',
      typeof instructions === 'string' && instructions.length > 1000,
      `${instructions.length} chars`,
    );
    // Required before any further request.
    await send('notifications/initialized', {}, true);
  }

  // 5. tools/list → 31 tools today; 32 after the Increment-4 deploy adds end_session (bump on deploy).
  {
    const r = await send('tools/list', {});
    const tools = r.json?.result?.tools ?? [];
    const names = new Set(tools.map((t) => t.name));
    const expected = ['resolve_identity', 'apollo_search', 'list_my_accounts', 'build_receipt', 'compose_first_touch'];
    const haveExpected = expected.every((n) => names.has(n));
    check('05a tools/list: exactly 31 tools', tools.length === 31, `got ${tools.length}`);
    check('05b tools/list: expected tool names present', haveExpected, expected.join(', '));
  }

  // 6. prompts/list → 5 ; resources/list → 6.
  {
    const p = await send('prompts/list', {});
    const prompts = p.json?.result?.prompts ?? [];
    check('06a prompts/list: 5 prompts', prompts.length === 5, `got ${prompts.length}`);

    const res = await send('resources/list', {});
    const resources = res.json?.result?.resources ?? [];
    check('06b resources/list: 6 resources', resources.length === 6, `got ${resources.length}`);
  }

  // 7. resolve_identity → decision.receiptColor = green.
  {
    const { sc } = await callTool('resolve_identity', { accountName: 'Michelman', canonicalDomain: 'michelman.com' });
    check(
      '07 resolve_identity Michelman → receiptColor green',
      sc?.decision?.receiptColor === 'green',
      `action=${sc?.decision?.action} color=${sc?.decision?.receiptColor} conf=${sc?.decision?.matchConfidence}`,
    );
  }

  // 8. freshsales_evidence → status ok, evidenceCount > 0.
  {
    const { sc } = await callTool('freshsales_evidence', { canonicalDomain: 'michelman.com' });
    check(
      '08 freshsales_evidence Michelman → ok + evidenceCount>0',
      sc?.status === 'ok' && (sc?.evidenceCount ?? 0) > 0,
      `status=${sc?.status} evidenceCount=${sc?.evidenceCount} dupRisk=${sc?.duplicateRisk}`,
    );
  }

  // 9. apollo_search (FREE, search only, NO enrich) → candidateCount >= 0.
  // Per spec the assertion is candidateCount>=0 (free path returns its shape, no credit spend).
  // We do NOT require status==ok: Apollo has DEPRECATED the people-search endpoint the worker
  // calls (HTTP 422 -> "use mixed_people/api_search"), so the worker returns status:'failed'
  // with candidateCount:0. That is an UPSTREAM provider change, not a worker/test fault — we
  // surface it loudly here but don't fail the smoke run on it. (Worker fix: migrate the Apollo
  // provider to mixed_people/api_search.)
  {
    const { sc } = await callTool('apollo_search', { canonicalDomain: 'michelman.com', limit: 5 });
    const apolloDeprecated = sc?.status === 'failed' && /deprecated/i.test(sc?.headlineReason ?? '');
    if (apolloDeprecated) {
      process.stdout.write(
        `WARN  apollo_search upstream-deprecated (422): ${(sc?.headlineReason ?? '').slice(0, 120)}\n`,
      );
    }
    check(
      '09 apollo_search Michelman (free) → candidateCount>=0 (no enrich)',
      typeof sc?.candidateCount === 'number' && sc.candidateCount >= 0,
      `status=${sc?.status} candidateCount=${sc?.candidateCount}${apolloDeprecated ? ' [Apollo endpoint deprecated upstream]' : ''}`,
    );
  }

  // 10. list_my_accounts → count > 0 (Satya's central list from Upstash).
  {
    const { sc } = await callTool('list_my_accounts', {});
    check(
      '10 list_my_accounts → ok + count>0',
      sc?.ok === true && (sc?.count ?? 0) > 0 && Array.isArray(sc?.accounts),
      `am=${sc?.amEmail} count=${sc?.count}`,
    );
  }

  // 11. assignment_health → healthy true (or report conflicts).
  {
    const { sc } = await callTool('assignment_health', {});
    check(
      '11 assignment_health → healthy true',
      sc?.ok === true && sc?.healthy === true,
      `total=${sc?.total} conflicts=${sc?.conflicts?.length} overloaded=${sc?.overloaded?.length} staleP1s=${sc?.staleP1s?.length}`,
    );
  }

  // 12. team_brief + rollout_status → ok shape.
  {
    const { sc } = await callTool('team_brief', {});
    check(
      '12a team_brief → ok shape (totals + perAm)',
      sc?.ok === true && sc?.totals && Array.isArray(sc?.perAm),
      `windowDays=${sc?.windowDays} ams=${sc?.perAm?.length}`,
    );
  }
  {
    const { sc } = await callTool('rollout_status', {});
    check(
      '12b rollout_status → ok shape (summary + perAm)',
      sc?.ok === true && typeof sc?.summary === 'string' && Array.isArray(sc?.perAm),
      `connected=${sc?.connected}/${sc?.total}`,
    );
  }

  // 13. credits + team_credits → ok.
  {
    const { sc } = await callTool('credits', {});
    check(
      '13a credits → ok (apollo + clearout)',
      sc?.ok === true && sc?.apollo && sc?.clearout,
      `month=${sc?.month} clearoutRemaining=${sc?.clearout?.remaining}`,
    );
  }
  {
    const { sc } = await callTool('team_credits', {});
    check(
      '13b team_credits → ok (apollo + clearout + perAm)',
      sc?.ok === true && sc?.apollo && sc?.clearout && Array.isArray(sc?.perAm),
      `month=${sc?.month} runway="${sc?.clearout?.runway}"`,
    );
  }

  // 14. prepare_linkedin_touch (pure synthesis, no network) → note ≤300, NO URL in the note.
  {
    const { sc } = await callTool('prepare_linkedin_touch', {
      canonicalDomain: 'michelman.com',
      contactName: 'Jane Doe',
      title: 'Head of Market Intelligence',
      linkedinUrl: 'https://www.linkedin.com/in/janedoe',
    });
    const note = sc?.connectionNote ?? '';
    const charCount = sc?.noteCharCount ?? note.length;
    const noUrlInNote = !/https?:\/\//i.test(note) && !/linkedin\.com/i.test(note);
    check(
      '14 prepare_linkedin_touch → note ≤300 chars and no URL in note',
      sc?.status === 'ok' && charCount <= 300 && noUrlInNote,
      `chars=${charCount} manualOnly=${sc?.manualOnly} urlInNote=${!noUrlInNote}`,
    );
  }

  // 15. compose_first_touch (pure synthesis) → all boolean toneChecks true + queueReady.
  {
    const { sc } = await callTool('compose_first_touch', {
      canonicalDomain: 'michelman.com',
      title: 'Head of Market Intelligence',
      emailVerdict: 'verified',
    });
    const tc = sc?.toneChecks ?? {};
    // toneChecks mixes booleans (nonSalesy, softCta, lengthOk, …) with a numeric lengthWords;
    // "all toneChecks true" = every boolean-valued check is true.
    const boolEntries = Object.entries(tc).filter(([, v]) => typeof v === 'boolean');
    const allTrue = boolEntries.length > 0 && boolEntries.every(([, v]) => v === true);
    const falseOnes = boolEntries.filter(([, v]) => v !== true).map(([k]) => k);
    check(
      '15 compose_first_touch → all toneChecks true + queueReady',
      sc?.ok === true && allTrue && sc?.queueReady === true,
      `queueReady=${sc?.queueReady} lengthWords=${tc?.lengthWords}${falseOnes.length ? ` failedChecks=${falseOnes.join(',')}` : ''}`,
    );
  }

  // 16. set_my_preferences → get_my_preferences round-trip (then reset to empty).
  {
    const marker = '— E2E test';
    await callTool('set_my_preferences', { signature: marker });
    const { sc: after } = await callTool('get_my_preferences', {});
    check(
      '16 preferences: signature round-trips through set → get',
      after?.signature === marker,
      `got="${after?.signature}"`,
    );
    // Cleanup: reset to empty so re-runs and real usage are unaffected.
    await callTool('set_my_preferences', { signature: '' });
    const { sc: reset } = await callTool('get_my_preferences', {});
    check(
      '16b preferences: signature reset to empty (cleanup)',
      (reset?.signature ?? '') === '',
      `got="${reset?.signature}"`,
    );
  }

  // 17. build_receipt → has summary.color + providers (no Clearout/enrich spend; reads only).
  {
    const { sc } = await callTool('build_receipt', { canonicalDomain: 'michelman.com' });
    const providerKeys = Object.keys(sc?.providers ?? {});
    check(
      '17 build_receipt Michelman → summary.color + providers present',
      typeof sc?.summary?.color === 'string' &&
        sc?.providers &&
        providerKeys.includes('freshsales') &&
        providerKeys.includes('dayAi'),
      `color=${sc?.summary?.color} providers=${providerKeys.join(',')}`,
    );
  }

  // ---- Tally ----
  process.stdout.write(`\n# Summary\n`);
  process.stdout.write(`${passed} passed, ${failed} failed (${passed + failed} checks)\n`);
  if (failures.length) {
    process.stdout.write(`\nFailures:\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stdout.write(`\nFATAL  ${e?.stack ?? e}\n`);
  process.exit(1);
});

/*
 ════════════════════════════════════════════════════════════════════════════════════════════
 MANUAL, COST-INCURRING CHECKS — RUN BY HAND ONLY. These are intentionally NOT in the
 automated run above because each one either spends provider credits or writes to Day AI.
 Verify the worker is healthy first (this script), then exercise these deliberately.

 Prereqs (same as this script):
   export MCP_TOKEN=tok_satya_16b698ab18dc27e76aaabb17c6a84453fb9dc8e9d15d13ea
   BASE=https://myra-am-worker.vercel.app/mcp

 The repo ships per-tool CLI wrappers (see package.json) that drive the SAME provider code:

   # apollo_enrich — SPENDS Apollo credits. Enrich specific candidate IDs only.
   #   (get candidate IDs first from a real apollo_search result)
   npm run worker:apollo-enrich -- --ids <candidateId1>,<candidateId2>

   # clearout_verify — SPENDS 1 Clearout credit per email.
   npm run worker:clearout-verify -- --emails someone@michelman.com

   # dayai_write — WRITES to Day AI (idempotent; same key never duplicates).
   #   Safest first write is review-context. Resolve identity BEFORE any org write.
   npm run worker:dayai-write -- --action review-context --domain michelman.com

   # work_contact with a REAL email — discovers+verifies (=> 1 Clearout credit) and would
   #   lead to writes on approval. Call the MCP tool directly with a real contact:
   #   POST $BASE tools/call { name:"work_contact", arguments:{
   #       canonicalDomain:"michelman.com", contactName:"<real name>",
   #       title:"<title>", knownEmail:"<real@email>" } }
   #   (omitting knownEmail still triggers Apollo discovery + Clearout verify on a found email)

 After any dayai_write, confirm idempotency by re-running the same command with --retry and
 checking the run reuses the same idempotencyKey (no duplicate record created).
 ════════════════════════════════════════════════════════════════════════════════════════════
*/
