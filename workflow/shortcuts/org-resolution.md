# /org-resolution

Resolve whether an account should link to an existing Day AI Organization before any intake write.

## Required Inputs

- `account_name`
- `domain`

Optional:

- `aliases`
- `parent_company`
- `subsidiaries`
- `freshsales_account_ids`
- `apollo_organization_id`
- `owner_email`

## Reads

- `workflow/config/org-resolution.json`.
- `workflow/config/myra-context.json` for account-fit framing.
- `workflow/config/ux-guidance.json` for Green/Yellow/Red receipt labels and trust panel output.
- Day AI Organizations, Opportunities, People, Actions, Pages, Context, aliases, source IDs, and prior match evidence.
- Freshsales sales accounts, contacts/leads, deals, notes, activities, and conversations through the centralized connector.
- Apollo organization identity when available through the centralized connector.
- Public website redirects or official URLs when needed to normalize the domain.

## Matching Rules

- Normalize domain before matching: lowercase, remove protocol, remove leading `www`, and strip path/query.
- Do not trust company name alone.
- Use Day AI source IDs, canonical domain, email domains, Freshsales sales account IDs, Apollo organization ID, aliases, parent/subsidiary evidence, and official source URLs.
- Exact canonical domain or known Day AI source ID auto-links to the existing Organization.
- Clear typo or name variant with strong evidence auto-links and must show the evidence receipt.
- Parent/subsidiary scope requires AM decision: create a separate operating org or link to the parent.
- Ambiguous matches block Organization creation and create only a Day AI review task/context.
- No credible match allows new Organization creation only after showing the no-match evidence receipt.

## AM Decision Point

Ask the AM only when:

- parent/subsidiary scope is not obvious, or
- the AM must resolve an identity-review/ambiguous match.

## Day AI Writes

- For exact/high-confidence matches: update/link existing Organization context and account motion evidence.
- For ambiguous matches: create review context/action only; do not create a new Organization.
- For no credible match: allow `/account-intake` to create a new Organization after AM sees the receipt.

Store these fields when possible:

- `match_status`
- `match_confidence`
- `matched_day_ai_org_id`
- `candidate_orgs`
- `match_evidence`
- `parent_org_candidate`
- `admin_review_required`
- `idempotency_key`

## Execution

Codex runs the resolution through the hosted worker. Do not match locally; the worker reads Day AI + Freshsales + Apollo identity evidence in one shot and returns the canonical 6-tier decision.

```bash
npm run worker:resolve-identity -- \
  --account "<account_name>" \
  --domain <domain> \
  [--aliases "<comma-list>"] [--parent-company "<name>"] \
  [--freshsales-account-ids "<comma-list>"] [--apollo-organization-id <id>] \
  [--owner-email <email>]
```

The worker response (JSON to stdout) carries: `decision.action` (one of `auto_link_existing | auto_link_existing_with_receipt | ask_parent_subsidiary_scope | block_org_creation_create_review_context | allow_new_org_after_receipt`), `decision.matchConfidence`, `candidates[]` with evidence, `idempotencyKey`, and `headlineReason` for the receipt.

If the worker is unreachable, set the account's `runStatus=blocked`, show Red receipt, do not match locally. Offer `/retry now` or `/abandon`.

## Output

- Receipt level:
  - `Green`: exact domain/source ID or strong variant evidence links safely.
  - `Yellow`: parent/subsidiary scope needs AM decision.
  - `Red`: ambiguous match blocks Organization creation.
- Normalized account identity.
- Top Day AI/Freshsales/Apollo candidate matches.
- Match decision: `auto_link_existing`, `ask_parent_subsidiary_scope`, `block_for_review`, or `allow_new_org`.
- Evidence and confidence for the decision.
- Day AI write receipt preview.
- Trust panel: sources used, what is confident, what needs AM judgment, what was not done, next safest action.
- Next command: `/account-intake` only when creation/linking is safe.

## Done Criteria

- Codex has proven whether to link, ask, block, or create.
- Duplicate Day AI Organizations are not created by account intake or retry.
