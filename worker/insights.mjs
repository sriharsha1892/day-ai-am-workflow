// Team/admin insights — ungated reads (matches the all-AMs-self-serve decision).
// Aggregates the account-assignment KV + per-AM tour state + last-seen stamps.
//
//   team_brief        — per-AM activity over a window (accounts touched, drafts, contacts, actions, blockers)
//   assignment_health — conflicts, stale P1s, AM overload
//   rollout_status    — who's connected / onboarded / active, in plain words
//
// last-seen is stamped by api/mcp.mjs on every authenticated MCP call via recordLastSeen().

import * as kv from './kv.mjs';
import { listAllAssignments } from './accounts.mjs';
import { listTourDomains, getTourState } from './state.mjs';
import { getThresholds } from './admin-config.mjs';

const lastSeenKey = (am) => `last-seen:${am}`;

export async function recordLastSeen(amEmail) {
  if (!amEmail) return;
  try {
    await kv.set(lastSeenKey(amEmail), new Date().toISOString(), { ttlSeconds: 120 * 86_400 });
  } catch {
    /* best-effort; never block a request on telemetry */
  }
}

async function getLastSeen(amEmail) {
  return kv.get(lastSeenKey(amEmail)).catch(() => null);
}

function bearerTokenEmails() {
  const out = new Set();
  for (const pair of (process.env.WORKER_BEARER_TOKENS ?? '').split(',')) {
    const email = pair.split(':')[0]?.trim();
    if (email) out.add(email);
  }
  return out;
}

async function roster() {
  const assigned = await kv.smembers('accounts-roster').catch(() => []);
  const set = new Set(assigned);
  for (const e of bearerTokenEmails()) set.add(e);
  return [...set];
}

function daysAgo(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function humanAgo(iso) {
  if (!iso) return 'never';
  const d = daysAgo(iso);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)} days ago`;
}

export async function teamBrief({ windowDays = 7 } = {}) {
  const ams = await roster();
  const perAm = [];
  for (const am of ams) {
    const domains = await listTourDomains(am).catch(() => []);
    let touched = 0;
    let drafts = 0;
    let people = 0;
    let actions = 0;
    const blockers = [];
    for (const domain of domains) {
      const st = await getTourState(am, domain).catch(() => null);
      if (!st) continue;
      if (daysAgo(st.lastTouchedAt) <= windowDays) touched += 1;
      for (const station of st.stations ?? []) {
        for (const rec of station.dayAiRecordIds ?? []) {
          if (rec.type === 'draft') drafts += 1;
          else if (rec.type === 'person') people += 1;
          else if (rec.type === 'action') actions += 1;
        }
      }
      if (st.runStatus === 'blocked' || st.runStatus === 'pending_sync') {
        blockers.push({
          account: st.account?.displayName ?? domain,
          status: st.runStatus,
          since: humanAgo(st.lastTouchedAt),
          reason: st.pendingSync?.[0]?.reason ?? st.stations?.slice(-1)[0]?.blockerReason ?? st.runStatus,
        });
      }
    }
    perAm.push({ amEmail: am, accountsTouched: touched, draftsCreated: drafts, contactsApproved: people, actionsCreated: actions, blockers });
  }
  const allBlockers = perAm.flatMap((a) => a.blockers.map((b) => ({ amEmail: a.amEmail, ...b })));
  return {
    ok: true,
    windowDays,
    totals: {
      accountsTouched: perAm.reduce((s, a) => s + a.accountsTouched, 0),
      draftsCreated: perAm.reduce((s, a) => s + a.draftsCreated, 0),
      contactsApproved: perAm.reduce((s, a) => s + a.contactsApproved, 0),
      blockers: allBlockers.length,
    },
    perAm,
    blockers: allBlockers,
  };
}

export async function assignmentHealth(opts = {}) {
  const th = await getThresholds();
  const overloadThreshold = opts.overloadThreshold ?? th.overloadThreshold;
  const staleDays = opts.staleDays ?? th.staleDays;
  const all = await listAllAssignments();
  const overloaded = [];
  const staleP1s = [];
  for (const [am, accounts] of Object.entries(all.byAm)) {
    if (accounts.length > overloadThreshold) {
      overloaded.push({ amEmail: am, count: accounts.length, nextStep: `Reassign ${accounts.length - overloadThreshold} account(s) off ${am} (assign_accounts).` });
    }
    for (const a of accounts) {
      if (a.priority === 'P1' && a.canonicalDomain) {
        const st = await getTourState(am, a.canonicalDomain).catch(() => null);
        const last = st?.lastTouchedAt ?? null;
        if (daysAgo(last) > staleDays) {
          staleP1s.push({ amEmail: am, account: a.accountName, lastTouched: humanAgo(last), nextStep: `Nudge ${am} to work ${a.accountName} (P1, untouched ${humanAgo(last)}).` });
        }
      }
    }
  }
  // Each blocker carries an actionable next step (the chosen "blockers-with-actions" UX).
  const conflicts = all.conflicts.map((c) => ({ ...c, nextStep: `Domain ${c.domain} owned by ${c.ams.join(' + ')} — keep one owner (assign_accounts moves it).` }));
  return {
    ok: true,
    thresholds: { overloadThreshold, staleDays },
    total: all.total,
    conflicts,
    overloaded,
    staleP1s,
    healthy: conflicts.length === 0 && overloaded.length === 0 && staleP1s.length === 0,
  };
}

export async function rolloutStatus() {
  const ams = await roster();
  const tokenEmails = bearerTokenEmails();
  const per = [];
  for (const am of ams) {
    const seen = await getLastSeen(am);
    const domains = await listTourDomains(am).catch(() => []);
    per.push({
      amEmail: am,
      connected: Boolean(seen) || tokenEmails.has(am),
      onboarded: domains.length > 0,
      active: daysAgo(seen) <= 7,
      lastSeen: humanAgo(seen),
    });
  }
  const connected = per.filter((p) => p.connected).length;
  const pending = per.filter((p) => !p.connected).map((p) => p.amEmail);
  // Plain-words summary (the chosen micro-delight).
  const summary =
    `${connected} of ${per.length} AMs connected` +
    (pending.length ? `; not yet onboarded: ${pending.join(', ')}` : '; everyone is on');
  return { ok: true, summary, connected, total: per.length, pending, perAm: per };
}
