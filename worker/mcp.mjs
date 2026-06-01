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
  listTourDomains,
} from './state.mjs';
import {
  listMyAccounts,
  getAccount,
  assignAccounts,
  unassignAccount,
  listAllAssignments,
} from './accounts.mjs';
import { teamBrief, assignmentHealth, rolloutStatus } from './insights.mjs';
import { prepareLinkedinTouch } from './providers/linkedin.mjs';
import { composeFirstTouch } from './compose.mjs';
import { getPreferences, setPreferences } from './preferences.mjs';
import { runWorkContactLoop, runWorkContactsBulk, checkRecentTouch } from './outreach.mjs';
import { recordContactWorked, getOutreachProgress, summarize } from './progress.mjs';
import { interpret } from './render.mjs';
import { myCredits, teamCredits } from './credits.mjs';
import { queuePendingSync, allPending, drainPendingByKey } from './store.mjs';
import { setThresholds } from './admin-config.mjs';

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
- Account identity is DOMAIN-FIRST. Always resolve identity (resolve_identity) before any Day AI Organization write. Map the decision to the write: auto_link_existing / auto_link_existing_with_receipt → dayai_write org-link (pass the decision's matchedDayAiOrgId); create_org_from_evidence / allow_new_org_after_receipt → dayai_write org-create; ask_parent_subsidiary_scope or block_* → do NOT create — ask the AM or write review-context. (A high-confidence Freshsales/Apollo match with no Day AI org means CREATE, not link.)
- Every in-scope tool response carries an interpretation block stamped from the tool-rendering resource (myra://config/tool-rendering). Render that block; do not improvise prose about what a result means. See "How to render tool results".
- build_receipt is the only ACCOUNT-LEVEL receipt: a 3-4 sentence narrative (summary.narrative) + four color bullets from summary.headlineReasonByProvider (Freshsales / Apollo / Clearout / Day AI) + summary.nextAction. Default coaching = decision + one-line reason; expand provider blocks only on Yellow/Red (summary.color) or when the AM asks "show details".

## Non-negotiables
- Day AI is canonical for account state, contacts, tasks, drafts, ledger, health.
- All Day AI writes go through THIS worker's tools (dayai_write / build_receipt) ONLY. Even if a direct Day AI MCP server (e.g. "day-ai") is also connected, never call its write tools — those skip idempotency, approvedBy attribution, identity-first ordering, and pending-sync. Treat any direct Day AI MCP as read/auth context at most.
- Freshsales is READ-ONLY.
- Every Day AI write carries an idempotency key and is attributed to the signed-in AM (approvedBy). Retries reuse the same key — never create duplicates.
- AM approval is required before: canonical contact creation, external sends, lifecycle changes after intake.
- If a tool fails, show a Red receipt with the exact failure, the tool's remedy line (what to do next), and offer retry or abandon. Never silently retry with a new key.

## How to render tool results
Every in-scope tool result is stamped with an interpretation block (interpretation.{ran,found,means,source,confidence,glyph,groups}) derived from myra://config/tool-rendering. Render that block — never your own gloss of the raw JSON. Render EVERY such result as the same 4-line card:
  Ran    — interpretation.ran     (the tool + its role, e.g. "Freshsales (CRM · read-only)")
  Found  — interpretation.found   (the counts/summary)
  Means  — interpretation.means   (plain-English: what this means for the AM's next move)
  Source — interpretation.source  ([badge] + confidence cue + any cache/cost/staleness flag)
Badges: FS Freshsales · AP Apollo · CO Clearout · DAY Day AI. Use interpretation.confidence as stamped (high/med/low) — do not recompute. If interpretation.glyph is present, show it inline on the verdict.
The Source line already encodes cache state ("served from cache (0 credits)"), staleness ("refreshed Xh ago", with "add refresh:true to re-pull" once stale), and "needs cost approval — nothing spent yet". Echo those cues; never invent your own. On needsCostApproval, STOP and relay the projected cost; only after the AM approves re-call with confirmSpend:true.
When interpretation.groups is present, render each group under its own heading, in order: "Existing MI contacts" (Freshsales — people Mordor Intelligence already knows) ABOVE "Net-new (Apollo)" (prospects not yet in MI's CRM). Print each group's rows[] verbatim; NEVER merge the two groups. Show emptyState when a group is empty. The Freshsales row shows "↩ contacted <relative date>" only when there is a real recent sales touch (a field edit is never a contact). Apollo rows lead "★ Recommended" then "Maybe"; skip Hold unless the AM asks. Present Recommended as a pre-approved batch by name; walk Maybe one at a time.
On "show details" / "why?": expand interpretation.confidenceReason (why this confidence) and, for a receipt, summary.whyColor (the plain-English reasons it's Yellow/Red) — and briefly state what you did NOT do (did not write to Freshsales; did not merge Freshsales + Apollo; did not send anything). Keep this OFF by default (only on Yellow/Red or when asked).

## Contact selection (map_contacts / source_new_contacts)
Present Recommended candidates as a pre-approved batch by name (AM can veto any by name), walk Maybe one at a time, skip Hold unless the AM asks. Numbered selection ("select 1, 3, 7") works at any prompt.

## Cadence (build_cadence)
Resolve the persona/cadence/channel packs, then walk each step's fields in sequence (channel? timing? tone? CTA?), accept "keep" for defaults, render a numbered preview, then write Actions + Drafts on approval.

## Cross-session
On the FIRST message of a session, greet the AM by name and call next_resume. Also call show_pending_syncs on that first turn; if any are stuck, add ONE line ("N Day AI write(s) are stuck — say 'retry sync' to finish them"). If it returns a resume, offer that account, naming what was last done from resume.lastDoneSummary and resume.lastTouchedAt as a RELATIVE date ("Hi Satish — last on ITC 3 days ago: 4 contacts worked, 2 verified. Resume, or start fresh?"). NEVER invent counts — if lastDoneSummary is absent, just name the account. If next_resume returns resume:null AND list_my_accounts is empty, this is a brand-new AM: warmly say they're connected with no accounts yet and offer to assign one ("You're all set up — no accounts assigned yet. Say 'assign Acme to me', or run /guided-tour.") — do NOT dump an empty table. On "bye"/"wrap up"/"done for today", call end_session and relay its digest verbatim (accounts touched, contacts worked + verified, credit runway, any pending sync, and the resume suggestion).

## Account list
"What are my accounts?" → call list_my_accounts. Render as a COMPACT aligned table (priority · status · account · domain), in the returned order. Map filter intents to args: "my P1s" → priority:'P1'; "ready to intake" → status:'ready_for_intake'; "untouched 7+ days" → untouchedDays:7; "alphabetical" → sort:'name'. (The xlsx is retired.) guided-tour and next_resume draw from it. Any AM may assign/reassign via assign_accounts (an account has one owner at a time). Admin/team views: list_all_assignments, assignment_health (blockers carry a nextStep), team_brief, rollout_status, team_credits. set_admin_thresholds tunes overload/stale/low-runway thresholds (no redeploy). For stuck Day AI writes ("fix Day AI" / "retry sync" / "what's stuck"): show_pending_syncs, then retry_all_pending (reuses each idempotency key — never duplicates). If any credits/work result carries a lowBalanceAlert, surface that banner verbatim.

## Per-contact outreach (work-contact)
For "work this contact" / "work the next one": call work_contact. It runs email discovery+verification (Apollo+Clearout) and the LinkedIn note prep in parallel, then composes a NON-SALESY, designation-aware first touch (goal: earn ~15 min for a call, never pitch). Repeat touches are cheap — enriched emails (24h) and Clearout verdicts (30d) are cached, so a re-run can cost 0 credits; pass refresh:true only to force a fresh pull.
SPEND IS GATED SERVER-SIDE: if a call would push Clearout below its floor, work_contact returns needsCostApproval:true and spends NOTHING — relay the projected cost, and only after the AM approves re-call with confirmSpend:true. Do not try to bypass the gate.
QUEUE IS VERIFIED-ONLY: only a Clearout-verified email is queueReady; risky/unknown/invalid are held for review (queueHold says why) — never queue them to send.
Show ONE card: email + verdict glyph (✔ verified / ▲ risky / ✕ invalid); the LinkedIn note + profile URL ("copy, open, send" — manual, never automated); the draft. Warn if recentTouch is set (you already worked them, a teammate did, or CRM activity). Then STOP for approve/edit/skip. On approval only: dayai_write draft-create + action-create channel:linkedin — pass contactKey (the email or apolloPersonId) so two contacts on the same account the same day don't collide into one write.
"Work all the Recommended" → call work_contacts (plural) with the slate. It returns ONE aggregate cost-approval card first; re-call with confirmSpend:true to proceed, then present the stacked review list with approve-all / veto-by-name.
When you show the draft: render the email as a copy-ready code block (subject on line 1, then body) and the LinkedIn note as its own code block, so the AM can one-tap copy. Lead with compose_first_touch's qualitySummary as a one-liner ("looks good: non-salesy, soft CTA, leads with them"), echo appliedDefaults ("using your signature + consultative tone"), offer the three subjectVariants (inquisitive / consultative / direct — ask which), and end with the refineHint. If work_contact returns emailDecision (a non-verified email), STOP and ask skip vs queue-anyway — never auto-queue a risky/invalid email. If work_contact returns a conflict (CRM email ≠ Apollo-discovered email), surface BOTH and ask which is current before queuing — Apollo is canonical for email, so default to conflict.recommended.

## Preferences
Honor the AM's saved preferences (get_my_preferences) — signature, default tone — in every draft; offer set_my_preferences when they express a standing choice ("always sign me as…").

## Micro-delights (how to speak)
- Greet by name; use relative dates ("emailed 12 days ago", never an ISO timestamp); warm empty states ("Nothing needs a first touch — you're all caught up").
- Status glyphs on verdicts: ✔ verified / ▲ risky / ✕ invalid; show the LinkedIn note's char count ("247/300 ✔").
- End a contact loop with a quiet closure line ("Email verified, note staged, draft ready — you're set") and the one phrase to continue ("Say 'work the next one'").
- Echo applied defaults ("using your usual consultative tone"); after a draft, offer "warmer or punchier?". No points, no leaderboards.

Keep every recommendation grounded in myRA positioning: decision-grade, expert-validated market/competitor/customer/supplier/trend intelligence.`;

let PKG_VERSION = '0.0.0';
try {
  PKG_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version ?? PKG_VERSION;
} catch {
  /* package.json not resolvable at runtime → keep fallback (don't let the handshake throw) */
}

export const serverOptions = {
  serverInfo: { name: 'myra-am-worker', version: PKG_VERSION },
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

// Stamp an interpretation block onto in-scope results so rendering doesn't depend on the model
// remembering prose. Best-effort: a render/config error must NEVER fail the underlying tool call.
// `ok:false` bodies are skipped (a soft-failed result must not get a "high confidence" card); a
// receipt object has no `ok` field so it stamps normally.
function stampInterpretation(toolName, result) {
  if (!result || typeof result !== 'object' || result.ok === false) return result;
  try {
    const interpretation = interpret(toolName, result);
    return interpretation ? { ...result, interpretation } : result;
  } catch {
    return result;
  }
}

function ok(result, toolName) {
  const body = toolName ? stampInterpretation(toolName, result) : result;
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
  };
}

// Every Red receipt should tell the AM what to do next, not just what broke.
function inferRemedy(message) {
  const m = String(message).toLowerCase();
  if (/token refresh|refresh_token|invalid_grant|reauth|sign-in expired/.test(m)) return 'Your Day AI sign-in expired — run: codex mcp login myra';
  if (/401|unauthor|invalid_token|forbidden/.test(m)) return 'Your token may be stale — ask the admin to re-issue it (1Password Send).';
  if (/timeout|timed out|unreachable|fetch failed|econn|503|429|rate/.test(m)) return 'Looks transient — try again in a minute.';
  if (/no record id|iserror|pending_sync/.test(m)) return 'The Day AI write did not land — retry with the same idempotency key, or run show_pending_syncs.';
  return 'If this keeps happening, tell the admin (paste the error text).';
}

function fail(message, extra = {}) {
  // Retryable (transient) vs permanent — so the model can say "works in a minute" vs "skip / fix it".
  const retryable = /timeout|timed out|unreachable|fetch failed|econn|503|429|rate|temporarily/i.test(String(message));
  const body = { ok: false, receiptColor: 'red', error: message, remedy: extra.remedy ?? inferRemedy(message), retryable, ...extra };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  };
}

// Contact-scoped actions need a per-CONTACT default key, or two contacts on the same account the
// same day collide and the second write is silently dropped as a "replay" (review P1d). Account-
// scoped actions keep the domain+day key. Callers may always pass an explicit idempotencyKey.
const CONTACT_SCOPED_ACTIONS = new Set(['draft-create', 'action-create', 'person-create', 'person-dedupe-check']);
export function defaultIdempotencyKey(args) {
  const day = new Date().toISOString().slice(0, 10);
  const disc = args.contactKey ?? args.payload?.contactEmail ?? args.payload?.email ?? args.payload?.apolloPersonId ?? null;
  if (CONTACT_SCOPED_ACTIONS.has(args.action) && disc) {
    const slug = String(disc).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${args.action}.${args.canonicalDomain}.${slug}.${day}`;
  }
  return `${args.action}.${args.canonicalDomain}.${day}`;
}

const CONFIG_FILES = {
  'myra-context': 'workflow/config/myra-context.json',
  packs: 'workflow/config/packs.json',
  'ux-guidance': 'workflow/config/ux-guidance.json',
  'org-resolution': 'workflow/config/org-resolution.json',
  'contact-sourcing': 'workflow/config/contact-sourcing.json',
  // The rendering contract: per-tool badge/label/role/meaning/contactFields/confidence/glyphs.
  // The worker stamps each in-scope tool response's `interpretation` block from this file; the
  // "How to render tool results" instructions tell the model to render it. Swap rendering = edit JSON.
  'tool-rendering': 'workflow/config/tool-rendering.json',
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
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await fetchFreshsalesEvidence(args);
        return ok({ ...result, approvedBy: amEmailFrom(extra) }, 'freshsales_evidence');
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
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await apolloPeopleSearch(args);
        return ok({ ...result, approvedBy: amEmailFrom(extra) }, 'apollo_search');
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
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await apolloEnrich({ ...args, approvingAm: amEmailFrom(extra) });
        return ok(result, 'apollo_enrich');
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
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        const result = await clearoutVerify({ ...args, approvingAm: amEmailFrom(extra) });
        return ok(result, 'clearout_verify');
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
        contactKey: z.string().optional(),
        retry: z.boolean().optional(),
        payload: z.record(z.any()).optional(),
      },
    },
    async (args, extra) => {
      const approvingAm = amEmailFrom(extra);
      const idempotencyKey = args.idempotencyKey ?? defaultIdempotencyKey(args);
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
        return ok(result, 'dayai_write');
      } catch (e) {
        // Enqueue for the pending-sync queue so it survives the chat and can be retried later.
        await queuePendingSync({
          canonicalDomain: args.canonicalDomain,
          amEmail: approvingAm,
          action: args.action,
          idempotencyKey,
          payload: args.payload ?? {},
          reason: e.message,
          attemptedWrite: args.action,
          queuedAt: new Date().toISOString(),
        }).catch(() => {});
        return fail(`dayai_write ${args.action} failed: ${e.message}`, {
          runStatus: 'pending_sync',
          idempotencyKey,
          retryPrompt: `Queued — run show_pending_syncs to see it, or retry_all_pending (reuses the idempotency key ${idempotencyKey}, never duplicates).`,
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
        return ok(result, 'build_receipt');
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
        "The signed-in AM's assigned account list (the answer to 'what are my accounts?'), sorted by status then priority. Replaces opening a spreadsheet. Filters: status (e.g. ready_for_intake), priority (P1/P2/P3), untouchedDays (only accounts not worked in N+ days), sort ('status' default | 'name'). Map 'my P1s' -> priority:'P1'; 'untouched 7+ days' -> untouchedDays:7.",
      inputSchema: {
        status: z.string().optional(),
        priority: z.string().optional(),
        untouchedDays: z.number().optional(),
        sort: z.enum(['status', 'name']).optional(),
      },
    },
    async (args, extra) => {
      try {
        return ok(await listMyAccounts(amEmailFrom(extra), { status: args.status, priority: args.priority, untouchedDays: args.untouchedDays, sort: args.sort }));
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

  // ---- Per-contact outreach loop + preferences ----

  server.registerTool(
    'work_contact',
    {
      description:
        "Satya's per-contact loop for ONE contact: in parallel discover+verify the email (Apollo+Clearout) and prepare a non-salesy LinkedIn connection note, then compose a designation-aware non-salesy first-touch draft. Returns a combined review card. Sends NOTHING and writes NOTHING — show the card, get approval, then call dayai_write.",
      inputSchema: {
        canonicalDomain: z.string(),
        contactName: z.string().optional(),
        title: z.string().optional(),
        seniority: z.string().optional(),
        department: z.string().optional(),
        roleBucket: z.string().optional(),
        apolloPersonId: z.string().optional(),
        linkedinUrl: z.string().optional(),
        knownEmail: z.string().optional(),
        personaPack: z.string().optional(),
        accountAngle: z.string().optional(),
        confirmSpend: z.boolean().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const amEmail = amEmailFrom(extra);
      try {
        const preferences = await getPreferences(amEmail).catch(() => ({}));
        const contact = { ...args, name: args.contactName };
        const recentTouch = await checkRecentTouch({ canonicalDomain: args.canonicalDomain, contactEmail: args.knownEmail, contactName: args.contactName, apolloPersonId: args.apolloPersonId });
        const result = await runWorkContactLoop({ amEmail, canonicalDomain: args.canonicalDomain, contact, preferences, recentTouch, confirmSpend: args.confirmSpend, refresh: args.refresh });
        // Record progress + make the account visible to next_resume — but only when we actually
        // worked the contact (not when we stopped for a cost-approval card).
        if (result.ok && !result.needsCostApproval) {
          await recordContactWorked(args.canonicalDomain, {
            contactId: args.apolloPersonId || result.email?.address || args.contactName,
            name: args.contactName,
            email: result.email?.address ?? null,
            emailVerdict: result.email?.verdict ?? null,
            creditsApollo: result.credits?.apollo ?? 0,
            creditsClearout: result.credits?.clearout ?? 0,
          }).catch(() => {});
          await markStation(amEmail, { canonicalDomain: args.canonicalDomain, station: 'work_contact', status: 'in_progress' }).catch(() => {});
        }
        return ok(result, 'work_contact');
      } catch (e) {
        return fail(`work_contact failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'work_contacts',
    {
      description:
        'Bulk version of work_contact: run a slate of contacts through the per-contact loop under bounded concurrency, with an AGGREGATE pre-spend approval gate. Returns a stacked review list. Sends NOTHING and writes NOTHING. First call returns a cost-approval card; re-call with confirmSpend:true to proceed.',
      inputSchema: {
        canonicalDomain: z.string(),
        contacts: z.array(
          z.object({
            contactName: z.string().optional(),
            title: z.string().optional(),
            seniority: z.string().optional(),
            department: z.string().optional(),
            roleBucket: z.string().optional(),
            apolloPersonId: z.string().optional(),
            linkedinUrl: z.string().optional(),
            knownEmail: z.string().optional(),
            personaPack: z.string().optional(),
            accountAngle: z.string().optional(),
          }),
        ),
        confirmSpend: z.boolean().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const amEmail = amEmailFrom(extra);
      try {
        const preferences = await getPreferences(amEmail).catch(() => ({}));
        const contacts = (args.contacts ?? []).map((c) => ({ ...c, name: c.contactName }));
        const result = await runWorkContactsBulk({ amEmail, canonicalDomain: args.canonicalDomain, contacts, preferences, confirmSpend: args.confirmSpend, refresh: args.refresh });
        if (result.ok && !result.needsCostApproval) {
          for (const r of result.results ?? []) {
            if (!r || r.needsCostApproval) continue;
            await recordContactWorked(args.canonicalDomain, {
              contactId: r.contact?.apolloPersonId || r.email?.address || r.contact?.name,
              name: r.contact?.name,
              email: r.email?.address ?? null,
              emailVerdict: r.email?.verdict ?? null,
              creditsApollo: r.credits?.apollo ?? 0,
              creditsClearout: r.credits?.clearout ?? 0,
            }).catch(() => {});
          }
          await markStation(amEmail, { canonicalDomain: args.canonicalDomain, station: 'work_contact', status: 'in_progress' }).catch(() => {});
        }
        return ok(result, 'work_contacts');
      } catch (e) {
        return fail(`work_contacts failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'prepare_linkedin_touch',
    {
      description: 'Assemble the manual LinkedIn handoff: profile URL + a short (≤300 char), non-salesy, designation-aware connection note. Makes no LinkedIn network call (manual by design).',
      inputSchema: {
        canonicalDomain: z.string(),
        contactName: z.string().optional(),
        title: z.string().optional(),
        seniority: z.string().optional(),
        department: z.string().optional(),
        roleBucket: z.string().optional(),
        linkedinUrl: z.string().optional(),
        personaPack: z.string().optional(),
        accountAngle: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(prepareLinkedinTouch(args));
      } catch (e) {
        return fail(`prepare_linkedin_touch failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'compose_first_touch',
    {
      description: 'Compose a designation-aware, NON-SALESY first-touch email (subject+body) whose only goal is to earn ~15 minutes for a call. Returns toneChecks + queueReady (false if the email is invalid).',
      inputSchema: {
        canonicalDomain: z.string(),
        contactName: z.string().optional(),
        title: z.string(),
        seniority: z.string().optional(),
        roleBucket: z.string().optional(),
        personaPack: z.string().optional(),
        emailVerdict: z.enum(['verified', 'risky', 'invalid', 'unknown']).optional(),
        accountAngle: z.string().optional(),
        cta: z.string().optional(),
        proofPoint: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        const preferences = await getPreferences(amEmailFrom(extra)).catch(() => ({}));
        return ok(composeFirstTouch({ ...args, preferences }));
      } catch (e) {
        return fail(`compose_first_touch failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'get_my_preferences',
    {
      description: "The signed-in AM's saved preferences (signature, default tone, calendar link, default packs).",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        return ok(await getPreferences(amEmailFrom(extra)));
      } catch (e) {
        return fail(`get_my_preferences failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'set_my_preferences',
    {
      description: "Save the AM's preferences once so drafts auto-use them ('always sign me as Satya, AM; default tone consultative').",
      inputSchema: {
        signature: z.string().optional(),
        defaultTone: z.string().optional(),
        calendarLink: z.string().optional(),
        defaultPersonaPack: z.string().optional(),
        defaultCadencePack: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        return ok(await setPreferences(amEmailFrom(extra), args));
      } catch (e) {
        return fail(`set_my_preferences failed: ${e.message}`);
      }
    },
  );

  // ---- Credit awareness ----

  server.registerTool(
    'credits',
    {
      description: "The signed-in AM's Apollo/Clearout usage this month + remaining Clearout balance. Shown before credit-spending actions.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        return ok(await myCredits(amEmailFrom(extra)));
      } catch (e) {
        return fail(`credits failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'team_credits',
    {
      description: 'Team-wide Apollo/Clearout spend this month, per AM, with Clearout runway in plain words ("~2 weeks left at current pace").',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await teamCredits());
      } catch (e) {
        return fail(`team_credits failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'show_pending_syncs',
    {
      description: "List the signed-in AM's failed Day AI writes awaiting retry (the pending-sync queue). Read-only.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const am = amEmailFrom(extra);
        const mine = (await allPending()).filter((e) => !e.amEmail || e.amEmail === am);
        return ok({ ok: true, count: mine.length, pending: mine });
      } catch (e) {
        return fail(`show_pending_syncs failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'retry_all_pending',
    {
      description: "Retry all of the signed-in AM's pending Day AI writes, reusing each stored idempotency key (never duplicates). Drains the ones that succeed.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const am = amEmailFrom(extra);
      try {
        const mine = (await allPending()).filter(
          (e) => (!e.amEmail || e.amEmail === am) && e.action && e.canonicalDomain && e.idempotencyKey,
        );
        const results = [];
        for (const e of mine) {
          try {
            const r = await dayAiWrite({
              action: e.action,
              canonicalDomain: e.canonicalDomain,
              idempotencyKey: e.idempotencyKey,
              retry: true,
              approvingAm: am,
              dayAiToken: dayAiTokenFrom(extra),
              ...(e.payload ?? {}),
            });
            await drainPendingByKey(e.idempotencyKey).catch(() => {});
            results.push({ idempotencyKey: e.idempotencyKey, action: e.action, ok: true, id: r.id });
          } catch (err) {
            results.push({ idempotencyKey: e.idempotencyKey, action: e.action, ok: false, error: err.message });
          }
        }
        return ok({ ok: true, attempted: results.length, retried: results.filter((r) => r.ok).length, results });
      } catch (e) {
        return fail(`retry_all_pending failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'set_admin_thresholds',
    {
      description: 'Tune admin thresholds in KV (no redeploy): overloadThreshold (accounts/AM), staleDays (P1 untouched), lowRunwayDays (Clearout low-balance alert). Read by assignment_health + the credit alert.',
      inputSchema: {
        overloadThreshold: z.number().optional(),
        staleDays: z.number().optional(),
        lowRunwayDays: z.number().optional(),
      },
    },
    async (args, extra) => {
      try {
        return ok({ ok: true, thresholds: await setThresholds(args), updatedBy: amEmailFrom(extra) });
      } catch (e) {
        return fail(`set_admin_thresholds failed: ${e.message}`);
      }
    },
  );

  server.registerTool(
    'end_session',
    {
      description:
        "Read-only end-of-day digest for the signed-in AM: accounts touched, contacts worked + verified, Clearout credit runway this month, pending Day AI syncs, and the resume suggestion for next time. Call on 'bye' / 'done for today' / 'wrap up'.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const am = amEmailFrom(extra);
        const [credits, pendingAll, resume, domains] = await Promise.all([
          myCredits(am).catch(() => null),
          allPending().catch(() => []),
          nextResume(am).catch(() => ({ resume: null })),
          listTourDomains(am).catch(() => []),
        ]);
        const pending = pendingAll.filter((e) => !e.amEmail || e.amEmail === am);
        let contactsWorked = 0;
        let verified = 0;
        for (const d of domains) {
          const s = summarize(await getOutreachProgress(d));
          contactsWorked += s.contactsWorked;
          verified += s.verified;
        }
        return ok({
          ok: true,
          accountsTouched: domains.length,
          contactsWorked,
          verified,
          credits,
          pendingCount: pending.length,
          pending,
          resume: resume?.resume ?? null,
        });
      } catch (e) {
        return fail(`end_session failed: ${e.message}`);
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

  server.registerPrompt(
    'work-contact',
    {
      description: "Run the per-contact loop for one contact: parallel email discovery+verify + LinkedIn note, then a non-salesy draft, shown for review. Nothing sends.",
      argsSchema: {
        domain: z.string(),
        contact: z.string().optional(),
        apolloPersonId: z.string().optional(),
        title: z.string().optional(),
        linkedinUrl: z.string().optional(),
      },
    },
    ({ domain, contact, apolloPersonId, title, linkedinUrl }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Work this contact for ${domain}: ${contact ?? apolloPersonId ?? 'the one I just selected'}${title ? ` (${title})` : ''}.

1. Call work_contact with the domain + contact details${linkedinUrl ? ` (linkedinUrl ${linkedinUrl})` : ''}. It runs email discovery+verification and the LinkedIn note prep in parallel, then composes a non-salesy first-touch draft.
2. Show me ONE combined card:
   • Email: address + Clearout verdict (✔ verified / ▲ risky / ✕ invalid) + credits used.
   • LinkedIn (I send manually): the connection note ("247/300 ✔") + profile URL — "copy the note, open the profile, send the request."
   • Draft email: subject + body, and which persona frame + angle it used.
   • If work_contact flags recentTouch, warn me up front ("↩ emailed 12 days ago").
   • If work_contact returns needsCostApproval, tell me the projected credits and ask me to approve BEFORE spending — then re-call with confirmSpend:true. Nothing was spent yet.
   • Only a verified email is queue-ready; if it's risky/unknown/invalid, flag it as held-for-review, not ready to send.
3. STOP and ask: "Approve, edit, or skip?"
4. Only after I approve: dayai_write {action:'draft-create'} for the email (draft only — never send), dayai_write {action:'action-create', channel:'linkedin'} with the note as a manual task, and person-create first if I want the contact saved. Pass contactKey (the email or apolloPersonId) on each so contacts on the same account/day don't collide. If I skip, write nothing.
End with the one phrase to continue ("Say 'work the next one'").`,
          },
        },
      ],
    }),
  );
}
