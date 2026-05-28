# /trial-start

Track trial setup and follow-up without provisioning product access.

## Required Inputs

- Account motion or domain.
- Trial status.

Optional:

- trial start date.
- users invited.
- owner.
- notes.

## Reads

- `workflow/config/myra-context.json` for trial stage framing and proof-of-value checkpoints.
- `workflow/config/ux-guidance.json` for receipt labels and trust panel.
- Day AI account motion, contacts, tasks, and prior demo context.

## AM Decision Point

AM confirms trial status and follow-up cadence before lifecycle changes or tasks are created.

## Day AI Writes

- Trial setup context.
- Trial follow-up Actions.
- Trial telemetry placeholders for queries, features used, primary user, qualitative feedback, blockers, midpoint nudge, and internal nudge.
- Optional lifecycle update proposal to `Trial Active`; do not apply without AM approval.

## Does Not Do

- Provision myRA access.
- Call product APIs.

## Output

- Trial checklist.
- Follow-up schedule.
- myRA workflow/value hypothesis to validate during the trial.
- Missing setup data.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

## Done Criteria

- Day AI has trial status context and follow-up tasks.
