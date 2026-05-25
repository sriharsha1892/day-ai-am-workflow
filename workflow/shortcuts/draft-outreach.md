# /draft-outreach

Create personalized email drafts grounded in account research and myRA value.

## Required Inputs

- Account motion or domain.
- Selected contact or persona.
- Outreach objective.

Optional:

- Tone.
- CTA.
- length.
- proof point.
- prior context to reference.
- freeform instructions.

## Reads

- Day AI account research/context.
- Selected contact context.
- Day AI touch ledger.
- Freshsales conversations/notes only as background context when available.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Pack Resolution

- Resolve `personaPack` and `channelPack`.
- Use the persona pack to shape role-specific pain points and the channel pack to prevent unsupported outreach.
- Apply tone, CTA, length, and freeform instructions only inside the hard guardrails.
- Save account-level choices to Day AI account context when newly selected.

## AM Decision Point

AM reviews draft before sending.

## Day AI Writes

- Create Day AI email draft tied to the account/contact/action when possible.
- Optionally create a follow-up task.

## Output

- Subject line.
- HTML email body.
- Resolved pack choices and customization notes.
- Personalization rationale.
- Follow-up recommendation.

## Done Criteria

- AM has a reviewable Day AI email draft.
