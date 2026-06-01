#!/usr/bin/env node
//
// DEPRECATED (2026-06-01). myRA now connects to Codex through the hosted worker — a single remote
// MCP server ([mcp_servers.myra]) set up by the manual config snippet (scripts/make-am-config.mjs
// -> .tokens/myra-config-<am>.toml, pasted into ~/.codex/config.toml). This script used to run `codex mcp add day-ai`, which adds a DIRECT Day
// AI MCP server. That is no longer supported: a direct day-ai server bypasses the worker's
// idempotency key, approvedBy attribution, and pending-sync safeguards, and breaks "Day AI is the
// system of record by default". The installer comments out any such legacy block.
//
// This script intentionally NO LONGER adds a direct day-ai server. It only prints guidance.

console.log('npm run setup:codex is DEPRECATED and no longer configures anything.');
console.log('');
console.log('myRA connects through the hosted worker (the "myra" MCP server) — NOT a direct Day AI');
console.log('MCP server. A direct "day-ai" server bypasses the worker safeguards (idempotency,');
console.log('approvedBy attribution, pending-sync) and is no longer supported.');
console.log('');
console.log('  • To set up:  ask your admin for your myRA config snippet, paste it into ~/.codex/config.toml.');
console.log('  • To check an existing setup:  npm run doctor:codex');
console.log('');
process.exit(0);
