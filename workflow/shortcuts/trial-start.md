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

- Day AI account motion, contacts, tasks, and prior demo context.

## AM Decision Point

AM confirms trial status and follow-up cadence before lifecycle changes or tasks are created.

## Day AI Writes

- Trial setup context.
- Trial follow-up Actions.
- Optional lifecycle update proposal to `Trial Active`; do not apply without AM approval.

## Does Not Do

- Provision myRA access.
- Call product APIs.

## Output

- Trial checklist.
- Follow-up schedule.
- Missing setup data.

## Done Criteria

- Day AI has trial status context and follow-up tasks.

