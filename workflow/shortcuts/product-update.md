# /product-update

Draft account-relevant product update outreach.

## Required Inputs

- Product update note.
- Account motion/domain or target contact segment.

Optional:

- target persona.
- desired CTA.
- exclusions.

## Reads

- `workflow/config/myra-context.json` for stage/persona relevance checks.
- `workflow/config/ux-guidance.json` for receipt labels and trust panel.
- Day AI account research, lifecycle state, selected contacts, trial context, and prior touches.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Pack Resolution

- Resolve `personaPack` and `channelPack`.
- Use persona pack to decide whether a product update is relevant to selected contacts.
- Use channel pack to determine draft/task channels.
- Save account-level choices to Day AI account context when newly selected.

## Relevance Rule

Only draft outreach when the update maps to the account's use case, persona, lifecycle stage, or trial behavior. Do not broadcast blindly.

## AM Decision Point

AM confirms relevance and recipients before drafts/tasks are created.

## Day AI Writes

- Email draft.
- Optional follow-up Action.
- Optional account context noting why the update is relevant.

## Output

- Recipient rationale.
- Resolved persona/channel packs.
- myRA use case or trial behavior that makes the update relevant.
- Draft subject/body.
- Suggested next step.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

## Done Criteria

- AM has relevant drafts/tasks and no blanket broadcast occurred.
