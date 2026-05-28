// Shared worker client. Loaded by every scripts/worker-*.mjs.
// Reads WORKER_BASE_URL and WORKER_BEARER_TOKEN from .env.local.
// Provides callWorker(action, payload), idempotency-key helpers, and stdout JSON receipt printing.

import crypto from 'node:crypto';
import { applyEnv, loadLocalEnv } from './env-utils.mjs';

applyEnv(loadLocalEnv('.env.local'));

const baseUrl = process.env.WORKER_BASE_URL;
const bearerToken = process.env.WORKER_BEARER_TOKEN;
const localMode = process.env.WORKER_LOCAL_MODE === '1';

export function workerConfigured() {
  return Boolean(baseUrl && bearerToken);
}

export function canonicalDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export function buildIdempotencyKey({ action, canonicalDomain: domain, extra = '' }) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const raw = [action, domain ?? 'no-domain', extra, dateKey].filter(Boolean).join('|');
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `${action}.${domain ?? 'no-domain'}.${dateKey}.${hash}`;
}

export async function callWorker(action, payload, options = {}) {
  if (!workerConfigured() && !localMode) {
    return failResult({
      action,
      reason:
        'Worker not configured: set WORKER_BASE_URL and WORKER_BEARER_TOKEN in .env.local. Run npm run secrets:set WORKER_BASE_URL.',
      payload,
    });
  }

  if (localMode) {
    return failResult({
      action,
      reason: 'WORKER_LOCAL_MODE=1 set. Worker calls are stubbed; use this only for dry-run development.',
      payload,
    });
  }

  const url = new URL(action, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const idempotencyKey = payload?.idempotencyKey ?? options.idempotencyKey;

  try {
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: options.method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }

    if (!response.ok) {
      return failResult({
        action,
        reason: `Worker responded ${response.status}: ${safeMessage(body)}`,
        idempotencyKey,
        body,
      });
    }

    return {
      ok: true,
      action,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKey,
      body,
    };
  } catch (error) {
    return failResult({
      action,
      reason: `Worker request failed: ${error instanceof Error ? error.message : String(error)}`,
      idempotencyKey,
    });
  }
}

export function emitReceipt(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function exitForResult(result) {
  emitReceipt(result);
  process.exit(result.ok ? 0 : 1);
}

export function parseArgs(argv) {
  const args = {};
  const list = argv.slice(2);
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = list[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else if (!args._positional) {
      args._positional = [token];
    } else {
      args._positional.push(token);
    }
  }
  return args;
}

export function requireArg(args, name) {
  const value = args[name];
  if (value === undefined || value === '' || value === true) {
    process.stderr.write(`Missing required --${name}\n`);
    process.exit(1);
  }
  return value;
}

function failResult({ action, reason, idempotencyKey, body, payload }) {
  return {
    ok: false,
    action,
    receiptColor: 'red',
    runStatus: 'blocked',
    headline: `Worker call failed for ${action}`,
    reason,
    retryPrompt: idempotencyKey
      ? `Retry pending Day AI sync for this account using the same idempotency key (${idempotencyKey}).`
      : 'Restore worker connectivity then retry.',
    idempotencyKey,
    body,
    payload,
  };
}

function safeMessage(body) {
  if (!body) return 'no body';
  if (body.message) return String(body.message).slice(0, 300);
  if (body.error) return String(body.error).slice(0, 300);
  return JSON.stringify(body).slice(0, 300);
}
