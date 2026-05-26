# Freshsales Account Flow

Freshsales is the read-only evidence layer for the AM workflow. Day AI remains the system of record.

## Clear Picture

```text
AM account packet / Day AI account
  -> account name + domain
  -> Freshsales read-only evidence lookup
  -> contact/deal/activity context
  -> Codex summary and candidate map
  -> AM approval
  -> Day AI writes only
```

## What Freshsales Does

- Confirms whether the account already exists in CRM.
- Finds matching contacts/leads by email/domain/account evidence.
- Pulls linked sales accounts, owners, deals, activities, notes, and conversation/email context.
- Helps identify warm paths, past outreach, open deals, and relationship history.
- Supplies evidence trails for contact matching and deduplication.

## What Freshsales Does Not Do

- It does not become the AM workflow ledger.
- It does not receive updates in v1.
- It does not decide which contacts become canonical Day AI People.
- It does not count automatically toward active AM outreach stats.

## Account Matching

Do not trust Freshsales account names alone. Match with an evidence bundle:

- Primary domain.
- Email domain.
- Linked sales account IDs.
- Aliases and parent/subsidiary clues.
- Deals.
- Activities.
- Conversations.
- Notes.

## Current Active Contacts Import

If you already have an Excel file of active contacts per account, import it through the active contacts workflow:

```text
Excel active contact file
  -> validate-active-contacts
  -> account-packet.json
  -> MY_ACCOUNTS.xlsx Active Contacts tab
  -> /map-contacts as warm candidates/context
  -> /dedupe-contacts only after AM approval
  -> Day AI People
```

Imported active contacts are not automatically canonical. They become warm candidates and context until the AM approves them.

## Day AI Handoff

Before Day AI writes, Codex should show what it is about to save. After the write, it should show what was saved and any object IDs/links Day AI returns.
