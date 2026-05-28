# /map-contacts

Find and classify candidate contacts for the account without creating canonical contacts yet.

## Required Inputs

- `domain` or Day AI account motion ID.

Optional:

- `aliases`
- `subsidiaries`
- `target_role_buckets`
- known emails or Freshsales IDs.

## Reads

- `workflow/config/myra-context.json` for role-bucket and persona value framing.
- `workflow/config/ux-guidance.json` for contact cards, trust panel, and receipt labels.
- Freshsales contacts/leads/accounts/deals/activities/conversations/notes through the centralized connector.
- Apollo candidate contacts when the centralized Apollo provider is enabled.
- Clearout verification state for candidate emails when available.
- Imported active contacts from `account-packet.json` when present.
- Day AI existing People, Organization relationships, Actions, Context, and Gmail history if available.
- `workflow/config/packs.json` plus Day AI AM/account pack context.
- `workflow/config/contact-sourcing.json` for provider status and approval rules.

## Connector Handling

- AMs can request Freshsales, Apollo, and Clearout-backed contact mapping from Codex without local keys.
- Codex must route provider calls through the centralized connector runtime.
- If the connector is unavailable, pause with a specific connector request instead of asking the AM for keys.
- Freshsales is always read-only; Apollo and Clearout are selective, credit-aware enrich/verify steps.

## Pack Resolution

- Resolve `personaPack` before ranking role gaps.
- If missing after global, Day AI AM profile, and Day AI account context, ask the AM once.
- Save the selected account-level persona pack to Day AI account context.

## Matching Rules

- Lead identification order: imported active contacts, Apollo search, Freshsales MI evidence, Day AI existing People, then Clearout verification only for selected emails.
- Do not trust company name alone.
- Prefer evidence from domain, linked sales account, email domain, deals, activities, conversations, notes, aliases, and parent/subsidiary clues.
- Normalize Freshsales, Apollo, Day AI, and manual candidates into the shared contact-candidate shape.
- Treat imported active contacts as warm candidates/context, not as canonical Day AI People unless the AM approves them.
- Preserve Apollo normalized fields and a redacted/raw source snapshot; do not discard fields just because they are not canonical Day AI Person fields yet.
- Assign each candidate an evidence score and source trail.

## Execution

Codex chains three worker calls and then leads the AM through bulk-with-veto contact selection:

```bash
# 1. Pull existing CRM context (Freshsales) and Day AI existing People
npm run worker:freshsales-evidence -- --domain <domain>

# 2. Top up with Apollo to fill the 25-candidate slate, persona-aware
npm run worker:apollo-search -- \
  --domain <domain> \
  --persona-pack <resolved-pack> \
  [--target-role-buckets "<comma-list>"] \
  [--limit 25]
```

The worker merges results into one list, tiers each candidate `Recommended | Maybe | Hold` per `ux-guidance.json` `contactCardTiers`, and returns a flat candidate slate with `tier`, `evidenceTrail`, `enrichmentStatus`, `clearoutVerificationStatus`, and `duplicateRiskAgainst` (Freshsales/imported/Day AI).

**Selection UX (default flow per `ux-guidance.json` `contactSelection.defaultFlow = bulk_with_veto_then_walk_maybe`):**

1. Present every `Recommended` candidate as a pre-approved batch by name: *"Approving Jane Doe (Director, Strategy), John Smith (VP Insights), Anita K (Innovation Head). Say a name to veto, or type `select 1, 3, 7` to override entirely."*
2. Walk each `Maybe` candidate one at a time: show evidence + decision (`keep | skip | hold`).
3. Skip every `Hold` candidate unless the AM explicitly says `include hold #N` or `select all Hold`.
4. **Numbered-list power escape is always available at any prompt** (per `ux-guidance.json` `contactSelection.powerEscape = numbered_list_anywhere`): the AM can type `select 1, 3, 7`, `select all Recommended`, `select all Recommended except #4`, `include #14`, etc., and Codex jumps directly to the resulting selection.

No Day AI Person is created here. Selected candidates flow to `/dedupe-contacts`.

If the worker is unreachable, set `runStatus=blocked`, show Red receipt, do not source locally.

## AM Decision Point

AM chooses which candidates are useful and which ICP role bucket each selected contact belongs to.

## Day AI Writes

- None by default.
- May write a non-canonical contact map/context note if the AM asks to save the mapping.

## Output

- Contact cards grouped as `Recommended`, `Maybe`, and `Hold`, followed by a compact candidate table when useful.
- Source label: `Freshsales existing`, `Apollo net-new`, `Day AI existing`, or `Manual`.
- Include `Imported active contact` for contacts supplied through AM package import.
- Evidence/source trail.
- Enrichment state: `not requested`, `requested`, `complete`, `failed`, or `not available`.
- Email verification state when Clearout has verified an enriched/imported email.
- ICP role fit based on the resolved persona pack.
- myRA-specific reason each selected role matters for the account.
- Missing role gaps.
- Suggested next shortcut: `/dedupe-contacts` for AM-selected contacts.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

## Done Criteria

- AM has selected useful contacts before canonicalization.
