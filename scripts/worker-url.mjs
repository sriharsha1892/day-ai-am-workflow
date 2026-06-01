// Single source of truth for the myRA worker URL. The default is the current production host —
// per CLAUDE.md it changes at team launch, so it lives in exactly one place. Override with
// WORKER_BASE_URL (whole host) or MCP_BASE (the /mcp endpoint). Lazy functions, not module-level
// constants, so callers that load .env.local AFTER import still pick up the override.

const DEFAULT_WORKER_BASE = 'https://myra-am-worker.vercel.app';

export function workerBaseUrl() {
  return (process.env.WORKER_BASE_URL ?? DEFAULT_WORKER_BASE).replace(/\/+$/, '');
}

export function workerMcpUrl() {
  return (process.env.MCP_BASE ?? `${workerBaseUrl()}/mcp`).replace(/\/+$/, '');
}

// True when neither override is set, i.e. we're falling back to the baked-in default host.
export function usingDefaultWorkerBase() {
  return !process.env.WORKER_BASE_URL && !process.env.MCP_BASE;
}
