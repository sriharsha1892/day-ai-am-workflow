// LinkedIn provider — DELIBERATELY API-FREE. LinkedIn exposes no compliant way to send a
// connection request on a member's behalf, and automating it violates LinkedIn's User Agreement
// (real bans). The repo already encodes this: packs.json lists 'linkedin' under manualOnlyChannels.
//
// So this module makes NO network call. prepareLinkedinTouch() is pure synthesis: it returns the
// profile URL + a short, non-salesy, designation-aware connection note for the AM to send by hand.
// The { profileUrl, connectionNote } output is the STABLE SEAM — if a future (opt-in, ToS-accepted)
// automation is ever added, it consumes this same shape without changing work-contact.

import { personaFrameFor } from '../compose.mjs';

export async function probe() {
  return { ok: true, mode: 'manual_handoff', reason: 'LinkedIn is a manual AM task by design; no API integration.' };
}

export function prepareLinkedinTouch({
  canonicalDomain,
  contactName,
  title,
  seniority,
  department,
  roleBucket,
  linkedinUrl,
  personaPack,
  accountAngle,
}) {
  const { frameKey, frameText } = personaFrameFor({ title, roleBucket, personaPack });
  const note = buildConnectionNote({ contactName, frameKey, accountAngle, canonicalDomain });

  return {
    status: linkedinUrl ? 'ok' : 'needs_profile_url',
    channel: 'linkedin',
    manualOnly: true,
    profileUrl: linkedinUrl ?? null,
    connectionNote: note,
    noteCharCount: note.length,
    designationFrame: frameKey,
    frameText,
    handoffInstruction:
      'Open the profile, send a connection request with this note, then mark the Day AI LinkedIn task done.',
  };
}

// Non-salesy, <=300 chars, no link, no meeting ask — pure context + curiosity.
function buildConnectionNote({ contactName, frameKey, accountAngle }) {
  const first = (contactName ?? '').trim().split(/\s+/)[0] || 'there';
  const hookByFrame = {
    Strategy: 'how your team pressure-tests market/strategy calls',
    'Market Intelligence': 'how you keep competitor/market coverage current without it eating the week',
    'Insights/Research': 'how your team turns one-off research into repeatable, high-confidence reads',
    Innovation: 'how you separate real signal from noise in your space',
    Procurement: 'fast, defensible reads on suppliers and categories',
    'Corporate Development': 'how you screen targets and themes',
    'Business Unit Leader': 'the growth/competitor calls in front of your team this quarter',
  };
  const hook = accountAngle || hookByFrame[frameKey] || 'how your team handles fast, decision-grade research';
  let note = `Hi ${first} — I spend most of my time on ${hook}, and kept thinking of your team. Would be good to connect.`;
  if (note.length > 300) note = note.slice(0, 297).trimEnd() + '…';
  return note;
}
