# /account-intake

Create the Day AI account motion shell for an AM-selected account.

## Required Inputs

- `account_name`
- `domain`

Optional:

- `aliases`
- `parent_company`
- `owner_email`
- `persona_pack`
- `cadence_pack`
- `channel_pack`

## Reads

- Day AI: existing Organization, Opportunity, People, Actions, Pages, Context for the domain and aliases.
- Freshsales: candidate accounts, contacts/leads, deals, and activities using evidence-based matching through the centralized connector runtime.

## Connector Handling

- AMs do not need a Freshsales key.
- Codex should call the centralized Freshsales connector when available.
- If the connector is unavailable, pause with a Freshsales lookup request payload rather than asking the AM for credentials.
- Freshsales is read-only; never create, update, merge, or delete CRM records.

## AM Decision Point

The command invocation authorizes creating the intake shell only. Do not create canonical contacts or advance later lifecycle stages.

## Day AI Writes

- Create or update Organization for the account.
- Create Opportunity/account motion in `Researching`.
- Create initial account plan/context with source evidence and known gaps.
- Seed account-level pack choices in Day AI account context when provided.

## Output

- Account identity summary.
- Existing Day AI records found.
- Freshsales evidence summary.
- Seeded pack choices, or which choices will fall back to Day AI/global defaults.
- Missing data and next suggested shortcut.

## Done Criteria

- Day AI has a canonical account shell with linked source evidence.
- Lifecycle is `Researching`.
- No contacts are canonicalized unless separately approved.
