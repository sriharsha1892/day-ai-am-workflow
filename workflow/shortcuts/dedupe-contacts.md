# /dedupe-contacts

Canonicalize AM-approved contacts in Day AI.

## Required Inputs

- AM-selected contact list from `/map-contacts`.
- Account domain or account motion ID.

## Reads

- Day AI existing People for the account/domain.
- Freshsales selected contact/lead details, activities, conversations, notes, and source IDs.
- Apollo selected candidate details, enrichment metadata, and source snapshots when available.
- Imported active contacts from `account-packet.json` when available.

## Matching Rules

- Aggressive evidence-based matching across email, LinkedIn, phone, name/title/company, Freshsales IDs, account evidence, and conversation evidence.
- Include Apollo person ID, Apollo contact ID, organization ID, LinkedIn URL, title, organization domain, email status, and enrichment state in the evidence bundle when present.
- Include Clearout verification status and reason when present.
- Include imported contact source fields, last touch, relationship status, and AM ownership when present.
- Keep a confidence score and source trail.
- Never merge or mutate Freshsales records.
- Never create Apollo contacts or sequences in v1.

## AM Decision Point

AM approval is required before creating or updating canonical Day AI people.

## Day AI Writes

- Create or update one canonical Day AI Person per approved contact.
- Attach custom/source metadata when available.
- Link contact to the account motion using Day AI relationships/context where available.
- Attach source provenance and redacted/raw source snapshot references to Day AI context where available.

## Output

- Canonical contacts created/updated.
- Duplicate clusters and confidence.
- Contacts skipped and why.

## Done Criteria

- AM-approved contacts exist canonically in Day AI.
- Freshsales remains unchanged.
