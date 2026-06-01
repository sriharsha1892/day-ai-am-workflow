// Interpretation-stamping helper. Pure + testable, no network. Reads workflow/config/tool-rendering.json
// and turns any in-scope tool result into a uniform 4-line "interpretation card" the model renders verbatim:
//   Ran    — the tool + its role         (e.g. "Freshsales (CRM · read-only)")
//   Found  — counts/summary
//   Means  — plain-English meaning for the AM
//   Source — [badge] + confidence cue + cache/cost/staleness flags
// Plus a contacts grouper that splits Freshsales ("Existing MI contacts") from Apollo ("Net-new")
// into two labelled groups, never merged, MI first. Editing tool-rendering.json alone changes every
// card — no code change here.
//
// Every field reference is grounded in the real provider results (worker/providers/*.mjs, outreach.mjs,
// receipt.mjs, day-ai.mjs). See workflow/config/tool-rendering.json `_doc` for the field map.

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = 'workflow/config/tool-rendering.json';

let _cache = null;
export function loadRenderConfig(force = false) {
  if (_cache && !force) return _cache;
  _cache = JSON.parse(fs.readFileSync(path.resolve(CONFIG_PATH), 'utf8'));
  return _cache;
}

// ---- token substitution (templates use {field}; missing → empty string) ----
function fill(template, vars) {
  if (template == null) return '';
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
}

// ---- cache / staleness / cost surfacing ------------------------------------
function cacheState(result, cfg) {
  const served =
    result?.fromCache === true ||
    (typeof result?.servedFromCache === 'number' && result.servedFromCache > 0 && (result.creditsConsumed ?? 0) === 0);
  return served ? cfg.cacheNote : null;
}

function staleness(result, cfg) {
  const h = result?.ageHours;
  if (h == null) return null;
  if (h === 0) return { text: cfg.freshTemplate, stale: false };
  const stale = h > (cfg.staleHours ?? 24);
  const text = fill(cfg.stalenessTemplate, { ageHours: h }) + (stale ? cfg.staleSuffix ?? '' : '');
  return { text, stale };
}

function costApproval(result, cfg) {
  return result?.needsCostApproval === true ? cfg.costApprovalNote : null;
}

// ---- confidence ------------------------------------------------------------
const DOWNGRADE = { high: 'med', med: 'low', low: 'low' };

export function resolveConfidence(toolCfg, result, overrides = {}) {
  const conf = toolCfg.confidence ?? {};
  let level = conf.default ?? 'med';
  for (const rule of conf.rules ?? []) {
    const key = rule.when;
    const actual = key in overrides ? overrides[key] : result?.[key];
    if (actual === undefined || actual === null) continue;
    if ('equals' in rule && actual === rule.equals) {
      level = rule.level;
      break;
    }
    if ('in' in rule && Array.isArray(rule.in) && rule.in.includes(actual)) {
      level = rule.level;
      break;
    }
  }
  return level;
}

function confidenceLine(toolCfg, cfg, level, flags) {
  const cue = cfg.confidenceCues[level] ?? cfg.confidenceCues.med;
  const note = toolCfg.confidence?.cueNote?.[level];
  const parts = [`[${toolCfg.badge}]`, toolCfg.label, cue];
  if (note) parts.push(`— ${note}`);
  if (flags && flags.length) parts.push(`· ${flags.join(' · ')}`);
  return parts.join(' ');
}

// ---- per-tool builders: each returns { branch, vars, overrides, glyphKey?, glyphVal? } ----
const BUILDERS = {
  freshsales_evidence(r) {
    const accountsCount = r.accounts?.length ?? 0;
    const contactsCount = r.contacts?.length ?? 0;
    const dealsCount = r.deals?.length ?? 0;
    const branch = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'no_data';
    return {
      branch,
      vars: { accountsCount, contactsCount, dealsCount, duplicateRisk: r.duplicateRisk ?? 'none', error: r.error ?? '' },
      overrides: { status: r.status, duplicateRisk: r.duplicateRisk },
    };
  },

  apollo_search(r) {
    const t = r.tieredCounts ?? { recommended: 0, maybe: 0, hold: 0 };
    const branch = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'no_data';
    return {
      branch,
      vars: { candidateCount: r.candidateCount ?? 0, recommended: t.recommended ?? 0, maybe: t.maybe ?? 0, hold: t.hold ?? 0 },
      overrides: { status: r.status },
    };
  },

  apollo_enrich(r) {
    const enrichedCount = Array.isArray(r.enriched) ? r.enriched.filter((e) => e?.email).length : 0;
    const branch = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'no_data';
    const servedFromCacheNote = r.servedFromCache ? `, ${r.servedFromCache} from cache (0 credits)` : '';
    return {
      branch,
      vars: { enrichedCount, creditsConsumed: r.creditsConsumed ?? 0, servedFromCacheNote },
      overrides: { status: r.status },
    };
  },

  clearout_verify(r) {
    const branch = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'no_data';
    const servedFromCacheNote = r.servedFromCache ? `, ${r.servedFromCache} from cache (0 credits)` : '';
    const verdict =
      r.status === 'failed' ? 'failed'
        : (r.verified ?? 0) > 0 ? 'verified'
          : (r.risky ?? 0) > 0 ? 'risky'
            : (r.invalid ?? 0) > 0 ? 'invalid'
              : 'risky';
    return {
      branch,
      vars: { verified: r.verified ?? 0, risky: r.risky ?? 0, invalid: r.invalid ?? 0, creditsConsumed: r.creditsConsumed ?? 0, servedFromCacheNote },
      overrides: { status: r.status, verdict },
    };
  },

  dayai_write(r) {
    const branch = r.ok === false ? 'failed' : r.replayed ? 'replayed' : 'ok';
    const linkPhrase = r.link ? ` — view: ${r.link}` : '';
    return {
      branch,
      vars: {
        type: r.type ?? r.action ?? 'record',
        name: r.name ?? '(unnamed)',
        approvingAm: r.approvingAm ?? 'you',
        idempotencyKey: r.idempotencyKey ?? '',
        linkPhrase,
      },
      overrides: { ok: r.ok !== false },
      glyphKey: 'ok',
      glyphVal: r.ok !== false ? 'true' : 'false',
    };
  },

  build_receipt(r) {
    const s = r.summary ?? {};
    const color = s.color ?? 'yellow';
    return {
      branch: color,
      vars: { headline: s.headline ?? `${color} account`, narrative: s.narrative ?? '', nextAction: s.nextAction ?? '' },
      overrides: { color },
      glyphKey: 'color',
      glyphVal: color,
    };
  },

  work_contact(r) {
    if (r.needsCostApproval) {
      const p = r.projected ?? {};
      return {
        branch: 'needsCostApproval',
        vars: { projectedApollo: p.apollo ?? 0, projectedClearout: p.clearout ?? 0, message: r.message ?? '', contactName: r.contact?.name ?? 'this contact' },
        overrides: { needsCostApproval: true },
      };
    }
    const e = r.email ?? {};
    const verdict = e.verdict ?? 'failed';
    const noEmail = !e.address;
    const branch = noEmail ? 'noEmail' : 'ready';
    const queueNote = verdict === 'verified' ? 'Queue-ready.' : 'Held for review — not queue-ready.';
    const recentTouchNote = r.recentTouch
      ? ` ↩ already touched ${r.recentTouch.when} (${r.recentTouch.channel}, ${r.recentTouch.byWhom}).`
      : '';
    return {
      branch,
      vars: {
        contactName: r.contact?.name ?? 'Contact',
        contactTitle: r.contact?.title ?? '',
        emailAddress: e.address ?? '',
        emailVerdict: verdict,
        emailReason: e.reason ?? 'no deliverable email found',
        emailGlyph: '',
        creditsApollo: r.credits?.apollo ?? 0,
        creditsClearout: r.credits?.clearout ?? 0,
        queueNote,
        recentTouchNote,
      },
      overrides: { verdict },
      glyphKey: 'verdict',
      glyphVal: verdict,
    };
  },

  work_contacts(r) {
    if (r.needsCostApproval) {
      const p = r.projected ?? {};
      return {
        branch: 'needsCostApproval',
        vars: { total: r.total ?? 0, projectedApollo: p.apollo ?? 0, projectedClearout: p.clearout ?? 0, message: r.message ?? '' },
        overrides: { needsCostApproval: true },
      };
    }
    const results = Array.isArray(r.results) ? r.results : [];
    const verifiedCount = results.filter((x) => x?.email?.verdict === 'verified').length;
    const heldCount = results.filter((x) => x && !x.needsCostApproval && x?.email?.verdict !== 'verified').length;
    return {
      branch: 'ready',
      vars: { total: r.total ?? results.length, verifiedCount, heldCount, creditsApollo: r.credits?.apollo ?? 0, creditsClearout: r.credits?.clearout ?? 0 },
      overrides: { ok: r.ok !== false },
    };
  },
};

// ---- the core interpret() --------------------------------------------------
// interpret(toolName, result, config?) -> the interpretation block, or null for an unmapped tool.
export function interpret(toolName, result, config) {
  const cfg = config ?? loadRenderConfig();
  const toolCfg = cfg.tools?.[toolName];
  const builder = BUILDERS[toolName];
  if (!toolCfg || !builder || result == null) return null;

  const built = builder(result);

  let glyph = '';
  if (built.glyphKey && toolCfg.verdictGlyphs?.[built.glyphKey]) {
    glyph = toolCfg.verdictGlyphs[built.glyphKey][built.glyphVal] ?? '';
  }
  if (toolName === 'work_contact' && built.vars) built.vars.emailGlyph = glyph;

  const foundTpl = toolCfg.found?.[built.branch] ?? toolCfg.found?.ok ?? '';
  const meaningTpl = toolCfg.meaning?.[built.branch] ?? toolCfg.meaning?.ok ?? '';
  const found = fill(foundTpl, built.vars);
  const means = fill(meaningTpl, built.vars);

  let level = resolveConfidence(toolCfg, result, built.overrides ?? {});
  const cache = cacheState(result, cfg);
  const stale = staleness(result, cfg);
  if (stale?.stale) level = DOWNGRADE[level] ?? level;
  const cost = costApproval(result, cfg);
  const flags = [cache, stale?.text, cost].filter(Boolean);
  const source = confidenceLine(toolCfg, cfg, level, flags);

  const ran = `${toolCfg.label} (${toolCfg.role})`;

  const block = { badge: toolCfg.badge, label: toolCfg.label, role: toolCfg.role, ran, found, means, source, confidence: level, confidenceReason: toolCfg.confidence?.cueNote?.[level] ?? null };
  if (glyph) block.glyph = glyph;

  const groups = groupContacts(toolName, result, cfg);
  if (groups) block.groups = groups;

  return block;
}

// ---- contacts grouper ------------------------------------------------------
export function groupContacts(toolName, result, config) {
  const cfg = config ?? loadRenderConfig();
  const out = [];
  if (toolName === 'freshsales_evidence' && Array.isArray(result.contacts)) {
    out.push(renderFreshsalesGroup(result.contacts, cfg.groups.freshsales));
  }
  if (toolName === 'apollo_search' && Array.isArray(result.candidates)) {
    out.push(renderApolloGroup(result.candidates, cfg.groups.apollo));
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => a.order - b.order);
}

// "[FS] Name — Title · owner · ↩ contacted <relative>" — the ↩ ONLY on a real recent touch
// (freshsales.mjs maps lastActivity from last_contacted_via_sales_activity, NULL otherwise). Owner
// prefers the resolved ownerName (provider attaches it), falling back to "owner <id>" then "unowned".
function renderFreshsalesGroup(contacts, g) {
  const rows = contacts.map((c) => {
    const touchNote =
      c.lastActivity && withinDays(c.lastActivity, g.touchMaxDays)
        ? fill(g.touchTemplate, { when: humanAgo(c.lastActivity) })
        : '';
    const owner = c.ownerName ? `owner ${c.ownerName}` : c.owner != null ? `owner ${c.owner}` : 'unowned';
    return fill(g.rowTemplate, {
      name: c.name && c.name.trim() ? c.name : c.email ?? '(no name)',
      title: c.title && c.title.trim() ? c.title : 'role unknown',
      owner,
      touchNote,
    });
  });
  return { key: g.key, title: g.title, subtitle: g.subtitle, order: g.order, count: rows.length, rows, emptyState: rows.length === 0 ? g.emptyState : null };
}

// "[AP] ★ Recommended / Maybe — Name — Title" — Hold suppressed; sorted by tierRank.
function renderApolloGroup(candidates, g) {
  const visible = candidates
    .filter((c) => g.showTiers.includes(c.tier))
    .sort((a, b) => (g.tierRank[a.tier] ?? 9) - (g.tierRank[b.tier] ?? 9));
  const rows = visible.map((c) =>
    fill(g.rowTemplate, {
      tierGlyph: g.tierGlyphs[c.tier] ?? c.tier,
      name: c.name && c.name.trim() ? c.name : '(no name)',
      title: c.title && c.title.trim() ? c.title : 'role unknown',
    }),
  );
  return { key: g.key, title: g.title, subtitle: g.subtitle, order: g.order, count: rows.length, rows, emptyState: rows.length === 0 ? g.emptyState : null };
}

// ---- relative-date helpers (mirror outreach.mjs humanAgo; kept local to stay pure) ----
function ageDays(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}
function withinDays(iso, days) {
  const d = ageDays(iso);
  return Number.isFinite(d) && d >= 0 && d <= days;
}
function humanAgo(iso) {
  const d = ageDays(iso);
  if (!Number.isFinite(d)) return 'recently';
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)} days ago`;
}
