# Modularity And Packs

The AM workflow uses composable packs so commands are flexible without becoming inconsistent.

## Pack Types

V1 supports:

- Persona packs: role buckets and priority order.
- Cadence packs: timing, steps, and purpose.
- Channel packs: allowed channels and manual-only channels.

Definitions live in:

```text
workflow/config/packs.json
```

## Resolution Order

Commands resolve packs in this order:

1. Global defaults from `workflow/config/packs.json`.
2. Day AI AM profile context.
3. Day AI account context.
4. Ask the AM once if still missing.

When an AM chooses packs through dialog:

- Always save the account-level choice to Day AI account context.
- Update Day AI AM profile context only when the AM explicitly asks to reuse that choice.

## Guardrails

AMs may customize:

- Persona pack.
- Cadence pack.
- Channel pack.
- Tone.
- CTA.
- Length.
- Freeform instructions.

AMs may not override:

- Approval before external sends.
- Approval before canonical contact creation.
- Approval before lifecycle changes after intake.
- Freshsales read-only mode.
- No calendar write in v1.
- Day AI ledger-only outreach metrics.

## Pack-Aware Commands

These commands must resolve packs before output:

- `/map-contacts`: uses persona pack for role-gap priority.
- `/build-cadence`: uses persona, cadence, and channel packs.
- `/draft-outreach`: uses persona and channel packs plus tone/CTA/length/freeform instructions.
- `/demo-prep`: uses persona and channel packs for attendee emphasis and follow-up tasks.
- `/product-update`: uses persona/channel packs for relevance and recipient selection.
- `/account-health`: reports selected pack choices and flags missing choices.

`/account-intake` and provisioning may seed account-level pack choices when provided.

