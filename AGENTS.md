# myRA AM Workflow Pack

Codex is the guided execution surface. Day AI is the system of record. The hosted worker is the only production executor for Freshsales, Apollo, Clearout, and Day AI writes; AMs never touch provider credentials.

## Start Here

On every fresh Codex session in this repo, immediately call `npm run worker:run-state next-resume`. If it returns a canonical_domain, greet the AM by name and offer to continue (e.g. `"Welcome back, Satya. Continue with TDK? — last receipt was Yellow, parent ambiguity."`). If the AM accepts, route to `/guided-tour` already scoped to that account. If they pick differently, scope to their choice. If no result, route to `/guided-tour` from the account queue.

If the user says any of these, run `/guided-tour`:

- `Start my myRA AM tour`
- `Start my AM guided tour`
- `Resume my myRA AM tour`
- `Continue`, `Resume`, `Where was I`, `Pick up where I left off`

For the tour, load `account-packet.json` first. Use `MY_ACCOUNTS.xlsx` as the AM-facing cockpit, not the runtime source.

Default to `standard` tour mode. If the AM seems unsure, asks what to do, or says they are new to this, switch to `beginner` mode. If the AM uses direct slash commands or asks for speed, use `power` mode.

## Natural Prompt Router

AMs may not see slash commands. Route natural requests to the closest shortcut:

- `Find leads`, `Find contacts`, `Who should I target?`, `Show me target contacts` -> `/map-contacts`, then `/source-new-contacts` if coverage is weak.
- `Identify leads for this account` -> `/map-contacts`, then `/source-new-contacts` if coverage is weak.
- `Find ICP for this account`, `Who is the ICP?`, `Which personas matter?` -> `/research-account`, then `/map-contacts` with persona priorities.
- `Research this account`, `Tell me about this company` -> `/research-account`.
- `Check duplicate account`, `Run smart org match`, `Is this already in Day AI?` -> `/org-resolution`.
- `Build my cadence` -> `/build-cadence`.
- `Make a plan`, `Sequence this account`, `Next outreach plan` -> `/build-cadence`.
- `Draft outreach`, `Write first email`, `Write a note`, `Draft first touch` -> `/draft-outreach`.
- `Show what was saved to Day AI`, `Did this save to Day AI?`, `What happened in Day AI?`, `What is next?` -> `/account-health` (which produces the unified worker receipt).
- `Continue`, `Resume`, `Where was I`, `Pick up where I left off` -> `/guided-tour resume` via `worker:run-state next-resume`.
- `Show details`, `Show your work`, `Why`, `Expand`, `Show the evidence` -> expand the most recent receipt's `expanded` payload + trust panel.
- `Wrap up`, `End tour`, `Bye`, `Done for today`, `Close`, `Goodbye` -> `worker:end-tour` and show the brief summary + pending items + next-session prompt.
- `Fix my Day AI connection`, `Day AI broke`, `MCP crashed`, `Connection failed`, `Retry sync`, `Worker unreachable` -> `/guided-tour` recovery: run `worker:run-state get` to inspect `pendingSync[]`, then `worker:dayai-write --retry-idempotency-key <key>` for each entry.

Before any Day AI Organization write, run `/org-resolution` or apply its contract inside `/account-intake`.

## Shortcut Router

Load the matching contract and follow it exactly:

- `/guided-tour` -> `workflow/shortcuts/guided-tour.md`
- `/org-resolution` -> `workflow/shortcuts/org-resolution.md`
- `/account-intake` -> `workflow/shortcuts/account-intake.md`
- `/research-account` -> `workflow/shortcuts/research-account.md`
- `/map-contacts` -> `workflow/shortcuts/map-contacts.md`
- `/source-new-contacts` -> `workflow/shortcuts/source-new-contacts.md`
- `/verify-contact-email` -> `workflow/shortcuts/verify-contact-email.md`
- `/freshsales-lookup` -> `workflow/shortcuts/freshsales-lookup.md`
- `/dedupe-contacts` -> `workflow/shortcuts/dedupe-contacts.md`
- `/build-cadence` -> `workflow/shortcuts/build-cadence.md`
- `/draft-outreach` -> `workflow/shortcuts/draft-outreach.md`
- `/log-touch` -> `workflow/shortcuts/log-touch.md`
- `/demo-prep` -> `workflow/shortcuts/demo-prep.md`
- `/trial-start` -> `workflow/shortcuts/trial-start.md`
- `/trial-review` -> `workflow/shortcuts/trial-review.md`
- `/product-update` -> `workflow/shortcuts/product-update.md`
- `/account-health` -> `workflow/shortcuts/account-health.md`

If a required input is missing, ask only for that input.

## Non-Negotiables

- Day AI is canonical for account state, selected contacts, tasks, drafts, ledger, and health.
- Freshsales is read-only.
- Freshsales, Apollo, and Clearout are accessed through the centralized connector runtime; AM packages never contain API keys.
- **Production Day AI writes and provider calls must go through the hosted worker (`npm run worker:*`).** Local MCP calls and direct provider fetches are dry-run only. If the worker is unreachable, set `runStatus=blocked`, show Red receipt, do not retry locally.
- A directly-configured `day-ai` MCP server may be present for auth/read only; **never use its write tools** — they bypass the worker's idempotency key, `approvedBy` attribution, and `pendingSync` safety. The installer comments this legacy block out; if you see it, treat it as read context, not a write path.
- Every Day AI write must carry an idempotency key and an `approvedBy` AM email. Retries reuse the same idempotency key. The worker rejects writes without both.
- Every shortcut that makes a recommendation or draft must load `workflow/config/myra-context.json` and keep the output grounded in myRA-specific value.
- Account intake must not create a Day AI Organization until the smart organization match gate has linked, asked, blocked, or cleared creation.
- AM approval is required before external sends, canonical contact creation, lifecycle changes after intake, and future calendar creation.
- Outreach metrics count only AM-selected contacts and Day AI ledger activity.
- **After org-create succeeds during a fresh first-touch flow, chain a dayai_write opportunity-create call** in the same approval batch — same idempotency-key prefix, scoped per (domain × AM). Title format: `<Org> — myRA New Business`. Always set `ownerEmail` to the approving AM. Resolve `pipelineId` to `DAY_AI_PIPELINE_NEW_BUSINESS_OUTBOUND_ID` and `stageId` to `DAY_AI_STAGE_CONNECTION_ID` (both from `templates/day-ai-workspace-ids.json`). Include `customProperties` for at minimum: Pitched Since (today, ISO), AM Owner Source (option UUID for the AM), Last Outreach Channel (option UUID for `email` / `call` / `linkedin` / `in-person`). Picklist values MUST be the option UUID, not the display name. Skip the opportunity-create step if `search_objects native_opportunity` already returns a hit with relationship subject = this org's objectId AND `AM Owner Source` = this AM (idempotency at the data layer in addition to the key).
- **On every dayai_write org-create call, ALSO pass `customProperties` with AM Account List set to the approving AM's option UUID** (from `templates/day-ai-workspace-ids.json` `customProperties.amAccountList.options.<amName>`). This tags every new org at creation time so the "Unassigned — needs owner" view stays empty for AM-driven creations. Example payload entry: `{ propertyId: "99e4e13f-6642-4568-a340-a41a78f1254b", value: "<ownerAmOptionUuid>", reasoning: "Org created during fresh first-touch by <amName>" }`. Existing orgs (where org-create returns "already exists") are unaffected — the AM tag is set as a side effect of creation; for existing orgs, use the org-update-tags admin action separately if retroactive tagging is needed.
- **Demo-stage promotion: when an AM books a demo on their calendar** (event title containing `demo`, `pilot kickoff`, or `product walkthrough`) or otherwise confirms a demo is scheduled, **issue a dayai_write opportunity-update-stage call** with `opportunityId` (resolved by searching native_opportunity for the org+AM pair) and `stageId = DAY_AI_STAGE_DEMO_WALKTHROUGH_ID`. False negatives are preferred to false positives — if the keyword match is ambiguous, leave the stage alone and let the AM move it manually. The KPI is per-week demo count by AM; do not inflate it with rescheduled-event noise.
- Keep outputs grounded in myRA positioning: decision-grade intelligence, expert-validated research, market/competitive/customer/supplier/trend intelligence, internal data integrations, and accountable research outputs.

## Day AI Receipts

Every receipt follows the canonical shape in `workflow/schemas/account-receipt.schema.json`, produced by `npm run worker:receipt`.

**Rendering rule (standard + beginner mode):** speak the receipt narrative paragraph first, then show the four color-coded provider bullets (Freshsales / Apollo / Clearout / Day AI) using the per-provider `headlineReason`. End with the `summary.nextAction` line. Default coaching depth is **decision plus headline reason** — full evidence only on Yellow/Red receipts or when the AM asks "show details" / "why".

**Rendering rule (power mode):** suppress the narrative paragraph; show only the headline, the four color-coded bullets, and the next action.

**Yellow/Red receipts always auto-expand the `expanded` payload and the trust panel — no extra prompt needed.**

Before Day AI writes, show what is about to be written: Organization, Opportunity/account motion, Context/page, People, Actions, Email drafts.

After Day AI writes, show object type, name, status, and link or record ID. If Day AI returns no link/ID, say so plainly. Every saved object appears in `providers.dayAi.savedObjects[]` with its idempotency key.

**Receipts persist in two places (worker handles both atomically):**

- Local JSON at `am-package/<am>/<account>/receipts/<timestamp>.json` (AM history)
- Day AI context page on the Organization (account record); ID returned in `persistence.dayAiContextPageId`

If either write fails, the receipt color is Red and the failure is queued in `pendingSync[]`.

## End Of Tour

When the AM types any of `bye`, `wrap up`, `end tour`, `done for today`, `close`, `goodbye`, or `/end-tour` — or 15 minutes pass at a clean station boundary — call `npm run worker:end-tour`. Show the brief summary + pending items + next-session prompt as specified in `ux-guidance.json` `endOfTour`. Write the digest to `am-package/<am>/digests/<date>.md`.

## Config And Details

- Packs: `workflow/config/packs.json`
- myRA context pack: `workflow/config/myra-context.json`
- Org resolution policy: `workflow/config/org-resolution.json`
- UX guidance: `workflow/config/ux-guidance.json`
- Contact sourcing: `workflow/config/contact-sourcing.json`
- Unified receipt schema: `workflow/schemas/account-receipt.schema.json`
- Tour run state schema: `workflow/schemas/tour-run-state.schema.json`
- Day AI mapping: `docs/day-ai-mapping.md`
- Freshsales: `docs/freshsales-integration.md`
- Centralized connectors: `docs/centralized-connectors.md`
- Apollo/Clearout: `docs/contact-sourcing.md`
- Active contacts import: `docs/active-contacts-import.md`
- Michelman pilot runbook: `docs/michelman-pilot.md`
