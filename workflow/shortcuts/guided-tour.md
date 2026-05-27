# /guided-tour

Run the AM's self-serve myRA tour from account queue to Day AI handoff.

## Required Inputs

- AM package folder containing `account-packet.json`.

Optional:

- `account_name`
- `domain`
- `resume`

## Reads

- `account-packet.json` first for fast runtime state.
- `MY_ACCOUNTS.xlsx` only as the AM-facing cockpit reference.
- Day AI MCP status and existing Day AI account context.
- Centralized connector availability from `workflow/config/contact-sourcing.json`.
- Shortcut contracts for the next checkpoint.

## Preflight

- Confirm Codex is operating from the AM tour folder.
- Confirm `account-packet.json` exists.
- Confirm Day AI MCP is configured.
- If Day AI MCP is missing, run `node scripts/setup-codex.mjs` and ask the AM to complete browser OAuth if prompted.
- Run `node scripts/check-codex-setup.mjs` when setup changes.
- Confirm AMs do not need Freshsales, Apollo, or Clearout keys; provider requests route through the centralized connector.

## Queue Behavior

- Show counts for `ready_for_intake`, `domain_pending`, `identity_review`, and `hold`.
- Recommend the next `ready_for_intake` account by priority, then packet order.
- If no account is ready, offer domain-confirmation mode and do not run `/account-intake`.
- Never invent a domain.

## Checkpoints

1. Account selection.
2. `/account-intake`.
3. `/research-account`.
4. `/freshsales-lookup` when existing CRM evidence needs to be inspected directly.
5. `/map-contacts`.
6. `/source-new-contacts` if contact coverage is weak or a persona gap exists.
7. `/verify-contact-email` only for selected candidate emails.
8. `/dedupe-contacts` for AM-approved contacts only.
9. `/build-cadence`.
10. `/draft-outreach`.
11. `/log-touch` only if the AM manually completed a touch.
12. `/account-health`.

## Day AI Handoff Receipts

Before Day AI writes, show:

```text
About to write to Day AI:
- Organization:
- Opportunity/account motion:
- Context/page:
- People:
- Actions:
- Email drafts:
Approve?
```

After Day AI writes, show:

```text
Saved to Day AI:
- Object type:
- Name:
- Status:
- Link or record ID, if available:
- Next step:
```

## Recovery Prompts

Support these user prompts:

- `Resume my myRA AM tour.`
- `Fix my Day AI connection.`
- `Show what has been saved to Day AI.`
- `Show accounts needing domains.`
- `Restart from my recommended account.`

## Done Criteria

- AM knows the next account and next checkpoint.
- For a completed account tour, Day AI has account context, any AM-approved contacts, one outreach draft or explicitly skipped draft, one next task, and an account health readout or snapshot.
