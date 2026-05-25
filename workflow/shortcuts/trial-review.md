# /trial-review

Summarize trial usage from Excel snapshots and recommend next actions.

## Required Inputs

- Trial usage CSV or row data matching `templates/trial-usage-import.csv`.

Optional:

- Account motion or domain if not present in the import.

## Reads

- Day AI account motion, trial context, selected contacts, prior outreach, and tasks.
- Excel/CSV usage snapshot.

## AM Decision Point

AM confirms the interpretation and next step before lifecycle updates or customer-facing drafts.

## Day AI Writes

- Trial usage summary context.
- Follow-up Actions.
- Optional lifecycle update proposal to `Trial Follow-up` or `Negotiation`; do not apply without AM approval.

## Output

- Usage summary.
- Adoption signals.
- Risk/blocker assessment.
- Recommended follow-up.

## Done Criteria

- Day AI reflects latest trial usage and recommended next step.

