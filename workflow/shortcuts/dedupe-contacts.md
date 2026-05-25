# /dedupe-contacts

Canonicalize AM-approved contacts in Day AI.

## Required Inputs

- AM-selected contact list from `/map-contacts`.
- Account domain or account motion ID.

## Reads

- Day AI existing People for the account/domain.
- Freshsales selected contact/lead details, activities, conversations, notes, and source IDs.

## Matching Rules

- Aggressive evidence-based matching across email, LinkedIn, phone, name/title/company, Freshsales IDs, account evidence, and conversation evidence.
- Keep a confidence score and source trail.
- Never merge or mutate Freshsales records.

## AM Decision Point

AM approval is required before creating or updating canonical Day AI people.

## Day AI Writes

- Create or update one canonical Day AI Person per approved contact.
- Attach custom/source metadata when available.
- Link contact to the account motion using Day AI relationships/context where available.

## Output

- Canonical contacts created/updated.
- Duplicate clusters and confidence.
- Contacts skipped and why.

## Done Criteria

- AM-approved contacts exist canonically in Day AI.
- Freshsales remains unchanged.

