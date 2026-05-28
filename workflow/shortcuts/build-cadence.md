# /build-cadence

Create a customizable account-specific follow-up plan.

## Required Inputs

- Account motion or domain.
- Selected contacts.
- Persona/function for each contact.
- Account lifecycle stage.

Optional:

- AM cadence preference.
- Channel exclusions.
- Tone.
- timeline.

## Reads

- `workflow/config/myra-context.json` for stage, persona, and account-fit framing.
- `workflow/config/ux-guidance.json` for first-run UX, receipt labels, and trust panel.
- Day AI account research/context.
- Selected canonical People.
- Existing Day AI Actions, Drafts, and touch ledger.
- Freshsales activity only for context, not metrics.
- `workflow/config/packs.json` plus Day AI AM/account pack context.

## Defaults

Use `workflow/config/packs.json` and `workflow/config/default-playbook.yml`, then apply AM overrides.

## Pack Resolution

- Resolve `personaPack`, `cadencePack`, and `channelPack`.
- Ask only for missing choices after global defaults and Day AI contexts are checked.
- Save account-level choices to Day AI account context.
- Update Day AI AM profile context only when the AM explicitly asks to reuse choices.

## Execution

Codex builds the cadence in three phases: resolve packs, **walk each field in sequence** for AM overrides, preview, then write Actions/Drafts through the worker.

**Phase 1 — Resolve packs** (no worker call yet):

Apply `workflow/config/packs.json` `resolutionOrder`:

1. `globalDefaults` (e.g. `cadencePack=new-contact-standard`, `channelPack=email-call`, `personaPack=balanced`).
2. Day AI AM profile context (if present).
3. Day AI account context (if present).
4. `askAmOnce` — Codex asks the AM for any unresolved choice.

**Phase 2 — Walk each field in sequence** (per `ux-guidance.json` `contactSelection`/packs `customization.collectionStyle = walk_each_field_in_sequence`):

For each step in the resolved cadence pack, Codex asks in order:

1. *"Step 1: channel? (default `email`)"* → AM may answer `keep`, `change to call`, `change to linkedin`, etc.
2. *"Step 1: timing? (default `day 0`)"* → AM may say `keep`, `push 2 days`, `day 5`, etc.
3. *"Step 1: tone? (default per persona pack)"* → AM may say `keep`, `more direct`, `consultative`, etc.
4. *"Step 1: CTA? (default `book a 20-min decision-grade brief review`)"* → AM may say `keep`, or specify.
5. *"Step 1: skip this step?"* → if yes, mark `stepSkip` for this index.

Repeat for each step in the pack. Power mode accepts `--apply-defaults` to skip the walk entirely and use pack defaults silently.

After the walk, Codex re-renders the full cadence as a numbered preview (with overrides applied) and asks *"Approve all, or edit step N?"* — on edit, re-walk only that step.

**Phase 3 — Write to Day AI through worker**:

```bash
# For each approved step:
npm run worker:dayai-write -- \
  --action action-create \
  --canonical-domain <domain> \
  --contact-email <person-email> \
  --channel <email|call|linkedin|whatsapp|demo|internal> \
  --due-at <ISO-date> \
  --summary "<step purpose>" \
  --branch-if "<conditional expression>" \
  --approving-am <owner_email>

# For email steps, also create a draft (worker chains action+draft if asked)
npm run worker:dayai-write -- \
  --action draft-create \
  --canonical-domain <domain> \
  --contact-email <person-email> \
  --linked-action-id <id from action-create> \
  --tone <resolved-tone> --cta <resolved-cta> --length <resolved-length> \
  --approving-am <owner_email>
```

Every write returns its `dayAiActionId` / `dayAiDraftId` and idempotency key. Retries reuse the key — the worker rejects duplicate Action creation server-side.

Persist the resolved packs + overrides to the packet `packs` block (including new fields `channelOrder`, `stepTimingOverrides`, `skippedSteps`, `manualOnlyTaskOverrides`) and ask the AM whether to save the choices back to Day AI account context.

If the worker is unreachable, set `runStatus=blocked`, show Red receipt, do not write locally.

## AM Decision Point

AM reviews cadence structure before tasks/drafts are created.

## Day AI Writes

- Day AI Actions for planned follow-ups.
- Day AI Email Drafts for email steps.
- Branching sequence state per account/contact when supported by Day AI context.

## Does Not Do

- Send email.
- Place calls.
- Send LinkedIn or WhatsApp messages.

## Output

- Cadence schedule by contact.
- Branching next steps for accepted/no-response/replied/demo/trial outcomes.
- Resolved persona, cadence, and channel packs.
- Draft/task list.
- myRA value thread for the account and each persona.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.
- Assumptions and AM customization points.

## Done Criteria

- Day AI contains approved tasks and drafts for the selected cadence.
