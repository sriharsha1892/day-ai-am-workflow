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
| Organization match evidence | Organization context or review page/action | Prevent duplicate Organizations before intake writes. |
| Sequence state | Actions plus account/contact context | Track branching email, LinkedIn, call, WhatsApp, demo, trial, and internal steps. |
| Pending sync | Context/action metadata | Capture failed Day AI writes with idempotency key and retry prompt. |

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

## Smart Organization Matching

`/account-intake` must run org resolution before creating a Day AI Organization.

Use these Day AI fields or equivalent context/page metadata:

- `match_status`
- `match_confidence`
- `matched_day_ai_org_id`
- `candidate_orgs`
- `match_evidence`
- `parent_org_candidate`
- `admin_review_required`
- `idempotency_key`

Decision rules:

- Exact canonical domain or known Day AI source ID links to the existing Organization.
- Clear spelling/name variants with strong evidence link to the existing Organization and show a receipt.
- Parent/subsidiary ambiguity asks the AM whether to create a separate operating org or link to parent.
- Ambiguous identity blocks Organization creation and creates only review context/action.
- New Organization creation is allowed only after showing that no credible match was found.

Retries must use the same `idempotency_key` and must not create a second Organization.

## Pending Sync UX

If a Day AI write fails or MCP crashes, Codex should show `Red: pending_sync` and store/display:

- attempted write,
- idempotency key,
- reason,
- retry prompt,
- duplicate-safety note.

The retry must use the same idempotency key.

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
