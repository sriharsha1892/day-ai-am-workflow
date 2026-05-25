# myRA AM Workflow Pack

This workspace defines the standardized account-management workflow for myRA AI with Day AI as the system of record and Codex as the guided execution surface.

## Non-Negotiables

- Day AI is the primary system of record.
- Freshsales is read-only in v1. Never mutate, merge, or delete Freshsales records.
- AMs must approve customer-facing sends, canonical contact creation, lifecycle stage changes after intake, and any future calendar event creation.
- Outreach metrics count only AM-selected contacts and Day AI ledger activity. Freshsales history enriches context but does not automatically count as active outreach.
- Keep outputs grounded in myRA positioning: decision-grade intelligence, expert-validated research, market intelligence, competitive intelligence, customer acquisition, supplier intelligence, trend analysis, internal data integrations, and accountable research outputs.

## Shortcut Execution

When the user invokes one of these slash-style shortcuts, load the matching contract in `workflow/shortcuts/` and follow it exactly:

- `/account-intake` -> `workflow/shortcuts/account-intake.md`
- `/research-account` -> `workflow/shortcuts/research-account.md`
- `/map-contacts` -> `workflow/shortcuts/map-contacts.md`
- `/dedupe-contacts` -> `workflow/shortcuts/dedupe-contacts.md`
- `/build-cadence` -> `workflow/shortcuts/build-cadence.md`
- `/draft-outreach` -> `workflow/shortcuts/draft-outreach.md`
- `/log-touch` -> `workflow/shortcuts/log-touch.md`
- `/demo-prep` -> `workflow/shortcuts/demo-prep.md`
- `/trial-start` -> `workflow/shortcuts/trial-start.md`
- `/trial-review` -> `workflow/shortcuts/trial-review.md`
- `/product-update` -> `workflow/shortcuts/product-update.md`
- `/account-health` -> `workflow/shortcuts/account-health.md`

Each shortcut contract defines required inputs, reads, decision points, writes, and done criteria. If a required input is missing, ask only for that input.

## Pack Resolution

Before producing output for pack-aware shortcuts, load `workflow/config/packs.json` and resolve:

- `personaPack`
- `cadencePack`
- `channelPack`

Resolution order:

1. Global defaults from `workflow/config/packs.json`.
2. Day AI AM profile context.
3. Day AI account context.
4. Ask the AM once if still missing.

Pack-aware shortcuts:

- `/map-contacts`
- `/build-cadence`
- `/draft-outreach`
- `/demo-prep`
- `/product-update`
- `/account-health`

`/account-intake` and bulk provisioning may seed account-level pack choices when provided. Always save chosen account-level packs to Day AI account context. Update AM profile context only when the AM explicitly asks to reuse those choices.

Allowed customizations: persona pack, cadence pack, channel pack, tone, CTA, length, and freeform instructions.

Guardrails cannot be overridden: approval before external sends, approval before canonical contact creation, approval before lifecycle changes after intake, Freshsales read-only mode, no calendar write in v1, and Day AI ledger-only outreach metrics.

## Shared Defaults

- Lifecycle stages: `Researching`, `Contacts Mapped`, `Outreach Active`, `Demo Scheduled`, `Demo Done`, `Trial Active`, `Trial Follow-up`, `Negotiation`, `Won`, `Lost`, `Nurture`.
- ICP role buckets: `Strategy`, `Market Intelligence`, `Insights/Research`, `Innovation`, `Corporate Development`, `Procurement`, `Business Unit Leader`.
- Account seed: account name plus primary domain.
- AM customization model: admin defaults plus AM overrides.
- Trial usage source: Excel import until a product API is available.
- Flexible packs: `personaPack`, `cadencePack`, and `channelPack` from `workflow/config/packs.json`.

## Day AI Write Surfaces

Use Day AI MCP tools when available:

- Organization: company truth and account metadata.
- Opportunity: lifecycle progress and commercial motion.
- People: canonical AM-selected ICP contacts.
- Actions: follow-ups, call tasks, manual LinkedIn/WhatsApp tasks, demo/trial tasks.
- Email drafts: AM-reviewed outreach and follow-up drafts.
- Pages/context: account plan, research, signals, call notes, trial notes, decisions, and account health snapshots.

## Freshsales Boundary

Use `docs/freshsales-integration.md` as the source of truth for Freshsales. Required principles:

- Server-side API key only.
- Use contact/lead lookup, account/deal fetches, activities, conversations, notes, and selectors.
- Use evidence-based account matching because account names are inconsistent.
- Handle conversations through the multi-probe pattern.
- Respect rate limits, concurrency, retries, and cache TTLs.
- Do not cache conversations or notes.
