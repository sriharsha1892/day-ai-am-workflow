# /guided-tour

Run the AM's self-serve myRA tour from account queue to Day AI handoff.

## Required Inputs

- AM package folder containing `account-packet.json`.

Optional:

- `account_name`
- `domain`
- `resume`

## Reads

- `account-packet.json` first for fast runtime state.
- `MY_ACCOUNTS.xlsx` only as the AM-facing cockpit reference.
- `workflow/config/myra-context.json` for all account, contact, outreach, demo, trial, and health recommendations.
- `workflow/config/org-resolution.json` before any account intake Organization write.
- `workflow/config/ux-guidance.json` for tour mode, receipt levels, first-run stations, trust panels, contact cards, and pending-sync recovery.
- Day AI MCP status and existing Day AI account context.
- Centralized connector availability from `workflow/config/contact-sourcing.json`.
- Shortcut contracts for the next checkpoint.

## Preflight

- Confirm Codex is operating from the AM tour folder.
- Confirm `account-packet.json` exists.
- Confirm Day AI MCP is configured.
- If Day AI MCP is missing, run `node scripts/setup-codex.mjs` and ask the AM to complete browser OAuth if prompted.
- Run `node scripts/check-codex-setup.mjs` when setup changes.
- Confirm AMs do not need Freshsales, Apollo, or Clearout keys; provider requests route through the centralized connector.

## Tour Modes

- `beginner`: explain each checkpoint, ask one decision at a time, use copy-paste prompts, and show Green/Yellow/Red receipts.
- `standard`: default mode; show concise findings, recommendation, approval need, and next step.
- `power`: accept slash commands/freeform prompts and keep receipts compact without skipping guardrails.

If the AM does not choose a mode, use `standard`. Switch to `beginner` when the AM seems unsure or asks what to do. Switch to `power` only when the AM asks for speed or uses direct command language.

## Queue Behavior

- Show counts for `ready_for_intake`, `domain_pending`, `identity_review`, and `hold`.
- Recommend the next `ready_for_intake` account by priority, then packet order.
- If no account is ready, offer domain-confirmation mode and do not run `/account-intake`.
- Never invent a domain.

## Natural Prompts

Route these AM prompts without requiring visible slash commands:

- `Find leads`, `Find contacts`, `Who should I target?`, `Show me target contacts` -> `/map-contacts`, then `/source-new-contacts` if role coverage is weak.
- `Identify leads for this account` -> `/map-contacts`, then `/source-new-contacts` if role coverage is weak.
- `Find ICP for this account`, `Who is the ICP?`, `Which personas matter?` -> `/research-account`, then `/map-contacts`.
- `Research this account`, `Tell me about this company` -> `/research-account`.
- `Check duplicate account`, `Run smart org match`, `Is this already in Day AI?` -> `/org-resolution`.
- `Build my cadence` -> `/build-cadence`.
- `Make a plan`, `Sequence this account`, `Next outreach plan` -> `/build-cadence`.
- `Draft outreach`, `Write first email`, `Write a note`, `Draft first touch` -> `/draft-outreach`.
- `Show what was saved to Day AI`, `Did this save to Day AI?`, `What happened in Day AI?`, `What is next?` -> `/account-health`.
- `Fix my Day AI connection`, `Day AI broke`, `MCP crashed`, `Connection failed` -> setup/preflight recovery.

## First-Run Stations

For a first-time AM or first account, collapse the experience into five stations:

1. Account Safety Check: run `/org-resolution`.
2. Research: run `/research-account`.
3. Contacts: run `/map-contacts`, then `/source-new-contacts` only when needed.
4. Cadence And Draft: run `/build-cadence`, then `/draft-outreach`.
5. Day AI Health Snapshot: run `/account-health`.

Keep the full checkpoint list available, but do not force a new AM to reason through all branches upfront.

## Checkpoints

1. Account selection.
2. `/org-resolution`.
3. `/account-intake` only if org resolution links, asks, or clears creation.
4. `/research-account`.
5. `/freshsales-lookup` when existing CRM evidence needs to be inspected directly.
6. `/map-contacts`.
7. `/source-new-contacts` if contact coverage is weak or a persona gap exists.
8. `/verify-contact-email` only for selected candidate emails.
9. `/dedupe-contacts` for AM-approved contacts only.
10. `/build-cadence`.
11. `/draft-outreach`.
12. `/demo-prep`, `/trial-start`, or `/trial-review` when lifecycle calls for it.
13. `/log-touch` only if the AM manually completed a touch.
14. `/account-health`.

## Day AI Handoff Receipts

Every receipt should include a status level:

- `Green`: safe to proceed or saved.
- `Yellow`: AM decision needed before write or next step.
- `Red`: stop and review; do not create/send.

Before Day AI writes, show:

```text
About to write to Day AI:
- Organization:
- Opportunity/account motion:
- Context/page:
- People:
- Actions:
- Email drafts:
Approve?
```

After Day AI writes, show:

```text
Saved to Day AI:
- Object type:
- Name:
- Status:
- Link or record ID, if available:
- Next step:
```

## Trust Panel

After `/org-resolution`, `/research-account`, `/map-contacts`, `/build-cadence`, `/draft-outreach`, and `/account-health`, show:

- Sources used:
- What I am confident about:
- What needs AM judgment:
- What I did not do:
- Next safest action:

## Contact Cards

For contact mapping and sourcing, group candidate people into:

- `Recommended`: strong role fit and evidence.
- `Maybe`: useful but incomplete evidence.
- `Hold`: weak fit, duplicate risk, bad email, or ambiguous company evidence.

Each card should show name, title, role bucket, source, evidence, enrichment/verification status, and suggested AM action.

## Pending Sync Recovery

If Day AI MCP crashes or a write fails:

- Show `Red: pending_sync`.
- Preserve attempted write, idempotency key, reason, and retry prompt.
- Tell the AM that Codex did not retry by creating a second Organization.
- Use this retry prompt: `Retry pending Day AI sync for this account using the same idempotency key.`

## Recovery Prompts

Support these user prompts:

- `Resume my myRA AM tour.`
- `Fix my Day AI connection.`
- `Show what has been saved to Day AI.`
- `Show accounts needing domains.`
- `Run smart org match for this account before intake.`
- `Retry pending Day AI sync for this account using the same idempotency key.`
- `Restart from my recommended account.`

## Execution

The guided tour is a stateful walk over the five first-run stations. State persists in `tour-run-state.json` (per account) and `tour-run-state-index.json` (per AM) so the tour survives Codex restarts.

**On entry** — auto-resume:

```bash
# Codex calls this on AGENTS.md load and any time the AM says "continue" / "resume"
npm run worker:run-state -- next-resume
```

Worker returns `{ canonicalDomain, displayName, runStatus, nextActionHint, lastReceiptColor }` for the highest-priority unfinished account. Codex offers: *"Continue with `<displayName>`? Last receipt: `<color>` — `<nextActionHint>`."* AM accepts, picks a different account, or starts a new one.

**During tour** — checkpoint tracking:

Before each station starts, Codex marks it `in_progress`:

```bash
npm run worker:run-state -- mark-station \
  --account <canonical_domain> --station <id> --status in_progress
```

After each station finishes, mark `complete` with the Day AI record IDs and idempotency key it produced:

```bash
npm run worker:run-state -- mark-station \
  --account <canonical_domain> --station <id> --status complete \
  --day-ai-record-ids "<json-list>" --idempotency-key <key>
```

**On failure** — hard block (no auto-retry):

```bash
npm run worker:run-state -- queue-pending-sync \
  --account <canonical_domain> \
  --attempted-write <verb> --idempotency-key <key> \
  --reason "<why it failed>" \
  --retry-prompt "Retry pending Day AI sync for this account using the same idempotency key."

npm run worker:run-state -- set --account <canonical_domain> --status blocked
```

Show Red receipt with the failure detail. Offer `/retry now` (which calls `worker:dayai-write --retry-idempotency-key <key>`) or `/abandon`. Never silently retry; never try a different idempotency key.

**On tour wrap** — end-tour roll-up:

When the AM types any of `bye`, `wrap up`, `end tour`, `done for today`, `close`, `goodbye`, `/end-tour`, or 15 minutes pass at a clean station boundary:

```bash
npm run worker:end-tour -- --am <owner_email>
```

Worker aggregates today's touch counts (accounts touched, contacts approved, drafts created), lists blockers (with color + reason), and returns the next-session prompt picked from `next-resume`. Codex renders this as: *"Today: 5 accounts, 12 contacts approved, 5 drafts. 2 blockers: TDK (Yellow — parent ambiguity), Siemens (Red — Day AI pending_sync). Resume tomorrow with TDK?"* Digest is also written to `am-package/<owner_email>/digests/<date>.md`.

**Receipt rendering** — per `ux-guidance.json` `renderingMode`:

- Standard/beginner: narrative paragraph + four color-coded provider bullets + next action line.
- Power: suppress narrative; bullets + next action only.
- Yellow/Red: auto-expand the `expanded` payload and trust panel.

## Done Criteria

- AM knows the next account and next checkpoint.
- For a completed account tour, Day AI has account context, any AM-approved contacts, one outreach draft or explicitly skipped draft, one next task, and an account health readout or snapshot.
- Duplicate-safe org resolution happened before Organization creation/linking.
- Recommendations and drafts include myRA account-fit context.
