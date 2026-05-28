# /account-intake

Create the Day AI account motion shell for an AM-selected account.

## Required Inputs

- `account_name`
- `domain`

Optional:

- `aliases`
- `parent_company`
- `owner_email`
- `persona_pack`
- `cadence_pack`
- `channel_pack`

## Reads

- `workflow/config/org-resolution.json` and `/org-resolution` contract before any Organization write.
- `workflow/config/myra-context.json` for account-fit framing.
- `workflow/config/ux-guidance.json` for receipt labels, trust panel, and pending-sync behavior.
- Day AI: existing Organization, Opportunity, People, Actions, Pages, Context for the domain and aliases.
- Freshsales: candidate accounts, contacts/leads, deals, and activities using evidence-based matching through the centralized connector runtime.
- Apollo organization identity when available through the centralized connector.

## Smart Organization Match Gate

Run org resolution before Day AI writes:

- Exact canonical domain or known Day AI source ID: auto-link/update the existing Organization.
- Clear typo/name variant with strong evidence: auto-link/update and show the evidence receipt.
- Parent/subsidiary scope: ask the AM whether to create a separate operating org or link to parent.
- Ambiguous match: block Organization creation and create only review context/action.
- No credible match: allow new Organization creation after showing the no-match evidence receipt.

Store match evidence in Day AI where possible:

- `match_status`
- `match_confidence`
- `matched_day_ai_org_id`
- `candidate_orgs`
- `match_evidence`
- `parent_org_candidate`
- `admin_review_required`
- `idempotency_key`

## Connector Handling

- AMs do not need a Freshsales key.
- Codex should call the centralized Freshsales connector when available.
- If the connector is unavailable, pause with a Freshsales lookup request payload rather than asking the AM for credentials.
- Freshsales is read-only; never create, update, merge, or delete CRM records.

## AM Decision Point

The command invocation authorizes creating or linking the intake shell only after smart org resolution clears the write. Do not create canonical contacts or advance later lifecycle stages.

## Execution

Codex runs intake through the hosted worker in two stages:

```bash
# 1. Resolve identity first (hard gate)
npm run worker:resolve-identity -- \
  --account "<account_name>" --domain <domain> \
  [--owner-email <email>]

# 2. Based on decision.action:
#   - auto_link_existing(_with_receipt)  -> dayai-write org-link
#   - ask_parent_subsidiary_scope        -> pause, ask AM, then org-link or org-create
#   - block_org_creation_create_review_context -> dayai-write review-context only; STOP
#   - allow_new_org_after_receipt        -> show receipt, get AM approval, dayai-write org-create
npm run worker:dayai-write -- \
  --action <org-link|org-create|opportunity-create> \
  --canonical-domain <domain> \
  --idempotency-key <key from resolve-identity> \
  --approving-am <owner_email> \
  --packet <path-to-packet-json>

# 3. Always create the intake Opportunity in Researching after Organization is settled
npm run worker:dayai-write -- \
  --action opportunity-create \
  --canonical-domain <domain> \
  --stage Researching \
  --approving-am <owner_email>
```

Every worker call returns JSON with `dayAiRecordId`, `idempotencyKey`, and `link`. Retries reuse the same idempotency key — the worker rejects duplicate Organization creation server-side.

If the worker is unreachable or any write fails, set `runStatus=blocked`, show Red receipt with the failure detail, queue the attempted write into `tour-run-state.json` `pendingSync[]`, and offer `/retry now` or `/abandon`.

## Day AI Writes

- Create or update/link Organization only according to the org-resolution decision.
- Create Opportunity/account motion in `Researching`.
- Create initial account plan/context with source evidence and known gaps.
- Seed account-level pack choices in Day AI account context when provided.
- If ambiguous, create review context/action only and do not create the Organization.

## Output

- Green/Yellow/Red write receipt.
- Account identity summary.
- Org-resolution decision, candidate duplicates, and evidence receipt.
- Existing Day AI records found.
- Freshsales evidence summary.
- myRA account-fit hypothesis.
- Seeded pack choices, or which choices will fall back to Day AI/global defaults.
- Missing data and next suggested shortcut.
- Trust panel: sources used, what is confident, what needs AM judgment, what was not done, next safest action.

## Pending Sync

If Day AI write fails, show `Red: pending_sync` with attempted write, idempotency key, reason, retry prompt, and duplicate-safety note. Do not retry by creating a second Organization.

## Done Criteria

- Day AI has a canonical account shell with linked source evidence.
- Lifecycle is `Researching`.
- No contacts are canonicalized unless separately approved.
- Duplicate Day AI Organizations are not created by this intake or retry.
