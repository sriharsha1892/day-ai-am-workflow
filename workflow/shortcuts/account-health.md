# /account-health

Summarize account state and next action.

## Required Inputs

- Account motion or domain.

Optional:

- reporting window.
- include trial usage.

## Reads

- Day AI Organization, Opportunity, People, Actions, Drafts, Pages, Context, and ledger.
- Freshsales only for context reconciliation if requested.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Pack Resolution

- Report the resolved persona, cadence, and channel packs.
- If choices are missing in Day AI account context, flag them and use global defaults for readout.
- Do not update AM profile context unless the AM explicitly asks.

## Metrics Priority

1. Lifecycle conversion.
2. Outreach productivity.
3. Trial/product usage.

## AM Decision Point

AM decides whether to save the health snapshot or use it only as a readout.

## Day AI Writes

- Optional account health context snapshot.
- Optional next-step Action.

## Output

- Lifecycle stage and rationale.
- Selected contacts and role coverage.
- Resolved pack choices and any missing pack/account customization.
- Outreach stats from Day AI ledger.
- Demo/trial status.
- Blockers.
- Next best action.

## Done Criteria

- AM knows account state and next action.
