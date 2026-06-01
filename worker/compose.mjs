// First-touch draft composer. Designation-aware + deliberately NON-SALESY: the goal is to spark
// interest and earn ~15 minutes for a call, never to pitch in the first note. Reads myra-context
// (personaFrames, positioning.notGeneric, requiredOutputChecks) + packs; reuses apollo's
// matchRoleBucket so title->persona is one source of truth. Returns a complete default draft PLUS
// toneChecks + queueReady so the tone contract is testable and the model can present or refine.

import fs from 'node:fs';
import path from 'node:path';
import { matchRoleBucket } from './providers/apollo.mjs';

const CTX = JSON.parse(fs.readFileSync(path.resolve('workflow/config/myra-context.json'), 'utf8'));
const PACKS = JSON.parse(fs.readFileSync(path.resolve('workflow/config/packs.json'), 'utf8'));

const ALL_ROLE_BUCKETS = PACKS.personaPacks?.balanced?.roleBuckets ?? Object.keys(CTX.personaFrames);
const SALESY = [
  'demo', 'pricing', 'buy ', 'purchase', 'discount', 'sign up', 'signup', 'onboard',
  'free trial', 'game-changer', 'game changer', 'revolutionary', 'best-in-class',
  'synerg', 'cutting-edge', 'world-class', 'unlock value', 'leverage our',
];

// Map a contact's title/roleBucket to a myRA persona frame (shared with linkedin.mjs).
export function personaFrameFor({ title, roleBucket, personaPack }) {
  let frameKey = roleBucket && CTX.personaFrames[roleBucket] ? roleBucket : null;
  if (!frameKey) {
    const buckets = PACKS.personaPacks?.[personaPack]?.roleBuckets ?? ALL_ROLE_BUCKETS;
    frameKey = matchRoleBucket(title ?? '', buckets) ?? null;
  }
  if (!frameKey || !CTX.personaFrames[frameKey]) frameKey = 'Market Intelligence';
  return { frameKey, frameText: CTX.personaFrames[frameKey] };
}

const HOOK_BY_FRAME = {
  Strategy: 'how your team pressure-tests market-entry and strategy calls',
  'Market Intelligence': 'keeping competitor and market coverage current without it eating the week',
  'Insights/Research': 'turning one-off research into repeatable, high-confidence reads',
  Innovation: 'separating real signal from noise in your scouting',
  'Corporate Development': 'screening targets and investment themes faster',
  Procurement: 'getting fast, defensible reads on suppliers and categories',
  'Business Unit Leader': 'the growth and competitor calls in front of your team this quarter',
};

const CTA_BY_SENIORITY = {
  c: 'Worth 15 minutes — or point me to the right person on your team?',
  vp: 'Open to comparing notes for 15 minutes?',
  ic: 'Worth a quick 15 minutes on the part of this you actually run?',
};

function seniorityTier(seniority = '', title = '') {
  const s = `${seniority} ${title}`.toLowerCase();
  if (/c[-\s]?suite|chief|founder|owner|\bceo\b|\bcfo\b|\bcoo\b|\bcmo\b|president/.test(s)) return 'c';
  if (/vp|vice president|head|director|lead/.test(s)) return 'vp';
  return 'ic';
}

export function composeFirstTouch(input) {
  const {
    canonicalDomain,
    contactName,
    title = '',
    seniority,
    roleBucket,
    personaPack,
    emailVerdict = 'unknown',
    accountAngle,
    cta,
    proofPoint,
    preferences = {},
  } = input;

  const { frameKey, frameText } = personaFrameFor({ title, roleBucket, personaPack });
  const first = (contactName ?? '').trim().split(/\s+/)[0] || 'there';
  const hook = accountAngle || HOOK_BY_FRAME[frameKey] || 'fast, decision-grade research';
  const tier = seniorityTier(seniority, title);
  const ctaLine = cta || preferences.defaultTone === 'direct'
    ? (cta || 'Worth 15 minutes this week?')
    : CTA_BY_SENIORITY[tier];

  const subject = subjectFor(frameKey);

  const paras = [
    `Hi ${first}, I work with ${title ? `${roleOrTitle(title)}` : 'teams'} on ${hook}.`,
    reasonToTalk(frameKey, proofPoint),
    ctaLine,
  ];
  const signature = preferences.signature ? `\n\n${preferences.signature}` : '';
  const bodyText = `${paras.join('\n\n')}${signature}`;
  const bodyHtml = `${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}${preferences.signature ? `<p>${escapeHtml(preferences.signature).replace(/\n/g, '<br/>')}</p>` : ''}`;

  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const lower = bodyText.toLowerCase();
  const toneChecks = {
    nonSalesy: !SALESY.some((w) => lower.includes(w)),
    noFeatureDump: !/\b(features?|capabilities|modules?)\b/i.test(bodyText) && (bodyText.match(/myra/gi) ?? []).length <= 1,
    oneReasonToTalk: paras[1].length > 20,
    softCta: /worth|open to|compare notes|quick|point me/i.test(ctaLine),
    leadsWithThem: /^hi /i.test(bodyText.trim()),
    lengthWords: wordCount,
    lengthOk: wordCount <= (tier === 'c' ? 70 : 110),
  };

  return {
    ok: true,
    subject,
    subjectVariants: subjectVariantsFor(frameKey),
    bodyText,
    bodyHtml,
    personaFrameUsed: `${frameKey} → ${frameText}`,
    accountAngleUsed: hook,
    ctaUsed: ctaLine,
    seniorityTier: tier,
    toneChecks,
    qualitySummary: qualitySummaryFrom(toneChecks),
    refineHint: "Say 'warmer', 'punchier', or 'shorter' — or edit any line / change the CTA — and I'll redo it.",
    appliedDefaults: {
      signature: Boolean(preferences.signature),
      tone: preferences.defaultTone ?? 'consultative',
      personaPack: personaPack ?? preferences.defaultPersonaPack ?? null,
    },
    requiredOutputChecks: {
      useCaseNamed: true,
      personaNamed: true,
      signalNamed: Boolean(accountAngle || proofPoint),
      nextDecisionNamed: true,
    },
    // Verified-only queue (locked decision; protects the <5% bounce target): only a Clearout
    // 'verified' email is queue-ready. risky / unknown / failed / invalid → hold for review.
    queueReady: emailVerdict === 'verified',
    queueHold:
      emailVerdict === 'verified'
        ? null
        : emailVerdict === 'invalid'
          ? 'invalid email — cannot send'
          : `email ${emailVerdict} — held for review (queue is verified-only)`,
    rationale: `Framed for ${frameKey} (${seniority || tier}); angle: ${hook}.`,
    canonicalDomain,
  };
}

function roleOrTitle(title) {
  return title.length > 40 ? 'people in your role' : title.toLowerCase().replace(/^(the|a)\s+/, '');
}

function subjectFor(frameKey) {
  const map = {
    Strategy: 'A question on your strategy calls',
    'Market Intelligence': 'Keeping market coverage current',
    'Insights/Research': 'Repeatable research, less rework',
    Innovation: 'Signal vs noise in scouting',
    'Corporate Development': 'Faster target screening',
    Procurement: 'Faster supplier/category reads',
    'Business Unit Leader': 'A quick note on your growth calls',
  };
  return map[frameKey] ?? 'A quick question';
}

// Three subject angles the AM can pick from (inquisitive / consultative / direct).
function subjectVariantsFor(frameKey) {
  const inquisitive = {
    Strategy: 'How do you pressure-test strategy calls?',
    'Market Intelligence': 'How do you keep market coverage current?',
    'Insights/Research': 'How do you make research repeatable?',
    Innovation: 'How do you sort signal from noise?',
    'Corporate Development': 'How do you screen targets today?',
    Procurement: 'How do you get fast supplier reads?',
    'Business Unit Leader': 'How do the growth calls get made?',
  };
  const direct = {
    Strategy: 'Decision-grade strategy reads, faster',
    'Market Intelligence': 'Market coverage that stays current',
    'Insights/Research': 'Research that compounds',
    Innovation: 'Trust your scouting signals',
    'Corporate Development': 'Screen targets faster',
    Procurement: 'Defensible supplier reads, faster',
    'Business Unit Leader': 'Stay ahead of the growth calls',
  };
  return {
    inquisitive: inquisitive[frameKey] ?? 'A quick question',
    consultative: subjectFor(frameKey),
    direct: direct[frameKey] ?? subjectFor(frameKey),
  };
}

// Fold the tone checks into a one-line "looks good / one nit" summary the model can read aloud.
function qualitySummaryFrom(tc) {
  const good = [];
  if (tc.nonSalesy) good.push('non-salesy');
  if (tc.softCta) good.push('soft CTA');
  if (tc.leadsWithThem) good.push('leads with them');
  if (tc.noFeatureDump) good.push('no feature dump');
  if (tc.lengthOk) good.push(`${tc.lengthWords} words`);
  const nits = [];
  if (!tc.nonSalesy) nits.push('trim salesy phrasing');
  if (!tc.oneReasonToTalk) nits.push('add one clear reason to talk');
  if (!tc.softCta) nits.push('soften the CTA');
  if (!tc.lengthOk) nits.push('shorten it');
  return { good, nits };
}

function reasonToTalk(frameKey, proofPoint) {
  const base = {
    Strategy: 'Most strategy teams I talk to lose days assembling decision-grade reads before a call gets made — curious how yours handles that today.',
    'Market Intelligence': 'A lot of MI teams tell me coverage goes stale the moment it ships — curious whether that is a pain for you.',
    'Insights/Research': 'The teams I work with were drowning in one-off research that never compounded — wondering if that resonates.',
    Innovation: 'Scouting teams I speak with struggle less with finding signals than trusting them — curious how you sort that.',
    'Corporate Development': 'Screening targets and themes credibly, fast, is where I see corp-dev teams stretched — curious about your process.',
    Procurement: 'Getting a fast, defensible read on a supplier or category is where I see procurement teams slowed down — curious how you do it now.',
    'Business Unit Leader': 'The growth and competitor calls usually outrun the research behind them — curious how that plays out for your unit.',
  };
  const line = base[frameKey] ?? base['Market Intelligence'];
  return proofPoint ? `${line} (${proofPoint})` : line;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
