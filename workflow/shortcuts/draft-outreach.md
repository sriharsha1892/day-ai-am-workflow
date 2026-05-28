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

- `workflow/config/myra-context.json` for myRA value, persona, and stage framing.
- `workflow/config/ux-guidance.json` for receipt labels and trust panel.
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

## Execution

Codex prepares the draft from research/packs/myra-context, then writes through the hosted worker after AM approval.

```bash
# 1. Show the draft inline to AM. Wait for explicit approval before writing.
# 2. Write the draft to Day AI through the worker:
npm run worker:dayai-write -- \
  --action draft-create \
  --canonical-domain <domain> \
  --contact-email <person-email> \
  [--linked-action-id <id>] \
  --subject "<resolved-subject>" \
  --body-html "<resolved-body>" \
  --tone <resolved-tone> --cta <resolved-cta> --length <resolved-length> \
  --persona-pack <resolved-pack> --channel-pack <resolved-pack> \
  --approving-am <owner_email>
```

Worker stamps `approvedBy` and `idempotencyKey` (`canonical_domain + contact_email + subject + ISO date`) so a retry will not double-write. Returns `dayAiDraftId` and link.

Codex never sends the email; only creates the Day AI draft for AM review and manual send.

If the worker is unreachable, set `runStatus=blocked`, show Red receipt with the draft body preserved locally so the AM can copy/paste once the worker is back.

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
- myRA use case, account signal, and persona pain being referenced.
- Follow-up recommendation.
- Trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

## Done Criteria

- AM has a reviewable Day AI email draft.
