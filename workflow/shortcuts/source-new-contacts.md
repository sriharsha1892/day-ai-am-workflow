# /source-new-contacts

Admin-only workflow to source net-new contact candidates for an account.

## Required Inputs

- `account_name`
- `domain`

Optional:

- `persona_pack`
- `target_role_buckets`
- `title_keywords`
- `limit`
- `enrich_selected`
- `verify_selected`

## Reads

- `workflow/config/contact-sourcing.json`.
- `workflow/config/packs.json` for persona role priorities.
- Apollo People Search when enabled and admin secrets are available.
- Apollo enrichment only for explicitly selected or top-ranked candidates.
- Clearout verification only for selected/enriched candidate emails.
- Freshsales/Day AI context only for dedupe evidence when available.

## Does Not Do

- Does not send outreach.
- Does not create Apollo sequences.
- Does not write to Freshsales.
- Does not create Day AI People without AM/admin approval.
- Does not enrich or verify every candidate by default.

## Output

- Candidate table grouped by role bucket.
- Source and evidence trail.
- Enrichment state: `not_requested`, `requested`, `complete`, `failed`, or `not_available`.
- Email verification state when Clearout is used.
- Duplicate warning against Freshsales, imported active contacts, and Day AI People.
- Recommended candidates for AM review.

## Data Preservation

Preserve Apollo search fields, enrichment fields, Clearout verification fields, and redacted/raw source snapshots according to `docs/contact-sourcing.md`.

## Day AI Writes

- None by default.
- May save a non-canonical contact sourcing context note only after admin/AM approval.

## Done Criteria

- Admin/AM has a ranked list of net-new candidates.
- Any enrichment or verification cost was explicitly approved.
- Canonical Day AI contact creation is deferred to `/dedupe-contacts`.
