# Centralized Connector Model

AMs should be able to use Freshsales, Apollo, and Clearout from Codex without handling API keys. The keys stay in the admin connector runtime. AM packages contain workflow contracts, account packets, and guardrails only.

## Principle

The AM asks Codex for a provider-backed step. Codex routes the request to the centralized connector. The connector returns normalized evidence. Day AI stores the approved account state, selected contacts, actions, drafts, and context.

```text
AM Codex package
  -> slash shortcut
  -> centralized connector request
  -> Freshsales / Apollo / Clearout API
  -> normalized evidence back to Codex
  -> AM approval checkpoint
  -> Day AI write when approved
```

## What AMs Can Trigger

| AM request | Provider used | Shortcut |
|---|---|---|
| Find existing CRM account/contact evidence | Freshsales | `/freshsales-lookup`, `/account-intake`, `/map-contacts` |
| Source net-new contacts for an account | Apollo | `/source-new-contacts`, `/map-contacts` |
| Enrich selected/top-ranked candidate contacts | Apollo | `/source-new-contacts` |
| Verify selected candidate emails | Clearout | `/verify-contact-email`, `/source-new-contacts` |
| Resolve duplicate-safe account identity | Day AI + Freshsales + Apollo | `/org-resolution`, `/account-intake` |

## What AMs Never Need

- Freshsales API key.
- Apollo API key.
- Clearout token.
- Terminal access for provider probes.
- GitHub access.

## Freshsales Flow

Freshsales remains read-only. The connector should follow `docs/freshsales-integration.md`.

```text
account name + domain
  -> lookup candidate Freshsales accounts by domain, aliases, linked contacts, notes, deals, activities, and conversations
  -> classify evidence confidence
  -> return account IDs, contact/lead IDs, deal/activity summaries, owner, notes, and conversation clues
  -> Codex shows AM the evidence
  -> approved summary can be saved to Day AI account context
```

Freshsales history can explain context. It does not count as active AM outreach unless the AM selects/logs it into Day AI.

Freshsales evidence also feeds smart Organization matching. The connector should return sales account IDs, account aliases, linked contact email domains, deal/account references, notes, activities, and conversation clues so Codex can decide whether to link, ask, block, or create in Day AI.

## Apollo Flow

Apollo is for net-new contact discovery and selective enrichment.

```text
account domain + persona pack
  -> Apollo People Search
  -> candidate ranking by role bucket, title, seniority, account fit, and duplicate evidence
  -> AM selects useful candidates
  -> Apollo enrichment only for selected or top-ranked candidates
  -> optional Clearout verification for selected enriched emails
  -> `/dedupe-contacts` before Day AI Person creation
```

Do not create Apollo sequences or write back to Apollo in this workflow.

Apollo organization IDs and domains should be preserved as source evidence for org resolution. Apollo people search should run after imported active contacts and before Freshsales contact evidence in the default lead-identification sequence, with enrichment reserved for AM-approved or top-ranked candidates.

## Clearout Flow

Clearout is a verification gate, not a bulk enrichment step.

```text
selected candidate emails
  -> AM approves verification count
  -> Clearout verifies selected emails
  -> Codex preserves status, reason, source, and timestamp
  -> evidence feeds `/dedupe-contacts`
```

Do not verify every Apollo candidate by default.

## Fallback If Connector Is Not Reachable

Codex should not ask the AM for keys. It should either:

- create a Day AI connector request for the admin/runtime to process, or
- pause and show the exact provider/action/account payload needed.

The AM-facing message should say what will happen next, not expose provider internals.

For Day AI MCP instability, Codex should keep a local receipt of the intended write, use an idempotency key for retries, and show `pending sync` instead of repeating the write blindly.

AM-facing connector outputs should use the same Green/Yellow/Red UX:

- Green: provider evidence is usable or write saved.
- Yellow: AM/admin decision needed, such as paid enrichment or parent/subsidiary scope.
- Red: provider unavailable, ambiguous identity, failed write, or unsafe email.

## Approval Boundaries

- External sends: AM approval required.
- Canonical Day AI People: AM approval required.
- Apollo enrichment: selected/top-ranked only, credit-aware.
- Clearout verification: selected emails only, credit-aware.
- Freshsales: read-only always.
- Day AI writes: show pre-write and post-write receipts.
