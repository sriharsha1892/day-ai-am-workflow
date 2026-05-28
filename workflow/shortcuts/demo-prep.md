# /demo-prep

Prepare a demo without creating calendar events in v1.

## Required Inputs

- Account motion or domain.
- Demo attendees or target personas.

Optional:

- demo goal.
- known pain points.
- proposed date/time.

## Reads

- `workflow/config/myra-context.json` for demo stage framing and persona talking points.
- `workflow/config/ux-guidance.json` for receipt labels and trust panel.
- Day AI account research, selected contacts, prior touches, and lifecycle state.
- Freshsales conversations/notes only as supporting context.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Pack Resolution

- Resolve `personaPack` and `channelPack`.
- Use persona pack priority for attendee emphasis.
- Use channel pack to decide whether follow-up includes email drafts only or email plus call/manual LinkedIn tasks.
- Save account-level choices to Day AI account context when newly selected.

## AM Decision Point

AM confirms agenda and attendee-specific emphasis before sending invite/follow-up drafts.

## Day AI Writes

- Demo prep context.
- Invite/follow-up email drafts.
- Actions for scheduling, prep, and post-demo follow-up.
- Optional lifecycle update proposal to `Demo Scheduled`; do not apply without AM approval.

## Does Not Do

- Create calendar events in v1.

## Output

- Demo brief.
- Suggested agenda.
- Attendee-specific talking points.
- myRA workflow to prove in the demo.
- Resolved persona/channel packs.
- Invite copy.
- Follow-up checklist.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

## Done Criteria

- AM has demo materials and Day AI tasks/drafts ready.
