# /verify-contact-email

Verify selected candidate email addresses through Clearout using the centralized connector runtime.

## Required Inputs

- Selected contact candidates with `email`.

Optional:

- `account_name`
- `domain`
- `reason`
- `max_to_verify`

## Reads

- `workflow/config/contact-sourcing.json`.
- `workflow/config/ux-guidance.json` for Green/Yellow/Red verification receipts.
- Selected contact candidates from `/map-contacts`, `/source-new-contacts`, imported active contacts, or Day AI context.
- Clearout verification through the centralized connector when enabled.

## Connector Handling

- AMs can request verification; they do not need a Clearout token.
- Before verification, show the selected email count and ask for approval because credits may be consumed.
- Verify only selected/enriched/imported candidate emails. Do not bulk-verify every candidate found in Apollo.
- If the connector is unavailable, create a Day AI connector request or pause with this payload:
  - provider: `clearout`
  - action: `verify_selected_emails`
  - account name/domain, selected contact names, email list, and reason.
- Do not expose API keys, auth headers, raw tokens, or private connector logs.

## Execution

Codex runs verification through the hosted worker on AM-selected emails only.

```bash
# Show cost preview first; require AM approval before this call
npm run worker:clearout-verify -- \
  --emails "<comma-list-of-selected-emails>" \
  [--account-name "<name>"] [--domain <domain>] [--reason "<text>"] \
  --approving-am <owner_email>
```

Worker returns per-email: `email`, `status` (`verified | risky | invalid`), `clearoutReason`, `verifiedAt`, `creditsConsumed`. The receipt aggregates these into `providers.clearout.{verified, risky, invalid, creditsConsumed}` and a `headlineReason`.

Receipt color: `Green` per email if `verified`, `Yellow` if `risky`, `Red` if `invalid`. The headline color is the worst of any single email.

If the worker is unreachable, set `runStatus=blocked`, show Red receipt, do not call Clearout locally.

## Does Not Do

- Does not send email.
- Does not create Day AI People.
- Does not modify Freshsales, Apollo, or Clearout records.
- Does not override AM approval requirements for canonical contact creation.

## Output

- Verification result per selected email.
- Receipt level: `Green` for safe, `Yellow` for risky/unknown review, `Red` for invalid/blocked.
- Normalized verification status.
- Clearout reason/code when available.
- Verification source and timestamp.
- Recommended action: approve for outreach, hold for review, or replace email.

## Day AI Writes

- None by default.
- May save verification evidence to the account/contact map context after AM approval.
- Canonical Day AI Person creation remains a `/dedupe-contacts` step.

## Done Criteria

- AM has verification evidence for selected emails only.
- Verification evidence is preserved for dedupe and future Day AI contact creation.
