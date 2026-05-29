// Build the unified account receipt. Conforms to workflow/schemas/account-receipt.schema.json.
// Aggregates provider blocks, writes locally and to Day AI as a context page.

import fs from 'node:fs';
import path from 'node:path';
import {
  fetchFreshsalesEvidence,
} from './providers/freshsales.mjs';
import { apolloPeopleSearch } from './providers/apollo.mjs';
import { writeDayAiContextPage } from './providers/day-ai.mjs';
import { getIdempotencyForAccount, pendingForAccount } from './store.mjs';
import { getOutreachProgress, summarize as summarizeProgress } from './progress.mjs';

const COLOR_RANK = { green: 0, yellow: 1, red: 2 };

export async function buildReceipt({ canonicalDomain, displayName, approvingAm, includeExpanded = false }) {
  const now = new Date().toISOString();

  // 1. Pull live evidence summaries (cheap calls only — Apollo search is paginated and idempotent).
  const [freshsales, apollo] = await Promise.all([
    safe(() => fetchFreshsalesEvidence({ canonicalDomain, accountName: displayName })),
    safe(() => apolloPeopleSearch({ canonicalDomain })),
  ]);

  // 2. Pull idempotency-store records + per-account outreach progress (real enrich/verify state).
  const [accountRecords, pendingSync, progress] = await Promise.all([
    getIdempotencyForAccount(canonicalDomain),
    pendingForAccount(canonicalDomain),
    getOutreachProgress(canonicalDomain).catch(() => null),
  ]);
  const outreach = summarizeProgress(progress);

  // 3. Build provider blocks.
  const freshsalesBlock = freshsales
    ? {
        status: freshsales.status,
        evidenceCount: freshsales.evidenceCount,
        duplicateRisk: freshsales.duplicateRisk,
        blockers: [],
        headlineReason: freshsales.headlineReason,
      }
    : {
        status: 'failed',
        evidenceCount: 0,
        duplicateRisk: 'none',
        blockers: ['Freshsales evidence fetch failed'],
        headlineReason: 'Freshsales unreachable from worker.',
      };

  // Real enrich state from the outreach progress record (review P2b): no longer hardcoded.
  const enrichmentStatus = outreach.contactsWorked > 0 ? 'complete' : 'not_requested';
  const apolloBlock = apollo
    ? {
        status: apollo.status,
        candidateCount: apollo.candidateCount,
        tieredCounts: apollo.tieredCounts,
        enrichmentStatus,
        creditsConsumed: (apollo.creditsConsumed ?? 0) + outreach.creditsApollo,
        headlineReason: apollo.headlineReason,
      }
    : {
        status: 'failed',
        candidateCount: 0,
        tieredCounts: { recommended: 0, maybe: 0, hold: 0 },
        enrichmentStatus,
        creditsConsumed: outreach.creditsApollo,
        headlineReason: 'Apollo unreachable from worker.',
      };

  // Real Clearout verify state from the progress record (review P2b): no longer hardcoded not_run/0.
  const clearoutBlock = {
    status: outreach.contactsWorked > 0 ? 'ok' : 'not_run',
    verified: outreach.verified,
    risky: outreach.risky,
    invalid: outreach.invalid,
    creditsConsumed: outreach.creditsClearout,
    headlineReason:
      outreach.contactsWorked > 0
        ? `${outreach.verified} verified, ${outreach.risky} risky, ${outreach.invalid} invalid across ${outreach.contactsWorked} worked contact(s).`
        : 'Clearout not run yet for this account.',
  };

  const dayAiBlock = {
    status: pendingSync.length > 0 ? 'failed' : accountRecords.length > 0 ? 'ok' : 'no_data',
    savedObjects: accountRecords.map((r) => ({
      type: r.type,
      id: r.id,
      name: r.name,
      link: r.link,
      idempotencyKey: r.idempotencyKey,
    })),
    pendingSync: pendingSync.map((e) => ({
      attemptedWrite: e.attemptedWrite,
      idempotencyKey: e.idempotencyKey,
      reason: e.reason,
    })),
    links: accountRecords.map((r) => r.link).filter(Boolean),
    headlineReason: pendingSync.length > 0
      ? `${pendingSync.length} pending Day AI write(s) need retry.`
      : `${accountRecords.length} Day AI record(s) saved for this account.`,
  };

  // 4. Color is worst of all provider statuses + pending sync.
  let color = 'green';
  if (freshsalesBlock.duplicateRisk === 'high') color = bump(color, 'yellow');
  if (apolloBlock.status === 'no_data') color = bump(color, 'yellow');
  if (apolloBlock.status === 'failed') color = bump(color, 'red');
  if (freshsalesBlock.status === 'failed') color = bump(color, 'red');
  if (dayAiBlock.pendingSync.length > 0) color = bump(color, 'red');
  if (dayAiBlock.status === 'no_data' && accountRecords.length === 0) color = bump(color, 'yellow');

  // 5. Narrative + next action.
  const narrative = renderNarrative({
    displayName,
    canonicalDomain,
    color,
    freshsalesBlock,
    apolloBlock,
    clearoutBlock,
    dayAiBlock,
  });

  const nextAction = decideNextAction({ color, freshsalesBlock, apolloBlock, dayAiBlock });

  const receipt = {
    version: '1.0',
    generatedAt: now,
    account: {
      canonicalDomain,
      displayName: displayName ?? canonicalDomain,
    },
    summary: {
      color,
      headline: `${color.charAt(0).toUpperCase()}${color.slice(1)} - ${displayName ?? canonicalDomain}.`,
      narrative,
      nextAction,
      headlineReasonByProvider: {
        freshsales: freshsalesBlock.headlineReason,
        apollo: apolloBlock.headlineReason,
        clearout: clearoutBlock.headlineReason,
        dayAi: dayAiBlock.headlineReason,
      },
    },
    providers: {
      freshsales: freshsalesBlock,
      apollo: apolloBlock,
      clearout: clearoutBlock,
      dayAi: dayAiBlock,
    },
    contacts: progress?.contacts
      ? Object.values(progress.contacts).map((c) => ({
          name: c.name,
          email: c.email,
          emailVerdict: c.emailVerdict,
          decision: c.emailVerdict === 'verified' ? 'queued' : 'hold-for-review',
          workedAt: c.workedAt,
        }))
      : [],
    approvedBy: approvingAm ?? 'unknown@ask-myra.ai',
    approvals: accountRecords.map((r) => ({
      action: r.type,
      approvedBy: r.approvingAm,
      approvedAt: r.writtenAt,
      idempotencyKey: r.idempotencyKey,
      objectType: r.type,
      objectId: r.id,
    })),
    idempotencyKeys: accountRecords.map((r) => r.idempotencyKey).filter(Boolean),
    persistence: {},
  };

  if (includeExpanded || color !== 'green') {
    receipt.expanded = {
      freshsales,
      apollo,
      pendingSync,
      dayAiRecords: accountRecords,
    };
  }

  // 6. Persist receipt to Day AI context page (worker handles atomically).
  if (dayAiBlock.savedObjects.find((o) => o.type === 'organization')) {
    const orgId = dayAiBlock.savedObjects.find((o) => o.type === 'organization').id;
    try {
      const page = await writeDayAiContextPage({
        canonicalDomain,
        organizationId: orgId,
        title: `myRA tour receipt - ${now}`,
        bodyMarkdown: renderMarkdown(receipt),
        approvingAm,
      });
      receipt.persistence.dayAiContextPageId = page.pageId;
      receipt.persistence.dayAiContextPageLink = page.link;
    } catch (error) {
      receipt.summary.color = bump(receipt.summary.color, 'red');
      receipt.providers.dayAi.pendingSync.push({
        attemptedWrite: 'receipt-context-page',
        idempotencyKey: `receipt|${canonicalDomain}|${now.slice(0, 10)}`,
        reason: error.message,
      });
    }
  }

  return receipt;
}

function bump(current, candidate) {
  return COLOR_RANK[candidate] > COLOR_RANK[current] ? candidate : current;
}

function renderNarrative({ displayName, canonicalDomain, color, freshsalesBlock, apolloBlock, clearoutBlock, dayAiBlock }) {
  const name = displayName ?? canonicalDomain;
  const parts = [];
  parts.push(`${name}: ${capitalize(color)}.`);
  if (dayAiBlock.savedObjects.length > 0) {
    parts.push(`${dayAiBlock.savedObjects.length} Day AI record${dayAiBlock.savedObjects.length === 1 ? '' : 's'} saved.`);
  }
  if (apolloBlock.candidateCount > 0) {
    parts.push(
      `${apolloBlock.candidateCount} candidate${apolloBlock.candidateCount === 1 ? '' : 's'} from Apollo (${apolloBlock.tieredCounts.recommended} Recommended).`,
    );
  }
  if (clearoutBlock.verified + clearoutBlock.risky + clearoutBlock.invalid > 0) {
    parts.push(
      `Clearout: ${clearoutBlock.verified} verified, ${clearoutBlock.risky} risky, ${clearoutBlock.invalid} invalid.`,
    );
  }
  if (freshsalesBlock.duplicateRisk !== 'none') {
    parts.push(`Freshsales duplicate risk: ${freshsalesBlock.duplicateRisk}.`);
  }
  if (dayAiBlock.pendingSync.length > 0) {
    parts.push(`${dayAiBlock.pendingSync.length} write${dayAiBlock.pendingSync.length === 1 ? '' : 's'} pending sync; retry needed.`);
  }
  return parts.join(' ');
}

function decideNextAction({ color, freshsalesBlock, apolloBlock, dayAiBlock }) {
  if (dayAiBlock.pendingSync.length > 0) {
    return 'Retry pending Day AI sync using the same idempotency key.';
  }
  if (apolloBlock.candidateCount === 0 && dayAiBlock.savedObjects.length === 0) {
    return 'Run /map-contacts to identify ICP contacts.';
  }
  if (color === 'yellow' && freshsalesBlock.duplicateRisk === 'medium') {
    return 'Review Freshsales duplicate candidates before contact canonicalization.';
  }
  if (dayAiBlock.savedObjects.find((o) => o.type === 'person') && !dayAiBlock.savedObjects.find((o) => o.type === 'action')) {
    return 'Run /build-cadence to plan outreach for the saved contacts.';
  }
  return 'Account is in good standing. Proceed to the next checkpoint.';
}

function renderMarkdown(receipt) {
  const lines = [
    `# myRA Tour Receipt`,
    '',
    `**Account:** ${receipt.account.displayName} (${receipt.account.canonicalDomain})`,
    `**Color:** ${receipt.summary.color}`,
    `**Approved by:** ${receipt.approvedBy}`,
    `**Generated:** ${receipt.generatedAt}`,
    '',
    `## Summary`,
    '',
    receipt.summary.narrative,
    '',
    `**Next action:** ${receipt.summary.nextAction}`,
    '',
    `## Providers`,
    '',
    `- Freshsales: ${receipt.providers.freshsales.headlineReason}`,
    `- Apollo: ${receipt.providers.apollo.headlineReason}`,
    `- Clearout: ${receipt.providers.clearout.headlineReason}`,
    `- Day AI: ${receipt.providers.dayAi.headlineReason}`,
    '',
  ];
  if (receipt.providers.dayAi.savedObjects.length > 0) {
    lines.push(`## Saved Day AI objects`, '');
    for (const o of receipt.providers.dayAi.savedObjects) {
      lines.push(`- ${o.type}: ${o.name ?? o.id}${o.link ? ` (${o.link})` : ''}`);
    }
    lines.push('');
  }
  if (receipt.providers.dayAi.pendingSync.length > 0) {
    lines.push(`## Pending sync`, '');
    for (const e of receipt.providers.dayAi.pendingSync) {
      lines.push(`- ${e.attemptedWrite}: ${e.reason} (key: ${e.idempotencyKey})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function capitalize(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
