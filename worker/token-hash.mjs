// Single source of truth for hashing a bearer token at rest in KV. Used by api/mcp.mjs (verify),
// scripts/issue-am-token.mjs (write), and scripts/seed-tokens-to-kv.mjs (seed) so the KV key always
// matches — base64url SHA-256, the same scheme the OAuth broker uses (worker/oauth/broker.mjs).
// Key shape stored in KV: `am-token:${hashToken(token)}` -> amEmail.

import crypto from 'node:crypto';

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

export const amTokenKey = (token) => `am-token:${hashToken(token)}`;
