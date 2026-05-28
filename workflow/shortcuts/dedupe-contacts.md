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

## Execution

Codex runs the dedupe + canonicalization through the hosted worker.

```bash
# 1. Run a duplicate check across Day AI People and Freshsales for AM-selected candidates
npm run worker:dayai-write -- \
  --action person-dedupe-check \
  --canonical-domain <domain> \
  --candidates <path-to-selected-candidates.json> \
  --approving-am <owner_email>

# 2. After AM approves the dedupe decision per candidate, canonicalize
npm run worker:dayai-write -- \
  --action person-create \
  --canonical-domain <domain> \
  --candidate <single-candidate-payload> \
  --idempotency-key <key from dedupe-check> \
  --approving-am <owner_email>
```

The `person-dedupe-check` step returns per-candidate `dedupeConfidence`, `matchedDayAiPersonId?`, `freshsalesIds`, `evidenceTrail`, and a decision recommendation (`create_new | link_existing | skip_duplicate`). The AM approves each one.

Every `person-create` write stamps the approving AM and an idempotency key derived from `canonical_domain + email + ISO date`. Retries reuse the same key — the worker rejects duplicate Person creation server-side.

If the worker is unreachable, set `runStatus=blocked`, show Red receipt, do not write locally.

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
