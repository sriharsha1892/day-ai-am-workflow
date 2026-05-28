# /account-health

Summarize account state and next action.

## Required Inputs

- Account motion or domain.

Optional:

- reporting window.
- include trial usage.

## Reads

- `workflow/config/myra-context.json` for lifecycle and next-best-action framing.
- `workflow/config/ux-guidance.json` for receipt labels, pending-sync display, and trust panel.
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

## Execution

`/account-health` is where the single account-level unified receipt is produced. Codex calls one worker endpoint that aggregates every prior station into the canonical `account-receipt.schema.json` shape.

```bash
npm run worker:receipt -- \
  --account <canonical_domain> \
  [--include-expanded true]
```

The worker:

1. Reads the account's `tour-run-state.json` to know what stations ran and which idempotency keys/Day AI record IDs were produced.
2. Re-fetches current Day AI state for the Organization/Opportunity/People/Actions/Drafts.
3. Aggregates Freshsales evidence summary, Apollo candidate counts (tiered), Clearout verification counts.
4. Builds `summary.color` (worst of all stations), `summary.headline`, `summary.narrative` (3-4 sentences), `summary.headlineReasonByProvider`, `summary.nextAction`.
5. Writes the receipt locally to `am-package/<am>/<account>/receipts/<timestamp>.json` **and** as a Day AI context page on the Organization. Both writes happen atomically; failure on either is a Red receipt.
6. Updates `tour-run-state.json` `lastReceipt` and the per-AM `tour-run-state-index.json` entry.

**Rendering by Codex** (per `ux-guidance.json` `renderingMode`):

- Standard/beginner mode: speak `summary.narrative`, then four color-coded provider bullets using `summary.headlineReasonByProvider`, then `summary.nextAction`.
- Power mode: suppress narrative; show only headline + bullets + next action.
- Yellow/Red receipts auto-expand `expanded` and the trust panel.

If the worker is unreachable, set `runStatus=blocked` and show Red receipt with the failure detail; do not synthesize a receipt locally.

## Output

- Lifecycle stage and rationale.
- Selected contacts and role coverage.
- Resolved pack choices and any missing pack/account customization.
- Outreach stats from Day AI ledger.
- Demo/trial status.
- Blockers.
- myRA-specific account value thread and proof gaps.
- Next best action.
- Pending-sync items, if any, with retry prompt and idempotency key.

## Done Criteria

- AM knows account state and next action.
