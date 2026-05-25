# /build-cadence

Create a customizable account-specific follow-up plan.

## Required Inputs

- Account motion or domain.
- Selected contacts.
- Persona/function for each contact.
- Account lifecycle stage.

Optional:

- AM cadence preference.
- Channel exclusions.
- Tone.
- timeline.

## Reads

- Day AI account research/context.
- Selected canonical People.
- Existing Day AI Actions, Drafts, and touch ledger.
- Freshsales activity only for context, not metrics.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Defaults

Use `workflow/config/packs.json` and `workflow/config/default-playbook.yml`, then apply AM overrides.

## Pack Resolution

- Resolve `personaPack`, `cadencePack`, and `channelPack`.
- Ask only for missing choices after global defaults and Day AI contexts are checked.
- Save account-level choices to Day AI account context.
- Update Day AI AM profile context only when the AM explicitly asks to reuse choices.

## AM Decision Point

AM reviews cadence structure before tasks/drafts are created.

## Day AI Writes

- Day AI Actions for planned follow-ups.
- Day AI Email Drafts for email steps.

## Does Not Do

- Send email.
- Place calls.
- Send LinkedIn or WhatsApp messages.

## Output

- Cadence schedule by contact.
- Resolved persona, cadence, and channel packs.
- Draft/task list.
- Assumptions and AM customization points.

## Done Criteria

- Day AI contains approved tasks and drafts for the selected cadence.
