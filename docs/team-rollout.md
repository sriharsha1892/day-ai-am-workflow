# Team Rollout

This repo is intended to be the single GitHub source for the myRA AM workflow.

Each AM should:

1. Clone the repo.
2. Onboard via the hosted worker — paste your myRA config snippet into `~/.codex/config.toml` (see `docs/am-onboarding-manual.md`). (`npm run setup:codex` is deprecated.)
3. Run `npm run doctor:codex`.
4. Open Codex from the repo folder.
5. Use the slash commands defined in `AGENTS.md`.

The setup command configures Day AI MCP in the AM's local Codex config and starts the Day AI OAuth login flow. Each AM authenticates with their own Day AI account; tokens must not be shared.

## AM Roster

The current AM roster lives in:

```text
templates/am-roster.csv
```

Validate it with:

```bash
npm run validate:roster
```

## Account Assignment

To assign accounts in bulk, fill:

```text
templates/am-account-assignments.csv
```

Required columns:

```text
am_email, am_name, account_name, domain
```

Optional columns:

```text
aliases, parent_company, priority, persona_pack, cadence_pack, channel_pack, notes
```

Validate assignments:

```bash
npm run validate:assignments
```

Preview account intake commands:

```bash
npm run provision:assignments:preview
```

The preview emits `/account-intake` commands grouped by AM. Run them from a fresh Codex session in this workspace to create Day AI intake shells through the normal guarded workflow.

## What Gets Logged To Day AI

When AMs use the slash commands, the workflow routes durable work into Day AI:

- Account intake shells.
- Research context.
- Account plan pages.
- Tasks/actions.
- Email drafts.
- Touch ledger entries.
- Trial usage summaries.
- Account health snapshots.

Guardrails remain:

- No Freshsales writes in v1.
- No external sends without AM approval.
- No canonical contact creation without AM approval.
- No lifecycle changes after intake without AM approval.

## Satya Trial

For Satya's first trial, ask him to run:

```bash
git clone <GITHUB_REPO_URL>
cd <REPO_FOLDER>
npm run doctor:codex   # setup:codex deprecated — onboard via the manual config snippet (docs/am-onboarding-manual.md)
npm run doctor:codex
```

Then in Codex from this folder:

```text
/account-intake account_name="..." domain="..." owner_email="satya@ask-myra.ai"
/research-account domain="..."
/map-contacts domain="..."
/build-cadence domain="..."
/account-health domain="..."
```
