# Day AI Integration: myRA AM Workflow Pack

This repo standardizes how myRA AMs work accounts using Codex shortcuts and Day AI as the system of record.

The pack is intentionally operational: each shortcut has a contract, each write has an approval boundary, and Freshsales/Apollo/Clearout run through centralized connectors so AMs do not handle API keys.

## Quick Start

1. Configure this clone's local Codex with Day AI:

   ```bash
   npm run doctor:codex   # setup:codex deprecated — onboard via the manual config snippet (docs/am-onboarding-manual.md)
   ```

2. Confirm setup:

   ```bash
   npm run doctor:codex
   ```

3. Start a new Codex session from this workspace.

4. Invoke one of the shortcut names in chat, for example:

   ```text
   Start my myRA AM tour
   Start my myRA AM tour in beginner mode
   Identify leads for this account
   Find contacts for this account
   Find ICP for this account
   Build my cadence
   Write first email
   Show what has been saved to Day AI
   /account-intake account_name="Acme" domain="acme.com"
   /research-account domain="acme.com"
   /map-contacts domain="acme.com" aliases="Acme Inc, Acme Corp"
   /source-new-contacts account_name="Acme" domain="acme.com"
   /freshsales-lookup account_name="Acme" domain="acme.com"
   ```

Codex should load `AGENTS.md`, then follow the matching file in `workflow/shortcuts/`.

## System Of Record Model

Day AI stores the canonical account motion:

- Organization for company truth.
- Opportunity for lifecycle progress.
- People for AM-selected contacts.
- Actions for AM work and follow-ups.
- Email drafts for AM-approved sends.
- Pages/context for research, signals, trial notes, and decisions.

Freshsales is read-only in v1. It supplies contact/account/deal/activity/conversation/notes evidence, but it does not receive updates from this workflow.

Apollo and Clearout are available to AMs as Codex-triggered, centralized connector flows. AMs can request contact sourcing, selected enrichment, and selected email verification, but the keys remain in the admin runtime and no AM zip contains secrets.

Before a Day AI Organization is created, `/account-intake` must run the smart Organization match gate. Exact domains and known source IDs link to existing records, strong name variants link with a receipt, parent/subsidiary cases ask the AM, and ambiguous matches are blocked into review context instead of creating duplicates.

The AM UX layer supports Beginner, Standard, and Power modes, plus Green/Yellow/Red receipts, contact cards, trust panels, and crash-safe pending sync messages.

## Workflow Files

- `workflow/shortcuts/`: slash-style shortcut contracts.
- `workflow/config/default-playbook.yml`: lifecycle, ICP role, cadence, and approval defaults.
- `workflow/config/packs.json`: composable persona, cadence, and channel packs.
- `workflow/config/myra-context.json`: shared myRA positioning and stage/persona framing used by every recommendation.
- `workflow/config/org-resolution.json`: smart Organization matching policy for duplicate-safe intake.
- `workflow/config/ux-guidance.json`: tour modes, natural prompts, receipt levels, trust panels, contact cards, and pending-sync rules.
- `workflow/schemas/account-motion.schema.json`: canonical account motion shape.
- `docs/modularity-and-packs.md`: pack resolution and guardrail rules.
- `docs/day-ai-mapping.md`: how workflow concepts map to Day AI objects/tools.
- `docs/freshsales-integration.md`: Freshsales integration boundary and implementation guide.
- `docs/centralized-connectors.md`: how AMs use Freshsales, Apollo, and Clearout without local keys.
- `docs/am-ux-guidance.md`: AM-facing UX rules for mixed AI maturity.
- `docs/team-rollout.md`: instructions for AMs to clone, set up, and run the workflow.
- `templates/am-account-assignments.csv`: AM/account assignment import shape with optional pack columns.
- `templates/am-roster.csv`: AM roster for validation and assignment checks.
- `templates/trial-usage-import.csv`: trial usage import shape.
- `scripts/validate-trial-import.mjs`: local CSV validation for trial imports.

## Flexible Packs

V1 supports three composable pack types:

- Persona packs: `strategy-led`, `insights-led`, `procurement-led`, `balanced`.
- Cadence packs: `new-contact-standard`, `existing-contact-warm`, `trial-followup`.
- Channel packs: `email-only`, `email-call`, `email-call-linkedin-manual`.

Commands resolve packs from global defaults, Day AI AM profile context, Day AI account context, then ask the AM once if still missing.

CSV assignment files work with Node alone. Excel `.xlsx` assignment files are supported when `python3` has `openpyxl`; otherwise export the sheet as CSV.

Validate packs and account assignments:

```bash
npm run validate:packs
npm run validate:workflow-configs
npm run validate:assignments
npm run check:org-duplicates
```

Inside an AM package, Codex can also run a local packet-only preview before live Day AI checks:

```bash
npm run org-resolution:preview -- "Acme" acme.com account-packet.json
```

Create an editable Excel workbook for AM organization ownership:

```bash
npm run org-editor:create -- /Users/sriharsha/Desktop/myra-am-organization-editor.xlsx
```

After editing the workbook, import it back into the package source CSV:

```bash
npm run org-editor:import -- /Users/sriharsha/Desktop/myra-am-organization-editor.xlsx
npm run validate:account-seeds
```

Preview one-time account provisioning commands:

```bash
npm run provision:assignments:preview
```

## Trial Import Validation

Validate a trial usage CSV:

```bash
node scripts/validate-trial-import.mjs templates/trial-usage-import.csv
```

The validator checks required columns, domain format, date-ish fields, and numeric usage fields.
