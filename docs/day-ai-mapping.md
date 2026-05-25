# Day AI Mapping

Day AI is the primary system of record for the AM workflow.

## Object Mapping

| Workflow Concept | Day AI Surface | Notes |
| --- | --- | --- |
| Account/company truth | Organization | Primary key is account domain where possible. |
| Account motion/lifecycle | Opportunity | Tracks progress from research through demo, trial, negotiation, and outcome. |
| AM-selected people | Person | Only create canonical contacts after AM approval. |
| Follow-ups/manual steps | Action | Use for calls, LinkedIn, WhatsApp, demo prep, and trial tasks. |
| Email copy | Email draft | Draft only; AM sends after review. |
| Research/account plan | Page or workspace context | Keep account understanding and decision trail readable. |
| Touch ledger | Context/action metadata | Count only AM-selected contacts and Day AI ledger activity. |
| Trial usage | Context/custom properties | Excel import in v1, product API later. |
| Pack choices | Account context and AM profile context | Store persona, cadence, and channel pack choices in Day AI; repo config only provides defaults. |

## Lifecycle

Use these stages consistently:

1. Researching
2. Contacts Mapped
3. Outreach Active
4. Demo Scheduled
5. Demo Done
6. Trial Active
7. Trial Follow-up
8. Negotiation
9. Won
10. Lost
11. Nurture

## Approval Boundaries

Automation may create:

- Research context.
- Account plan pages.
- Tasks/actions.
- Email drafts.
- Intake shell records.

AM approval is required before:

- External sends.
- Canonical contact creation.
- Lifecycle changes after initial intake.
- Calendar event creation in future versions.

## Pack Context

Each account may store:

- `personaPack`
- `cadencePack`
- `channelPack`
- `tone`
- `cta`
- `length`
- `freeformInstructions`

Commands should resolve pack choices from global defaults, Day AI AM profile context, and Day AI account context. If still missing, ask the AM once and save the account-level choice back to Day AI account context.

## Reporting Priorities

1. Lifecycle conversion.
2. Outreach productivity.
3. Trial/product usage.
