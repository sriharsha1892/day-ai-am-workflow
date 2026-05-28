# Contact Sourcing

Contact sourcing is modular. Day AI remains the system of record; providers only supply candidate evidence.

## Providers

| Provider | V1 Role | Secret Scope | Writes |
| --- | --- | --- | --- |
| Freshsales | Existing CRM evidence and activity | Centralized connector | Read-only |
| Apollo | Net-new contact sourcing and selective enrichment | Centralized connector | No Apollo writes |
| Clearout | Selective email verification for enriched/imported candidates | Centralized connector | No Clearout writes |
| Day AI | Canonical account/contact state | AM OAuth | Canonical writes after approval |

AMs can request these provider actions from Codex, but keys remain centralized. If the connector is not reachable, Codex should create a connector request or pause with the exact request payload rather than asking the AM for credentials. See `docs/centralized-connectors.md`.

## Lead Identification Order

Use this order for `/map-contacts`:

1. Imported active contacts from the AM package.
2. Apollo search for net-new candidates.
3. Freshsales MI evidence for existing CRM contacts, leads, account context, deals, activities, notes, and conversations.
4. Day AI existing People.
5. Clearout verification only for selected or enriched emails.

This order keeps known AM context visible, adds net-new coverage, then uses Freshsales as a relationship/history layer without treating old CRM activity as current AM outreach.

## AM Contact Card UX

Before showing dense tables, group candidates into cards:

- `Recommended`: strong role fit and evidence; ask AM to approve, enrich, verify, or draft.
- `Maybe`: useful but incomplete evidence; ask AM whether to keep, enrich, or skip.
- `Hold`: weak fit, duplicate risk, bad email, or ambiguous company evidence.

Each card should include source, role bucket, evidence score, enrichment state, Clearout verification state, and the safest next AM action.

## Apollo Search Fields

Preserve useful fields from Apollo People Search when present:

- Apollo person ID.
- First name, last name, and display name.
- Title and headline.
- LinkedIn URL.
- Organization ID, name, and domain.
- Location fields or location availability flags.
- Has-email and has-phone indicators.
- Last refreshed timestamp.
- Source query, role bucket, and title/seniority match.
- Redacted raw search snapshot.

Apollo People Search does not return emails or phones by default. Treat search results as candidate evidence, not outreach-ready contacts.

## Apollo Enrichment Fields

When enrichment is approved, preserve:

- Email, email status, email source, and confidence when returned.
- Contact ID and Apollo contact object metadata when returned.
- Direct dial status or phone status when requested.
- Employment history summary.
- Organization details and social URLs.
- Enrichment timestamp and credits consumed when available.
- Redacted raw enrichment snapshot.

Selective enrichment is the default. Enrich AM-approved candidates or top-ranked candidates only.

## Clearout Verification Fields

When Clearout verification is approved, preserve:

- Verification status.
- Safe/risky/unknown style classification when returned.
- Deliverability reason or sub-status when returned.
- Verification timestamp.
- Credits consumed when available.
- Redacted raw verification snapshot.

Clearout should verify selected or enriched candidate emails only. Do not bulk-verify every possible email by default.

## New Contact Flow

Use `/source-new-contacts` for AM-requested, connector-backed net-new sourcing:

```text
account/domain
  -> imported active contacts context
  -> Apollo People Search
  -> candidate ranking
  -> Freshsales/Day AI duplicate evidence
  -> selective Apollo enrichment
  -> selective Clearout verification
  -> AM/admin approval
  -> /dedupe-contacts
  -> Day AI People
```

This flow can produce candidate context, but canonical Day AI People are still created only after approval.

## Day AI Handoff

Before creating Day AI People, the AM must approve selected candidates. The Day AI write receipt should include source provenance and enrichment state.

Example:

```text
Saved to Day AI:
- Person: Jane Doe
- Source: Apollo + AM approved
- Email status: not enriched / verified / risky / unknown
- Source trail: title match, company domain match, Apollo person ID
- Next step: enrich email or draft outreach after approval
```
