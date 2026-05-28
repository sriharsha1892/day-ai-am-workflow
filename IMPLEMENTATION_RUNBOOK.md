# myRA AM Workflow Implementation Runbook

This is the practical rollout path for turning the workflow pack into a live AM operating process.

## 1. Confirm Prerequisites

### Day AI

Each AM should configure their own Codex clone:

```bash
npm install
npm run setup:codex
npm run doctor:codex
```

The setup command configures Day AI MCP in that user's local Codex config and starts Day AI OAuth. Start a fresh Codex session from this workspace so `AGENTS.md` is loaded.

### Freshsales

Freshsales is read-only in v1. Set the API key only in the server-side/runtime environment that will fetch Freshsales data:

```env
FRESHSALES_API_KEY=...
FRESHSALES_ORG_DOMAIN=mordorintelligence
```

Do not expose this key in browser/client code.

### Trial Usage

Until a product API exists, collect usage snapshots in the CSV shape defined by:

```text
templates/trial-usage-import.csv
```

Validate a file with:

```bash
npm run validate:trial-import
```

or:

```bash
node scripts/validate-trial-import.mjs path/to/usage.csv
```

### Workflow Packs

Persona, cadence, and channel packs live in:

```text
workflow/config/packs.json
```

Validate them with:

```bash
npm run validate:packs
```

Commands resolve packs from global defaults, Day AI AM profile context, Day AI account context, then ask the AM once if still missing.

### myRA Context And Org Resolution

Every account, contact, cadence, outreach, demo, trial, product update, and health recommendation must load:

```text
workflow/config/myra-context.json
```

The duplicate-safe Organization match gate lives in:

```text
workflow/config/org-resolution.json
```

The AM UX rules live in:

```text
workflow/config/ux-guidance.json
```

Validate both with:

```bash
npm run validate:workflow-configs
npm run check:org-duplicates
```

## 2. Configure Day AI Objects

Create or confirm these Day AI concepts exist:

- Organization records keyed by company/domain.
- Opportunity or equivalent account motion record.
- People/contact records.
- Actions/tasks.
- Email drafts.
- Pages or context notes.

Use these lifecycle values consistently:

```text
Researching
Contacts Mapped
Outreach Active
Demo Scheduled
Demo Done
Trial Active
Trial Follow-up
Negotiation
Won
Lost
Nurture
```

Recommended custom fields:

### Organization

- `primary_domain`
- `canonical_domain`
- `domain_aliases`
- `aliases`
- `parent_company`
- `parent_org_candidate`
- `freshsales_account_ids`
- `apollo_organization_id`
- `match_status`
- `match_confidence`
- `matched_day_ai_org_id`
- `candidate_orgs`
- `match_evidence`
- `admin_review_required`
- `idempotency_key`
- `research_status`
- `signal_summary`
- `next_best_action`

### Person

- `role_bucket`
- `source_system`
- `freshsales_contact_ids`
- `dedupe_confidence`
- `selected_by_am`
- `outreach_status`

### Opportunity / Account Motion

- `lifecycle_stage`
- `demo_status`
- `trial_status`
- `trial_start_date`
- `negotiation_status`
- `myra_use_case`
- `next_follow_up_at`

## 3. Run The First Pilot Account

Pick one real account. The AM should provide:

```text
account_name:
domain:
aliases, if known:
parent_company, if known:
owner_email:
```

Then run the workflow in this order:

```text
Start my myRA AM tour in beginner mode
/org-resolution account_name="..." domain="..."
/account-intake account_name="..." domain="..."
/research-account domain="..."
/map-contacts domain="..." aliases="..."
/dedupe-contacts selected_contacts="..."
/build-cadence domain="..." selected_contacts="..."
/draft-outreach domain="..." contact="..."
```

Only after AM review:

```text
/log-touch domain="..." contact="..." channel="email" outcome="sent" note="..."
```

For demo/trial flow:

```text
/demo-prep domain="..." attendees="..."
/trial-start domain="..." trial_status="Trial Active"
/trial-review usage_csv="path/to/usage.csv"
/account-health domain="..."
```

## 3A. One-Time AM Account Provisioning

The AM roster is stored in:

```text
templates/am-roster.csv
```

Validate it:

```bash
npm run validate:roster
```

Use the assignment template:

```text
templates/am-account-assignments.csv
```

Required columns:

```text
am_email, am_name, account_name, domain
```

Optional pack columns:

```text
persona_pack, cadence_pack, channel_pack
```

Blank pack cells fall back to Day AI AM profile context or global defaults.

Validate assignments:

```bash
npm run validate:assignments
```

Preview the `/account-intake` commands for all assignments:

```bash
npm run provision:assignments:preview
```

Run the generated commands from a fresh Codex session in this workspace. This creates account intake shells through the normal slash-command flow and preserves approval guardrails.

Do not create a Day AI Organization when `/org-resolution` returns an ambiguous match. Create review context/action only.

## 4. Approval Rules During Pilot

Automation may create:

- Day AI account shell.
- Duplicate-review context/action when org resolution is ambiguous.
- Research/account context.
- Account plan page.
- Internal tasks.
- Email drafts.
- Trial usage summaries.
- Account health snapshots.

AM must approve:

- External sends.
- Canonical contact creation.
- Lifecycle stage changes after initial intake.
- Any future calendar event creation.

AMs may customize persona pack, cadence pack, channel pack, tone, CTA, length, and freeform instructions. They may not override approval rules, lifecycle definitions, Freshsales read-only mode, no-calendar-write-in-v1, or Day AI ledger-only outreach metrics.

## 5. Freshsales Implementation Boundary

Freshsales fetch logic must follow:

```text
docs/freshsales-integration.md
```

Key implementation rules:

- Match accounts by evidence, not name.
- Search contacts and leads.
- Include accounts, deals, activities, conversations, and notes as evidence.
- Use the multi-probe conversation pattern.
- Do not cache conversations or notes.
- Respect rate limits.
- Do not write to Freshsales in v1.

## 6. Pilot Acceptance Criteria

Run 5-10 accounts through the workflow. The pilot is successful when:

- AMs can start from account name + domain.
- Research output is useful before outreach.
- Freshsales contact matching works despite messy account names.
- Duplicate-safe org resolution links exact domains, asks on parent/subsidiary ambiguity, and blocks ambiguous creates.
- AMs can use natural prompts without knowing slash commands.
- The workbook shows Command Cards, Trust Panel, Contact Cards, and Admin Readiness.
- Day AI write failures show `pending_sync` with retry prompt and idempotency key.
- AMs can select useful contacts before canonicalization.
- Day AI contains selected contacts, tasks, drafts, and account context.
- Outreach stats reflect Day AI ledger activity only.
- Trial usage can be imported from CSV.
- `/account-health` gives a useful account state and next best action.

## 7. Rollout Sequence

1. Run one account end-to-end with a single AM.
2. Adjust ICP role defaults and cadence defaults in `workflow/config/default-playbook.yml`.
3. Run 5-10 accounts across 2 AMs.
4. Create Day AI views for lifecycle, stale next steps, demo pipeline, trial follow-up, and negotiation.
5. Document the final AM operating rhythm.
6. Only then consider deeper automation, calendar write access, LinkedIn/WhatsApp integrations, or product API usage sync.

## 8. Daily AM Rhythm

Morning:

- Run `/account-health` for priority accounts.
- Review due Day AI actions.
- Send approved drafts.

During work:

- Use `/log-touch` after each meaningful email, call, LinkedIn, or WhatsApp step.
- Use `/draft-outreach` when account context changes.

Weekly:

- Run `/trial-review` for trial accounts.
- Run `/account-health` for all active opportunities.
- Move stages only after AM review.
