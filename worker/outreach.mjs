// Per-contact outreach orchestration (Satya's loop). Pure read/synthesis — NO external send and
// NO Day AI writes here; writes happen only after AM approval via dayai_write in the work-contact
// prompt. runWorkContactLoop overlaps two tracks per contact and composes a non-salesy draft.

import { apolloEnrich } from './providers/apollo.mjs';
import { clearoutVerify } from './providers/clearout.mjs';
import { fetchFreshsalesEvidence } from './providers/freshsales.mjs';
import { prepareLinkedinTouch } from './providers/linkedin.mjs';
import { composeFirstTouch } from './compose.mjs';
import { getPreferences } from './preferences.mjs';

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

// Best-effort already-contacted guard: has this contact been touched recently?
export async function checkRecentTouch({ canonicalDomain, contactEmail }) {
  if (!contactEmail) return null;
  try {
    const ev = await fetchFreshsalesEvidence({ canonicalDomain });
    const match = (ev.contacts ?? []).find(
      (c) => (c.email ?? '').toLowerCase() === contactEmail.toLowerCase(),
    );
    if (match?.lastActivity) {
      const days = (Date.now() - new Date(match.lastActivity).getTime()) / 86_400_000;
      if (days <= 30) {
        return {
          channel: 'freshsales',
          when: humanAgo(match.lastActivity),
          byWhom: match.owner ? `owner ${match.owner}` : 'CRM',
        };
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

export async function runWorkContactLoop({ amEmail, canonicalDomain, contact, preferences, recentTouch }) {
  const prefs = preferences ?? (await getPreferences(amEmail).catch(() => ({})));

  const [emailTrack, linkedinTrack] = await Promise.all([
    // Track A: discover (if needed) then verify — sequential within the track.
    (async () => {
      let email = contact.knownEmail ?? null;
      let enrich = null;
      let creditsApollo = 0;
      if (!email && contact.apolloPersonId) {
        enrich = await apolloEnrich({ candidateIds: [contact.apolloPersonId], approvingAm: amEmail }).catch((e) => ({ status: 'failed', error: e.message }));
        email = enrich?.enriched?.[0]?.email ?? null;
        creditsApollo = enrich?.creditsConsumed ?? 0;
      }
      if (!email) return { address: null, verdict: 'invalid', reason: 'no deliverable email found', creditsApollo, creditsClearout: 0 };
      const verify = await clearoutVerify({ emails: [email], approvingAm: amEmail, reason: 'first-touch deliverability' }).catch((e) => ({ status: 'failed', error: e.message }));
      return {
        address: email,
        verdict: verify?.results?.[0]?.status ?? 'risky',
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
    recentTouch: recentTouch ?? null,
    credits: { apollo: emailTrack.creditsApollo ?? 0, clearout: emailTrack.creditsClearout ?? 0 },
  };
}

function humanAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)} days ago`;
}
