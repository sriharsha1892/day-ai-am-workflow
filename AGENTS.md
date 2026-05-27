# myRA AM Workflow Pack

Codex is the guided execution surface. Day AI is the system of record.

## Start Here

If the user says any of these, run `/guided-tour`:

- `Start my myRA AM tour`
- `Start my AM guided tour`
- `Resume my myRA AM tour`

For the tour, load `account-packet.json` first. Use `MY_ACCOUNTS.xlsx` as the AM-facing cockpit, not the runtime source.

## Shortcut Router

Load the matching contract and follow it exactly:

- `/guided-tour` -> `workflow/shortcuts/guided-tour.md`
- `/account-intake` -> `workflow/shortcuts/account-intake.md`
- `/research-account` -> `workflow/shortcuts/research-account.md`
- `/map-contacts` -> `workflow/shortcuts/map-contacts.md`
- `/source-new-contacts` -> `workflow/shortcuts/source-new-contacts.md`
- `/verify-contact-email` -> `workflow/shortcuts/verify-contact-email.md`
- `/freshsales-lookup` -> `workflow/shortcuts/freshsales-lookup.md`
- `/dedupe-contacts` -> `workflow/shortcuts/dedupe-contacts.md`
- `/build-cadence` -> `workflow/shortcuts/build-cadence.md`
- `/draft-outreach` -> `workflow/shortcuts/draft-outreach.md`
- `/log-touch` -> `workflow/shortcuts/log-touch.md`
- `/demo-prep` -> `workflow/shortcuts/demo-prep.md`
- `/trial-start` -> `workflow/shortcuts/trial-start.md`
- `/trial-review` -> `workflow/shortcuts/trial-review.md`
- `/product-update` -> `workflow/shortcuts/product-update.md`
- `/account-health` -> `workflow/shortcuts/account-health.md`

If a required input is missing, ask only for that input.

## Non-Negotiables

- Day AI is canonical for account state, selected contacts, tasks, drafts, ledger, and health.
- Freshsales is read-only.
- Freshsales, Apollo, and Clearout are accessed through the centralized connector runtime; AM packages never contain API keys.
- AM approval is required before external sends, canonical contact creation, lifecycle changes after intake, and future calendar creation.
- Outreach metrics count only AM-selected contacts and Day AI ledger activity.
- Keep outputs grounded in myRA positioning: decision-grade intelligence, expert-validated research, market/competitive/customer/supplier/trend intelligence, internal data integrations, and accountable research outputs.

## Day AI Receipts

Before Day AI writes, show:

- Organization
- Opportunity/account motion
- Context/page
- People
- Actions
- Email drafts

After Day AI writes, show object type, name, status, and link or record ID when available. If Day AI returns no link/ID, say so plainly.

## Config And Details

- Packs: `workflow/config/packs.json`
- Contact sourcing: `workflow/config/contact-sourcing.json`
- Day AI mapping: `docs/day-ai-mapping.md`
- Freshsales: `docs/freshsales-integration.md`
- Centralized connectors: `docs/centralized-connectors.md`
- Apollo/Clearout: `docs/contact-sourcing.md`
- Active contacts import: `docs/active-contacts-import.md`
