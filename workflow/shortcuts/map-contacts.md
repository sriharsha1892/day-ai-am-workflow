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

- Freshsales contacts/leads/accounts/deals/activities/conversations/notes.
- Apollo candidate contacts when the admin-side Apollo provider is enabled.
- Imported active contacts from `account-packet.json` when present.
- Day AI existing People, Organization relationships, Actions, Context, and Gmail history if available.
- `workflow/config/packs.json` plus Day AI AM/account pack context.
- `workflow/config/contact-sourcing.json` for provider status and approval rules.

## Pack Resolution

- Resolve `personaPack` before ranking role gaps.
- If missing after global, Day AI AM profile, and Day AI account context, ask the AM once.
- Save the selected account-level persona pack to Day AI account context.

## Matching Rules

- Do not trust company name alone.
- Prefer evidence from domain, linked sales account, email domain, deals, activities, conversations, notes, aliases, and parent/subsidiary clues.
- Normalize Freshsales, Apollo, Day AI, and manual candidates into the shared contact-candidate shape.
- Treat imported active contacts as warm candidates/context, not as canonical Day AI People unless the AM approves them.
- Preserve Apollo normalized fields and a redacted/raw source snapshot; do not discard fields just because they are not canonical Day AI Person fields yet.
- Assign each candidate an evidence score and source trail.

## AM Decision Point

AM chooses which candidates are useful and which ICP role bucket each selected contact belongs to.

## Day AI Writes

- None by default.
- May write a non-canonical contact map/context note if the AM asks to save the mapping.

## Output

- Candidate contact table.
- Source label: `Freshsales existing`, `Apollo net-new`, `Day AI existing`, or `Manual`.
- Include `Imported active contact` for contacts supplied through AM package import.
- Evidence/source trail.
- Enrichment state: `not requested`, `requested`, `complete`, `failed`, or `not available`.
- ICP role fit based on the resolved persona pack.
- Missing role gaps.
- Suggested next shortcut: `/dedupe-contacts` for AM-selected contacts.

## Done Criteria

- AM has selected useful contacts before canonicalization.
