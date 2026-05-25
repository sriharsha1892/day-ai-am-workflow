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
- Day AI existing People, Organization relationships, Actions, Context, and Gmail history if available.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Pack Resolution

- Resolve `personaPack` before ranking role gaps.
- If missing after global, Day AI AM profile, and Day AI account context, ask the AM once.
- Save the selected account-level persona pack to Day AI account context.

## Matching Rules

- Do not trust company name alone.
- Prefer evidence from domain, linked sales account, email domain, deals, activities, conversations, notes, aliases, and parent/subsidiary clues.
- Assign each candidate an evidence score and source trail.

## AM Decision Point

AM chooses which candidates are useful and which ICP role bucket each selected contact belongs to.

## Day AI Writes

- None by default.
- May write a non-canonical contact map/context note if the AM asks to save the mapping.

## Output

- Candidate contact table.
- Evidence/source trail.
- ICP role fit based on the resolved persona pack.
- Missing role gaps.
- Suggested next shortcut: `/dedupe-contacts` for AM-selected contacts.

## Done Criteria

- AM has selected useful contacts before canonicalization.
