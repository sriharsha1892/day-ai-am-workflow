// myRA AM workflow as an MCP server. Codex connects natively:
//   codex mcp add myra --url https://myra-am-worker.vercel.app/mcp
//   codex mcp login myra
//
// This module defines initializeServer(server) + serverOptions for mcp-handler.
// Tools are thin wrappers over the SAME provider functions the REST worker uses
// (worker/identity.mjs, worker/providers/*, worker/receipt.mjs) — no logic rewrite.
// The AM's identity comes from the authenticated request (extra.authInfo.extra.amEmail),
// set by the verifyToken in api/mcp.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { resolveIdentity } from './identity.mjs';
import { fetchFreshsalesEvidence, probe as freshsalesProbe } from './providers/freshsales.mjs';
import { apolloPeopleSearch, apolloEnrich, probe as apolloProbe } from './providers/apollo.mjs';
import { clearoutVerify, probe as clearoutProbe } from './providers/clearout.mjs';
import { dayAiWrite, probe as dayAiProbe } from './providers/day-ai.mjs';
import { buildReceipt } from './receipt.mjs';
import {
  getTourState,
  setTourState,
  markStation,
  nextResume,
} from './state.mjs';
import {
  listMyAccounts,
  getAccount,
  assignAccounts,
  unassignAccount,
  listAllAssignments,
} from './accounts.mjs';
import { teamBrief, assignmentHealth, rolloutStatus } from './insights.mjs';

// Local .env loader (no-op on Vercel where env is injected). Mirrors worker/app.mjs.
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

// Condensed AGENTS.md playbook. Codex reads this on connect (MCP `instructions`)
// and treats it as system-wide guidance — no repo clone needed.
export const INSTRUCTIONS = `# myRA AM Workflow (via MCP)

You are the guided execution surface for a myRA Account Manager. Day AI is the system of record. You operate by calling this server's tools; you never invent provider data.

## How to work
- The AM talks to you in plain language ("research Michelman", "find contacts", "build a cadence", "what's saved?"). Map intent to the right tools and prompts.
- Account identity is DOMAIN-FIRST. Always resolve identity (resolve_identity) before any Day AI Organization write.
- Present receipts as a 3-4 sentence plain-English narrative followed by four color-coded bullets (Freshsales / Apollo / Clearout / Day AI). Default coaching = decision + one-line reason; expand full evidence only on Yellow/Red or when the AM asks "show details".

## Non-negotiables
- Day AI is canonical for account state, contacts, tasks, drafts, ledger, health.
- Freshsales is READ-ONLY.
- Every Day AI write carries an idempotency key and is attributed to the signed-in AM (approvedBy). Retries reuse the same key — never create duplicates.
- AM approval is required before: canonical contact creation, external sends, lifecycle changes after intake.
- If a tool fails, show a Red receipt with the exact failure and offer retry or abandon. Never silently retry with a new key.

## Contact selection (map_contacts / source_new_contacts)
Present Recommended candidates as a pre-approved batch by name (AM can veto any by name), walk Maybe one at a time, skip Hold unless the AM asks. Numbered selection ("select 1, 3, 7") works at any prompt.

## Cadence (build_cadence)
Resolve the persona/cadence/channel packs, then walk each step's fields in sequence (channel? timing? tone? CTA?), accept "keep" for defaults, render a numbered preview, then write Actions + Drafts on approval.

## Cross-session
On a fresh session, call next_resume to find the AM's highest-priority unfinished account and offer to continue it. On "bye"/"wrap up", summarize the session.

Keep every recommendation grounded in myRA positioning: decision-grade, expert-validated market/competitor/customer/supplier/trend intelligence.`;

export const serverOptions = {
  serverInfo: { name: 'myra-am-worker', version: '0.3.0' },
  instructions: INSTRUCTIONS,
};

// Pull the signed-in AM email out of the MCP request's auth context.
function amEmailFrom(extra, fallback) {
  return (
    extra?.authInfo?.extra?.amEmail ??
    extra?.authInfo?.clientId ??
    fallback ??
    'unknown@ask-myra.ai'
  );
}

// The Day AI refresh token for the signed-in AM (set by the OAuth broker), so writes
// are attributed to the AM. Undefined → provider falls back to the shared token.
function dayAiTokenFrom(extra) {
  return extra?.authInfo?.extra?.dayAiRefreshToken;
}

function ok(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function fail(message, extra = {}) {
  const body = { ok: false, receiptColor: 'red', error: message, ...extra };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  };
}

const CONFIG_FILES = {
  'myra-context': 'workflow/config/myra-context.json',
  packs: 'workflow/config/packs.json',
  'ux-guidance': 'workflow/config/ux-guidance.json',
  'org-resolution': 'workflow/config/org-resolution.json',
  'contact-sourcing': 'workflow/config/contact-sourcing.json',
};

export function initializeServer(server) {
  // ---- Tools (wrap existing provider functions) ----

  server.registerTool(
    'resolve_identity',
    {
      description:
        'Domain-first account identity resolution. Returns the 6-tier decision (auto_link_existing … block_org_creation_create_review_context) with candidate evidence from Day AI, Freshsales, and Apollo. Call before any Day AI Organization write.',
      inputSchema: {
        accountName: z.string(),
        canonicalDomain: z.string(),
        ownerEmail: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        parentCompany: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await resolveIdentity({
          ...args,
          idempotencyKey: `resolve-identity.${args.canonicalDomain}.${new Date().toISOString().slice(0, 10)}`,
        });
        return ok({ ...result, approvedBy: amEmailFrom(extra, args.ownerEmail) });
      } catch (e) {
        return fail(`resolve_identity failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'freshsales_evidence',
    {
      description:
        'Read-only Freshsales CRM evidence for an account: existing sales accounts, contacts, deals. Sets duplicate-risk. Freshsales is never written to.',
      inputSchema: {
        canonicalDomain: z.string(),
        accountName: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        maxRecords: z.number().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await fetchFreshsalesEvidence(args);
        return ok({ ...result, approvedBy: amEmailFrom(extra) });
      } catch (e) {
        return fail(`freshsales_evidence failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'apollo_search',
    {
      description:
        'Net-new contact sourcing via Apollo, persona-aware. Returns ≤25 candidates tiered Recommended/Maybe/Hold. No credit cost (search only). Enrichment/verification are separate, AM-approved steps.',
      inputSchema: {
        canonicalDomain: z.string(),
        personaPack: z.string().optional(),
        targetRoleBuckets: z.array(z.string()).optional(),
        titleKeywords: z.array(z.string()).optional(),
        limit: z.number().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await apolloPeopleSearch(args);
        return ok({ ...result, approvedBy: amEmailFrom(extra) });
      } catch (e) {
        return fail(`apollo_search failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'apollo_enrich',
    {
      description:
        'Selective Apollo enrichment for AM-selected candidate IDs only. Consumes Apollo credits — only call after the AM picks candidates and approves the spend.',
      inputSchema: {
        candidateIds: z.array(z.string()),
      },
    },
    async (args, extra) => {
      try {
        const result = await apolloEnrich({ ...args, approvingAm: amEmailFrom(extra) });
        return ok(result);
      } catch (e) {
        return fail(`apollo_enrich failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'clearout_verify',
    {
      description:
        'Clearout email verification for AM-selected emails only. Consumes Clearout credits. Returns verified/risky/invalid counts.',
      inputSchema: {
        emails: z.array(z.string()),
        reason: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await clearoutVerify({ ...args, approvingAm: amEmailFrom(extra) });
        return ok(result);
      } catch (e) {
        return fail(`clearout_verify failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'dayai_write',
    {
      description:
        'Production Day AI write. action one of: org-link | org-create | opportunity-create | person-dedupe-check | person-create | action-create | draft-create | review-context. Requires AM approval upstream. Idempotency key reused on retry — never creates duplicates. Attributed to the signed-in AM.',
      inputSchema: {
        action: z.enum([
          'org-link',
          'org-create',
          'opportunity-create',
          'person-dedupe-check',
          'person-create',
          'action-create',
          'draft-create',
          'review-context',
        ]),
        canonicalDomain: z.string(),
        idempotencyKey: z.string().optional(),
        retry: z.boolean().optional(),
        payload: z.record(z.any()).optional(),
      },
    },
    async (args, extra) => {
      const approvingAm = amEmailFrom(extra);
      const idempotencyKey =
        args.idempotencyKey ??
        `${args.action}.${args.canonicalDomain}.${new Date().toISOString().slice(0, 10)}`;
      try {
        const result = await dayAiWrite({
          action: args.action,
          canonicalDomain: args.canonicalDomain,
          idempotencyKey,
          retry: args.retry,
          approvingAm,
          dayAiToken: dayAiTokenFrom(extra),
          ...(args.payload ?? {}),
        });
        return ok(result);
      } catch (e) {
        return fail(`dayai_write ${args.action} failed: ${e.message}`, {
          runStatus: 'pending_sync',
          idempotencyKey,
          retryPrompt: `Retry pending Day AI sync using the same idempotency key (${idempotencyKey}).`,
        });
      }
    },
  );

  server.registerTool(
    'build_receipt',
    {
      description:
        'Produce the single unified account-level receipt (narrative + per-provider color bullets + next action). Writes the receipt to Day AI as a context page on the Organization. This is what /account-health surfaces.',
      inputSchema: {
        canonicalDomain: z.string(),
        displayName: z.string().optional(),
        includeExpanded: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await buildReceipt({ ...args, approvingAm: amEmailFrom(extra) });
        return ok(result);
      } catch (e) {
        return fail(`build_receipt failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'tour_state_get',
    {
      description: "Get the AM's saved tour state for an account (stations, runStatus, pendingSync).",
      inputSchema: { canonicalDomain: z.string() },
    },
    async (args, extra) => {
      try {
        return ok(await getTourState(amEmailFrom(extra), args.canonicalDomain));
      } catch (e) {
        return fail(`tour_state_get failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'tour_state_set',
    {
      description: "Set the runStatus for an account in the AM's tour state.",
      inputSchema: {
        canonicalDomain: z.string(),
        runStatus: z.enum([
          'dry_run_complete',
          'production_pending_approval',
          'production_running',
          'production_saved',
          'pending_sync',
          'blocked',
        ]),
        displayName: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        return ok(await setTourState(amEmailFrom(extra), args));
      } catch (e) {
        return fail(`tour_state_set failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'tour_state_mark_station',
    {
      description: 'Mark a first-run station complete/in_progress/blocked with Day AI record IDs.',
      inputSchema: {
        canonicalDomain: z.string(),
        station: z.string(),
        status: z.enum(['not_started', 'in_progress', 'complete', 'skipped', 'blocked']),
        idempotencyKey: z.string().optional(),
        dayAiRecordIds: z.array(z.any()).optional(),
        blockerReason: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        return ok(await markStation(amEmailFrom(extra), args));
      } catch (e) {
        return fail(`tour_state_mark_station failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'next_resume',
    {
      description:
        "Return the AM's highest-priority unfinished account to resume. Call on a fresh session to greet the AM with a continue-suggestion.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        return ok(await nextResume(amEmailFrom(extra)));
      } catch (e) {
        return fail(`next_resume failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'probe_providers',
    {
      description: 'Health check: which providers (Freshsales/Apollo/Clearout/Day AI) are reachable and authenticated.',
      inputSchema: {},
    },
    async () => {
      const [fsp, ap, cl, da] = await Promise.allSettled([
        freshsalesProbe(),
        apolloProbe(),
        clearoutProbe(),
        dayAiProbe(),
      ]);
      const summ = (s) => (s.status === 'fulfilled' ? { ok: Boolean(s.value?.ok), ...s.value } : { ok: false, reason: String(s.reason?.message ?? s.reason) });
      return ok({ freshsales: summ(fsp), apollo: summ(ap), clearout: summ(cl), dayAi: summ(da) });
    },
  );

  // ---- Account assignments (central, replaces MY_ACCOUNTS.xlsx) ----

  server.registerTool(
    'list_my_accounts',
    {
      description:
        "The signed-in AM's assigned account list (the answer to 'what are my accounts?'), sorted by status then priority. Replaces opening a spreadsheet. Optional status filter (e.g. ready_for_intake).",
      inputSchema: { status: z.string().optional() },
    },
    async (args, extra) => {
      try {
        return ok(await listMyAccounts(amEmailFrom(extra), { status: args.status }));
      } catch (e) {
        return fail(`list_my_accounts failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'get_account',
    {
      description: "Fetch one of the AM's assigned accounts by domain or name, merged with live tour progress.",
      inputSchema: { account: z.string() },
    },
    async (args, extra) => {
      try {
        return ok(await getAccount(amEmailFrom(extra), args.account));
      } catch (e) {
        return fail(`get_account failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'assign_accounts',
    {
      description:
        'Assign or reassign one or more accounts. Any AM may self-serve; an account belongs to one AM at a time (reassigning moves it and records reassignedFrom). amEmail defaults to the caller when omitted (self-assign).',
      inputSchema: {
        assignments: z.array(
          z.object({
            amEmail: z.string().optional(),
            amName: z.string().optional(),
            accountName: z.string(),
            domain: z.string().optional(),
            status: z.string().optional(),
            priority: z.string().optional(),
            personaPack: z.string().optional(),
            cadencePack: z.string().optional(),
            channelPack: z.string().optional(),
            notes: z.string().optional(),
          }),
        ),
      },
    },
    async (args, extra) => {
      const actor = amEmailFrom(extra);
      const rows = (args.assignments ?? []).map((r) => ({ ...r, amEmail: r.amEmail ?? actor }));
      try {
        return ok(await assignAccounts(actor, rows));
      } catch (e) {
        return fail(`assign_accounts failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'unassign_account',
    {
      description: 'Remove an account assignment (offboarding or part of a reassignment). amEmail defaults to the caller.',
      inputSchema: { amEmail: z.string().optional(), accountId: z.string() },
    },
    async (args, extra) => {
      const actor = amEmailFrom(extra);
      try {
        return ok(await unassignAccount(actor, { amEmail: args.amEmail ?? actor, accountId: args.accountId }));
      } catch (e) {
        return fail(`unassign_account failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'list_all_assignments',
    {
      description: 'Team view: every AM’s assignments, totals, and any account owned by more than one AM (conflicts).',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listAllAssignments());
      } catch (e) {
        return fail(`list_all_assignments failed: ${e.message}`);
      }
    },
  );

  // ---- Team insights ----

  server.registerTool(
    'team_brief',
    {
      description: 'Team activity over a window (default 7 days): per-AM accounts touched, drafts, contacts approved, actions, and blockers. Team-level rollup.',
      inputSchema: { windowDays: z.number().optional() },
    },
    async (args) => {
      try {
        return ok(await teamBrief({ windowDays: args.windowDays ?? 7 }));
      } catch (e) {
        return fail(`team_brief failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'assignment_health',
    {
      description: 'Assignment health: cross-AM duplicate-domain conflicts, P1 accounts untouched 14+ days, and overloaded AMs.',
      inputSchema: { overloadThreshold: z.number().optional(), staleDays: z.number().optional() },
    },
    async (args) => {
      try {
        return ok(await assignmentHealth(args));
      } catch (e) {
        return fail(`assignment_health failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'rollout_status',
    {
      description: "Who's connected / onboarded / active across the AM roster, summarized in plain words.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await rolloutStatus());
      } catch (e) {
        return fail(`rollout_status failed: ${e.message}`);
      }
    },
  );

  // ---- Resources (the behavioral config the playbook references) ----
  for (const [name, file] of Object.entries(CONFIG_FILES)) {
    server.registerResource(
      name,
      `myra://config/${name}`,
      { description: `myRA ${name} config`, mimeType: 'application/json' },
      async () => {
        const abs = path.resolve(file);
        const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '{}';
        return { contents: [{ uri: `myra://config/${name}`, mimeType: 'application/json', text }] };
      },
    );
  }

  // ---- Prompts (slash-command shortcuts; Codex fills arguments interactively) ----
  server.registerPrompt(
    'guided-tour',
    {
      description: 'Run the AM tour from account queue to Day AI handoff. Auto-resumes the highest-priority unfinished account.',
      argsSchema: { account: z.string().optional(), domain: z.string().optional() },
    },
    ({ account, domain }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Start my myRA AM tour.${domain ? ` Begin with ${account ?? domain} (${domain}).` : ' Call next_resume first and offer to continue my highest-priority unfinished account.'} Walk me through the five stations (account safety, research, contacts, cadence+draft, health), pausing for my approval before any Day AI write.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'map-contacts',
    {
      description: 'Find and tier candidate contacts for an account (Recommended/Maybe/Hold).',
      argsSchema: { domain: z.string(), personaPack: z.string().optional() },
    },
    ({ domain, personaPack }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Find target contacts for ${domain}. Pull existing Freshsales context (freshsales_evidence), then top up with apollo_search${personaPack ? ` using the ${personaPack} persona pack` : ''}. Present Recommended as a pre-approved batch by name, walk Maybe one at a time, skip Hold unless I ask. I can veto by name or type "select 1, 3, 7".`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'build-cadence',
    {
      description: 'Build an outreach cadence for an account, walking each step field with me.',
      argsSchema: { domain: z.string() },
    },
    ({ domain }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Build a cadence for ${domain}. Resolve the persona/cadence/channel packs, then walk me through each step's channel, timing, tone, and CTA — I'll say "keep" to accept defaults. Show a numbered preview, then create the Day AI Actions and Drafts on my approval.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'account-health',
    {
      description: 'Produce the unified account-level receipt and next best action.',
      argsSchema: { domain: z.string() },
    },
    ({ domain }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Show me the account health for ${domain}: call build_receipt and render the narrative + four color-coded provider bullets + next action.`,
          },
        },
      ],
    }),
  );
}
