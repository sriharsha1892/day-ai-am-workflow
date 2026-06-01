// Per-contact outreach orchestration (Satya's loop). Pure read/synthesis — NO external send and
// NO Day AI writes here; writes happen only after AM approval via dayai_write in the work-contact
// prompt. runWorkContactLoop overlaps two tracks per contact and composes a non-salesy draft.

import { apolloEnrich } from './providers/apollo.mjs';
import { clearoutVerify } from './providers/clearout.mjs';
import { fetchFreshsalesEvidence } from './providers/freshsales.mjs';
import { prepareLinkedinTouch } from './providers/linkedin.mjs';
import { composeFirstTouch } from './compose.mjs';
import { getPreferences } from './preferences.mjs';
import { peek, enrichKey, clearoutKey } from './cache.mjs';
import { findWorkedContact } from './progress.mjs';
import { getIdempotencyForAccount } from './store.mjs';
import { remainingCredits } from './credits.mjs';

// Server-side spend gate (review P1c): don't spend when the Clearout balance is near this floor
// unless the AM explicitly confirms. Apollo balance isn't exposed by the API, so Clearout (the
// metered, exhaustible credit) is the gate. Env-overridable; not admin-exposed.
const CREDIT_FLOOR = Number(process.env.CREDIT_FLOOR ?? 50);

// Bounded concurrency for bulk fan-out (respect Apollo 100/min + Clearout 1000/day).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { ok: false, error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Best-effort already-contacted guard (review P1e). Checks three sources, strongest first, and
// matches by email OR name (so cold Apollo-sourced contacts with no email yet are still covered):
//   1. Prior myRA outreach (our own progress record)  → "you worked this 4 days ago"
//   2. An existing Day AI draft/action for this contact → "already drafted"
//   3. A real Freshsales sales activity ≤30 days        → "owner contacted 12 days ago"
// Freshsales evidence is the 1h-cached pull, so calling this per contact is cheap.
export async function checkRecentTouch({ canonicalDomain, contactEmail, contactName, apolloPersonId }) {
  if (!canonicalDomain) return null;

  // 1. Did we already work this contact in myRA?
  try {
    const worked = await findWorkedContact(canonicalDomain, { email: contactEmail, name: contactName });
    if (worked?.workedAt && ageDays(worked.workedAt) <= 60) {
      return { channel: 'myra', when: humanAgo(worked.workedAt), byWhom: 'you (myRA)', detail: `already worked — email ${worked.emailVerdict ?? 'unverified'}` };
    }
  } catch {
    /* best-effort */
  }

  // 2. Is there already a Day AI draft/action/person saved for this contact?
  try {
    if (contactEmail || apolloPersonId) {
      const records = await getIdempotencyForAccount(canonicalDomain);
      const email = (contactEmail ?? '').toLowerCase();
      const hit = records.find((r) => {
        if (!['draft-create', 'action-create', 'person-create'].includes(r.type)) return false;
        const blob = JSON.stringify(r).toLowerCase();
        return (email && blob.includes(email)) || (apolloPersonId && blob.includes(String(apolloPersonId).toLowerCase()));
      });
      if (hit?.writtenAt) {
        return { channel: 'day-ai', when: humanAgo(hit.writtenAt), byWhom: hit.approvingAm ?? 'a teammate', detail: `${hit.type} already saved` };
      }
    }
  } catch {
    /* best-effort */
  }

  // 3. Freshsales real sales activity (updated_at no longer counts) within 30 days.
  try {
    if (contactEmail || contactName) {
      const ev = await fetchFreshsalesEvidence({ canonicalDomain });
      const email = contactEmail ? contactEmail.toLowerCase() : null;
      const name = contactName ? contactName.toLowerCase() : null;
      const match = (ev.contacts ?? []).find(
        (c) => (email && (c.email ?? '').toLowerCase() === email) || (name && (c.name ?? '').toLowerCase() === name),
      );
      if (match?.lastActivity && ageDays(match.lastActivity) <= 30) {
        return { channel: 'freshsales', when: humanAgo(match.lastActivity), byWhom: match.owner ? `owner ${match.owner}` : 'CRM' };
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// Projected spend for one contact AFTER consulting the caches — the basis for the pre-spend gate.
export async function projectSpend(contact) {
  let apollo = 0;
  let clearout = 0;
  let email = contact.knownEmail ?? null;
  if (!email && contact.apolloPersonId) {
    const hit = await peek(enrichKey(contact.apolloPersonId)).catch(() => null);
    if (hit?.value?.email) email = hit.value.email; // already enriched → free
    else apollo = 1;
  }
  if (email) {
    const v = await peek(clearoutKey(email)).catch(() => null);
    if (!v) clearout = 1; // not yet verified → 1 credit
  } else if (apollo) {
    clearout = 1; // will discover then verify
  }
  return { apollo, clearout, total: apollo + clearout };
}

// Gate on Clearout balance vs the floor. Returns {block, clearoutRemaining, reason}.
async function spendGate(projectedClearout) {
  let clearoutRemaining = null;
  try {
    clearoutRemaining = await remainingCredits('clearout');
  } catch {
    /* unknown balance → don't block on a missing read */
  }
  if (clearoutRemaining != null && clearoutRemaining - projectedClearout < CREDIT_FLOOR) {
    return { block: true, clearoutRemaining, reason: ` Clearout balance (${clearoutRemaining}) is at/near the floor of ${CREDIT_FLOOR}.` };
  }
  return { block: false, clearoutRemaining };
}

export async function runWorkContactLoop({ amEmail, canonicalDomain, contact, preferences, recentTouch, confirmSpend = false, refresh = false }) {
  const prefs = preferences ?? (await getPreferences(amEmail).catch(() => ({})));

  // Pre-spend gate (P1c): project the real spend AFTER cache checks; stop for approval if it would
  // push Clearout below the floor, unless the AM already confirmed. Returns a card, spends nothing.
  const projected = await projectSpend(contact);
  if (projected.total > 0 && !confirmSpend) {
    const gate = await spendGate(projected.clearout);
    if (gate.block) {
      return {
        ok: true,
        needsCostApproval: true,
        contact: { name: contact.name, title: contact.title, apolloPersonId: contact.apolloPersonId },
        projected,
        clearoutRemaining: gate.clearoutRemaining,
        recentTouch: recentTouch ?? null,
        message: `This contact would spend ${projected.apollo} Apollo + ${projected.clearout} Clearout credit(s).${gate.reason} Approve to proceed (re-run with confirmSpend: true).`,
      };
    }
  }

  const [emailTrack, linkedinTrack] = await Promise.all([
    // Track A: discover (if needed) then verify — sequential within the track. Both steps are now
    // cache-backed, so a follow-up touch can cost 0 credits. `refresh` forces a fresh pull.
    (async () => {
      let email = contact.knownEmail ?? null;
      let enrich = null;
      let creditsApollo = 0;
      if (!email && contact.apolloPersonId) {
        enrich = await apolloEnrich({ candidateIds: [contact.apolloPersonId], approvingAm: amEmail, refresh }).catch((e) => ({ status: 'failed', error: e.message }));
        email = enrich?.enriched?.[0]?.email ?? null;
        creditsApollo = enrich?.creditsConsumed ?? 0;
      }
      if (!email) return { address: null, verdict: 'invalid', reason: 'no deliverable email found', creditsApollo, creditsClearout: 0 };
      const verify = await clearoutVerify({ emails: [email], approvingAm: amEmail, reason: 'first-touch deliverability', refresh }).catch((e) => ({ status: 'failed', error: e.message }));
      // Distinct failure verdict (P3a): a Clearout error is 'failed', not silently 'risky'.
      const verdict = verify?.status === 'failed' ? 'failed' : verify?.results?.[0]?.status ?? 'failed';
      return {
        address: email,
        verdict,
        verifiedAt: verify?.results?.[0]?.verifiedAt ?? null,
        fromCache: verify?.results?.[0]?.cached ?? false,
        creditsApollo,
        creditsClearout: verify?.creditsConsumed ?? 0,
      };
    })(),
    // Track B: LinkedIn prep — no dependency on Track A, runs concurrently.
    Promise.resolve(
      prepareLinkedinTouch({
        canonicalDomain,
        contactName: contact.name,
        title: contact.title,
        seniority: contact.seniority,
        department: contact.department,
        roleBucket: contact.roleBucket,
        linkedinUrl: contact.linkedinUrl,
        personaPack: contact.personaPack,
        accountAngle: contact.accountAngle,
      }),
    ),
  ]);

  // Post-discovery recheck (P1e): if the email was only just discovered, run the guard against it
  // (the pre-loop check could only see knownEmail/name).
  let touch = recentTouch ?? null;
  if (!touch && emailTrack.address && !contact.knownEmail) {
    touch = await checkRecentTouch({ canonicalDomain, contactEmail: emailTrack.address, contactName: contact.name, apolloPersonId: contact.apolloPersonId }).catch(() => null);
  }

  const draft = composeFirstTouch({
    canonicalDomain,
    contactName: contact.name,
    title: contact.title,
    seniority: contact.seniority,
    roleBucket: contact.roleBucket,
    personaPack: contact.personaPack,
    emailVerdict: emailTrack.verdict,
    accountAngle: contact.accountAngle,
    preferences: prefs,
  });

  return {
    ok: true,
    contact: { name: contact.name, title: contact.title, apolloPersonId: contact.apolloPersonId },
    email: emailTrack,
    linkedin: linkedinTrack,
    draft,
    recentTouch: touch,
    credits: { apollo: emailTrack.creditsApollo ?? 0, clearout: emailTrack.creditsClearout ?? 0 },
    // Don't silently veto a non-verified email — surface the choice to the AM.
    emailDecision:
      emailTrack.verdict === 'verified'
        ? null
        : {
            verdict: emailTrack.verdict,
            prompt: `Email is ${emailTrack.verdict} — skip and work a fresh contact, or queue it anyway for your review?`,
            options: ['skip', 'queue anyway'],
          },
  };
}

// Bulk fan-out (review P3b): run a slate of contacts through the loop under bounded concurrency,
// with an AGGREGATE pre-spend gate so "work all the Recommended" can't burn credits unbounded.
export async function runWorkContactsBulk({ amEmail, canonicalDomain, contacts = [], preferences, confirmSpend = false, refresh = false, concurrency = 6 }) {
  if (!contacts.length) return { ok: true, total: 0, results: [] };
  const prefs = preferences ?? (await getPreferences(amEmail).catch(() => ({})));

  // Aggregate projection across the whole slate.
  const perContact = await mapLimit(contacts, concurrency, (c) => projectSpend(c));
  const aggApollo = perContact.reduce((n, p) => n + (p.apollo ?? 0), 0);
  const aggClearout = perContact.reduce((n, p) => n + (p.clearout ?? 0), 0);

  if ((aggApollo + aggClearout) > 0 && !confirmSpend) {
    const gate = await spendGate(aggClearout);
    // Bulk ALWAYS surfaces an approval card (cost transparency), and blocks below the floor.
    return {
      ok: true,
      needsCostApproval: true,
      total: contacts.length,
      projected: { apollo: aggApollo, clearout: aggClearout, total: aggApollo + aggClearout },
      clearoutRemaining: gate.clearoutRemaining,
      message: `Working ${contacts.length} contact(s) would spend up to ${aggApollo} Apollo + ${aggClearout} Clearout credit(s).${gate.block ? gate.reason : ''} Approve to proceed (re-run with confirmSpend: true).`,
    };
  }

  const results = await mapLimit(contacts, concurrency, async (contact) => {
    const recentTouch = await checkRecentTouch({ canonicalDomain, contactEmail: contact.knownEmail, contactName: contact.name, apolloPersonId: contact.apolloPersonId }).catch(() => null);
    return runWorkContactLoop({ amEmail, canonicalDomain, contact, preferences: prefs, recentTouch, confirmSpend: true, refresh });
  });

  const credits = results.reduce(
    (acc, r) => ({ apollo: acc.apollo + (r?.credits?.apollo ?? 0), clearout: acc.clearout + (r?.credits?.clearout ?? 0) }),
    { apollo: 0, clearout: 0 },
  );
  return { ok: true, total: contacts.length, credits, results };
}

function ageDays(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function humanAgo(iso) {
  const d = ageDays(iso);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)} days ago`;
}
