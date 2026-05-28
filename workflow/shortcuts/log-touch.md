# /log-touch

Record outreach activity for AM-selected contacts in the Day AI ledger.

## Required Inputs

- Account motion or domain.
- Contact.
- Channel: `email`, `call`, `linkedin`, `whatsapp`.
- Outcome.
- Note.

Optional:

- next step.
- due date.
- Freshcaller/Freshsales activity ID.

## Reads

- `workflow/config/myra-context.json` for channel outcome and next-step framing.
- `workflow/config/ux-guidance.json` for receipt labels.
- Day AI selected contact and account motion.
- Freshsales/Freshcaller activity only when reconciling a call outcome.

## AM Decision Point

AM confirms the touch summary and next step before it is recorded.

## Day AI Writes

- Account/contact context entry or ledger note.
- Follow-up Action when a next step exists.

## Output

- Logged touch summary.
- Updated next step.
- Any open task created.

## Done Criteria

- Day AI ledger reflects the touch for reporting.
- Freshsales history is not counted unless AM selected/logged the touch.
