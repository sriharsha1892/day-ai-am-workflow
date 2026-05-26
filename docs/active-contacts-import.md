# Active Contacts Import

Use this workflow when you already have active contacts per account in Excel.

## Goal

Bring current account contacts into the AM package without making them canonical Day AI People automatically.

Active contacts become context and candidates in the guided tour. The AM still approves which people become canonical Day AI contacts.

## Accepted File

Start from:

```text
templates/am-active-contacts.csv
```

The validator accepts `.csv` and `.xlsx`.

Required columns:

```text
am_email
am_name
account_name
contact_name
source_system
```

Recommended columns:

```text
account_domain
email
title
role_bucket
linkedin_url
phone
source_contact_id
relationship_status
last_touch_at
last_touch_channel
next_step
selected_by_am
notes
```

## Validation

```bash
node scripts/validate-active-contacts.mjs path/to/active-contacts.xlsx
```

or:

```bash
npm run validate:active-contacts
```

## Package Behavior

When the active contacts file is present, AM tour packages include those contacts in:

- `account-packet.json`
- `MY_ACCOUNTS.xlsx` on the `Active Contacts` sheet

Codex should use active contacts as warm context during `/map-contacts` and `/dedupe-contacts`.

## Guardrail

Imported contacts are not automatically canonical Day AI People. AM approval is still required.
