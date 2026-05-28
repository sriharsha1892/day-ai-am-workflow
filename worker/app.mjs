// Hono app definition. Imported by:
//   - worker/index.mjs (local dev: serves via @hono/node-server)
//   - api/[[...path]].mjs (Vercel: wraps in Node serverless handler)

import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { amEmailFor, bearerAuth } from './auth.mjs';
import { resolveIdentity } from './identity.mjs';
import {
  fetchFreshsalesEvidence,
  probe as freshsalesProbe,
} from './providers/freshsales.mjs';
import {
  apolloEnrich,
  apolloPeopleSearch,
  probe as apolloProbe,
} from './providers/apollo.mjs';
import { clearoutVerify, probe as clearoutProbe } from './providers/clearout.mjs';
import { dayAiWrite, probe as dayAiProbe } from './providers/day-ai.mjs';
import { buildReceipt } from './receipt.mjs';
import { lookupIdempotency, queuePendingSync } from './store.mjs';

// Local .env loader. On Vercel, env vars come from project settings — these reads are no-ops.
// Order: worker/.env (server-only overrides) → .env.local (admin creds shared with AM scripts).
for (const candidate of ['worker/.env', '.env.local']) {
  const p = path.resolve(candidate);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(sep + 1).replace(/^['"]|['"]$/g, '');
  }
}

export const app = new Hono();

app.get('/', (c) => c.json({ ok: true, service: 'myra-am-worker', version: '0.2.0' }));

app.get('/health', async (c) => {
  const [fs_, ap, cl, da] = await Promise.allSettled([
    freshsalesProbe(),
    apolloProbe(),
    clearoutProbe(),
    dayAiProbe(),
  ]);
  return c.json({
    ok: true,
    providers: {
      freshsales: summarizeProbe(fs_),
      apollo: summarizeProbe(ap),
      clearout: summarizeProbe(cl),
      dayAi: summarizeProbe(da),
    },
  });
});

app.use('/v1/*', bearerAuth());

app.post('/v1/identity/resolve', async (c) => {
  const body = await c.req.json();
  const result = await resolveIdentity(body);
  return c.json({
    ok: true,
    ...result,
    idempotencyKey: body.idempotencyKey,
    approvedBy: amEmailFor(c),
  });
});

app.post('/v1/freshsales/evidence', async (c) => {
  const body = await c.req.json();
  const result = await fetchFreshsalesEvidence(body);
  return c.json({ ok: true, ...result, approvedBy: amEmailFor(c) });
});

app.post('/v1/apollo/search', async (c) => {
  const body = await c.req.json();
  const result = await apolloPeopleSearch(body);
  return c.json({ ok: true, ...result, approvedBy: amEmailFor(c) });
});

app.post('/v1/apollo/enrich', async (c) => {
  const body = await c.req.json();
  const result = await apolloEnrich({ ...body, approvingAm: body.approvingAm ?? amEmailFor(c) });
  return c.json({ ok: true, ...result });
});

app.post('/v1/clearout/verify', async (c) => {
  const body = await c.req.json();
  const result = await clearoutVerify({ ...body, approvingAm: body.approvingAm ?? amEmailFor(c) });
  return c.json({ ok: true, ...result });
});

app.post('/v1/day-ai/write', async (c) => {
  const body = await c.req.json();
  const approvingAm = body.approvingAm ?? amEmailFor(c);
  try {
    const result = await dayAiWrite({ ...body, approvingAm });
    return c.json({ ok: true, ...result });
  } catch (error) {
    queuePendingSync({
      canonicalDomain: body.canonicalDomain,
      attemptedWrite: body.action,
      idempotencyKey: body.idempotencyKey,
      reason: error.message,
      approvingAm,
    });
    return c.json(
      {
        ok: false,
        receiptColor: 'red',
        runStatus: 'pending_sync',
        headline: `Day AI write failed for ${body.action}`,
        reason: error.message,
        retryPrompt: `Retry pending Day AI sync for this account using the same idempotency key (${body.idempotencyKey}).`,
        idempotencyKey: body.idempotencyKey,
      },
      502,
    );
  }
});

app.post('/v1/day-ai/lookup-idempotency', async (c) => {
  const body = await c.req.json();
  const prior = lookupIdempotency(body.idempotencyKey);
  return c.json({ ok: true, prior });
});

app.post('/v1/receipt/account', async (c) => {
  const body = await c.req.json();
  const approvingAm = body.approvingAm ?? amEmailFor(c);
  const receipt = await buildReceipt({ ...body, approvingAm });
  return c.json(receipt);
});

function summarizeProbe(settled) {
  if (settled.status === 'fulfilled') {
    return { ok: Boolean(settled.value?.ok), ...settled.value };
  }
  return { ok: false, reason: settled.reason?.message ?? String(settled.reason) };
}
