// Central per-AM account assignments — replaces the hardcoded MY_ACCOUNTS.xlsx / seed CSVs.
// Runtime source of truth is the shared KV (worker/kv.mjs); the master CSV is the reproducible seed.
//
// Keys:
//   accounts:{amEmail}:{accountId}  -> assignment record
//   accounts-index:{amEmail}        -> SET of accountIds owned by that AM
//   accounts-roster                 -> SET of AM emails that have any assignment
//
// accountId = canonicalDomain(domain) when a domain exists, else slug(normalizedName(accountName)),
// so pre-intake/blank-domain accounts get a stable name-based id that upgrades to a domain id when
// the real domain is later filled (assignAccounts auto-migrates the key).
//
// Per the locked decision, ALL AMs self-serve assignments (no hard admin gate); single-owner per
// account is enforced (reassign moves it + records reassignedFrom), and assignedBy/assignedAt are
// stamped for audit.

import * as kv from './kv.mjs';
import { canonicalDomain, normalizedName } from './identity.mjs';
import { getTourState } from './state.mjs';

const STATUS_ORDER = ['ready_for_intake', 'domain_pending', 'identity_review', 'hold'];
const PRIORITY_ORDER = ['P1', 'P2', 'P3'];

const k = {
  rec: (am, id) => `accounts:${am}:${id}`,
  index: (am) => `accounts-index:${am}`,
  roster: () => 'accounts-roster',
};

function slug(name) {
  return normalizedName(name).replace(/\s+/g, '-') || 'unknown';
}

export function accountIdFor({ domain, accountName }) {
  const cd = canonicalDomain(domain);
  return cd || slug(accountName);
}

function sortAccounts(list) {
  return [...list].sort((a, b) => {
    const as = STATUS_ORDER.indexOf(a.status);
    const bs = STATUS_ORDER.indexOf(b.status);
    if (as !== bs) return (as === -1 ? 99 : as) - (bs === -1 ? 99 : bs);
    const ap = PRIORITY_ORDER.indexOf(a.priority);
    const bp = PRIORITY_ORDER.indexOf(b.priority);
    return (ap === -1 ? 99 : ap) - (bp === -1 ? 99 : bp);
  });
}

export async function listMyAccounts(amEmail, { status } = {}) {
  const ids = await kv.smembers(k.index(amEmail));
  const records = [];
  for (const id of ids) {
    const rec = await kv.get(k.rec(amEmail, id));
    if (rec && (!status || rec.status === status)) records.push(rec);
  }
  return { ok: true, amEmail, count: records.length, accounts: sortAccounts(records) };
}

export async function getAccount(amEmail, idOrDomain, { withTourState = true } = {}) {
  const id = canonicalDomain(idOrDomain) || slug(idOrDomain);
  let rec = await kv.get(k.rec(amEmail, id));
  if (!rec) {
    // Fall back: maybe they passed a display name we slugged differently — scan the index.
    const ids = await kv.smembers(k.index(amEmail));
    for (const candidate of ids) {
      const r = await kv.get(k.rec(amEmail, candidate));
      if (r && (r.accountName?.toLowerCase() === String(idOrDomain).toLowerCase() || r.canonicalDomain === id)) {
        rec = r;
        break;
      }
    }
  }
  if (!rec) return { ok: false, reason: `No account "${idOrDomain}" assigned to ${amEmail}` };
  let tourState = null;
  if (withTourState && rec.canonicalDomain) {
    tourState = await getTourState(amEmail, rec.canonicalDomain).catch(() => null);
  }
  return { ok: true, account: rec, tourState };
}

// Find which AM (if any) currently owns this accountId, across the roster.
async function ownerOf(accountId) {
  const roster = await kv.smembers(k.roster());
  for (const am of roster) {
    const ids = await kv.smembers(k.index(am));
    if (ids.includes(accountId)) return am;
  }
  return null;
}

export async function assignAccounts(actorEmail, rows) {
  const results = [];
  for (const row of rows) {
    const amEmail = row.amEmail;
    if (!amEmail || !row.accountName) {
      results.push({ ok: false, reason: 'amEmail and accountName required', row });
      continue;
    }
    const accountId = accountIdFor(row);
    const now = new Date().toISOString();

    // Single-owner: if another AM owns this accountId, move it (record reassignedFrom).
    const currentOwner = await ownerOf(accountId);
    let reassignedFrom = null;
    if (currentOwner && currentOwner !== amEmail) {
      await kv.del(k.rec(currentOwner, accountId));
      await kv.srem(k.index(currentOwner), accountId);
      reassignedFrom = currentOwner;
    }

    const prior = await kv.get(k.rec(amEmail, accountId));
    const record = {
      accountId,
      accountName: row.accountName,
      domain: row.domain ?? prior?.domain ?? '',
      canonicalDomain: canonicalDomain(row.domain) || prior?.canonicalDomain || '',
      status: row.status ?? prior?.status ?? 'domain_pending',
      priority: row.priority ?? prior?.priority ?? '',
      personaPack: row.personaPack ?? prior?.personaPack ?? '',
      cadencePack: row.cadencePack ?? prior?.cadencePack ?? '',
      channelPack: row.channelPack ?? prior?.channelPack ?? '',
      notes: row.notes ?? prior?.notes ?? '',
      amEmail,
      amName: row.amName ?? prior?.amName ?? '',
      assignedBy: actorEmail,
      assignedAt: prior?.assignedAt ?? now,
      updatedAt: now,
      reassignedFrom: reassignedFrom ?? prior?.reassignedFrom ?? null,
    };
    await kv.set(k.rec(amEmail, accountId), record);
    await kv.sadd(k.index(amEmail), accountId);
    await kv.sadd(k.roster(), amEmail);
    results.push({ ok: true, accountId, amEmail, reassignedFrom });
  }
  return { ok: true, assigned: results.length, results };
}

// Fast authoritative seed (loader). Skips the per-row single-owner scan that assignAccounts does
// (unnecessary when the CSV is the source of truth) and writes concurrently in chunks — turns a
// ~2000-call O(n²) seed into a few hundred calls in seconds. The validator already guarantees no
// cross-AM duplicate domain, so single-owner holds.
export async function bulkSeed(rows, { actorEmail = 'loader@ask-myra.ai', concurrency = 20 } = {}) {
  const now = new Date().toISOString();
  const rosterAdds = new Set();
  let written = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (row) => {
        if (!row.amEmail || !row.accountName) return;
        const accountId = accountIdFor(row);
        const record = {
          accountId,
          accountName: row.accountName,
          domain: row.domain ?? '',
          canonicalDomain: canonicalDomain(row.domain) || '',
          status: row.status ?? 'domain_pending',
          priority: row.priority ?? '',
          personaPack: row.personaPack ?? '',
          cadencePack: row.cadencePack ?? '',
          channelPack: row.channelPack ?? '',
          notes: row.notes ?? '',
          amEmail: row.amEmail,
          amName: row.amName ?? '',
          assignedBy: actorEmail,
          assignedAt: now,
          updatedAt: now,
          reassignedFrom: null,
        };
        await Promise.all([
          kv.set(k.rec(row.amEmail, accountId), record),
          kv.sadd(k.index(row.amEmail), accountId),
        ]);
        rosterAdds.add(row.amEmail);
        written += 1;
      }),
    );
  }
  await Promise.all([...rosterAdds].map((am) => kv.sadd(k.roster(), am)));
  return { ok: true, written };
}

export async function unassignAccount(actorEmail, { amEmail, accountId }) {
  const rec = await kv.get(k.rec(amEmail, accountId));
  if (!rec) return { ok: false, reason: `No account ${accountId} for ${amEmail}` };
  await kv.del(k.rec(amEmail, accountId));
  await kv.srem(k.index(amEmail), accountId);
  return { ok: true, removed: accountId, amEmail, by: actorEmail };
}

export async function listAllAssignments() {
  const roster = await kv.smembers(k.roster());
  const byAm = {};
  const domainOwners = {}; // canonicalDomain -> [amEmail]
  let total = 0;
  for (const am of roster) {
    const { accounts } = await listMyAccounts(am);
    byAm[am] = accounts;
    total += accounts.length;
    for (const a of accounts) {
      if (a.canonicalDomain) {
        (domainOwners[a.canonicalDomain] ??= []).push(am);
      }
    }
  }
  const conflicts = Object.entries(domainOwners)
    .filter(([, ams]) => new Set(ams).size > 1)
    .map(([domain, ams]) => ({ domain, ams: [...new Set(ams)] }));
  return { ok: true, roster, total, byAm, conflicts };
}
