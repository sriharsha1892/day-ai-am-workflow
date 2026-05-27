# /freshsales-lookup

Fetch Freshsales evidence for an account through the centralized connector runtime.

## Required Inputs

- `account_name`
- `domain`

Optional:

- `aliases`
- `known_contact_emails`
- `freshsales_account_ids`
- `freshsales_contact_ids`
- `include_conversations`
- `include_notes`

## Reads

- `workflow/config/contact-sourcing.json`.
- Freshsales account candidates, contacts/leads, linked sales accounts, deals, activities, conversations, notes, owners, lifecycle stages, and field definitions as needed.
- Day AI account context only to avoid duplicate work and attach returned evidence to the right account motion.

## Connector Handling

- AMs can invoke this shortcut; they do not need Freshsales credentials.
- Codex must route the request through the centralized Freshsales connector.
- If the connector is unavailable, create a Day AI connector request or pause with this payload:
  - provider: `freshsales`
  - action: `account_evidence_lookup`
  - account name, domain, aliases, requested includes, and owner email.
- Never ask the AM to paste a Freshsales API key.

## Matching Rules

- Do not trust Freshsales account name alone.
- Build an evidence bundle from domain, email domains, linked sales account IDs, aliases, notes, deals, activities, conversations, and known contact emails.
- Separate high-confidence matches from possible matches.
- Treat Freshsales history as context; it does not count as current AM outreach unless selected/logged into Day AI.

## Does Not Do

- Does not write to Freshsales.
- Does not create Day AI People.
- Does not advance lifecycle stage unless the AM explicitly approves a separate Day AI write.
- Does not expose raw auth headers, API keys, or private connector logs.

## Output

- Freshsales account match summary.
- Contact/lead candidates with IDs, role clues, title, company/account evidence, owner, last activity, and source trail.
- Deal/activity/conversation/notes summary relevant to the account motion.
- Confidence rating: `high`, `medium`, `low`, or `needs_review`.
- Suggested next shortcut: `/map-contacts` or `/account-intake`.

## Day AI Writes

- None by default.
- May save a Freshsales evidence summary to Day AI account context after AM approval.

## Done Criteria

- AM can see whether Freshsales has useful existing account/contact evidence.
- No Freshsales records were changed.
