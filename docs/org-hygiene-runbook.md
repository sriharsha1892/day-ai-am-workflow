# Day.ai Organization Hygiene Runbook

**Audience:** whoever holds the admin role on the ask-myra.ai Day.ai workspace.

**Cadence:** monthly is the recommended default. High-velocity teams may want bi-weekly; quieter teams can stretch to quarterly. The runbook is short enough (~15 min) to run more often if you want.

**Principle:** this workspace has **no scheduled hygiene crons**. Every step below is admin-triggered, conscious, and reversible. The Day.ai AI Assistant's standing auto-enrichment (Vertical, opportunity custom properties) is the only ongoing automation; that's a property-level mode flag, not a cron.

---

## Why this runbook exists

W4 (organization cleanup, 2026-06-03) set up the categorization layer:
- **Custom properties** on `native_organization`: AM Account List, Account Status, Vertical.
- **Custom property** on `native_contact`: Contact Status.
- **5 saved views** that arrange orgs by AM, by Vertical, by activity, by archive state.
- **Worker auto-tag** on new org creation (W4-4G) so AM-driven orgs never join the unassigned backlog.

Without periodic admin attention the workspace will still drift — new orgs from Codex sessions, accidental adds, new dupes, contacts that fall idle. The steps below catch each.

---

## Monthly steps (~15 min)

### 1. Unassigned check — 3 min

1. Open the **Unassigned — needs owner** view in Day.ai.
2. For each entry, decide:
   - **Assign to an AM:** set AM Account List to the AM's option, set Account Status to Active or Researched as appropriate.
   - **Archive:** set Account Status to Archive (filtered out of default views, recoverable later).
   - **Leave for next cycle:** if you genuinely need to follow up with an AM before deciding.
3. Aim for zero or near-zero residue. If this view stays large month after month, the worker auto-tag (W4-4G) may not be wiring AM context correctly — investigate the Codex flow.

### 2. Re-apply ownership — 2 min

Picks up any rows added to `templates/master-account-list.csv` since the last run.

```bash
cd /Users/sriharsha/Documents/Day.AI\ Integration
node scripts/apply-org-ownership.mjs --dry-run     # preview
node scripts/apply-org-ownership.mjs               # live
```

Per-AM tally prints to stdout. Three side-effect reports update under `templates/org-cleanup-reports/`:
- `needs-domain.csv` — rows still missing a domain (manual lookup required)
- `in-csv-not-in-dayai.csv` — CSV says this account exists but Day.ai doesn't have it (decide: create the org via Day.ai UI or remove from CSV)
- `ownerless-in-dayai.csv` — orgs Day.ai has but CSV doesn't (decide: add to CSV under the right AM or archive)

Idempotent — re-running with the same CSV is a no-op for unchanged rows.

### 3. New-dupe scan — 5 min

Look for new dedup candidates that appeared since last run. (W4-4C identified an initial 10 clusters; new ones can surface as the workspace grows.)

**Manual UI option (recommended for low volume):** scan the **By Vertical** view for visually-similar org names (e.g., "Acme Corp" + "Acme Corporation" + "acme.com"). Per cluster, add to `templates/org-dedup-clusters.json` with shape:

```json
{
  "canonical": "primary-domain.com",
  "aliases": ["alt-domain-1.com", "alt-domain-2.com"],
  "reason": "subsidiary | typo | rebrand | ticker"
}
```

Then run:

```bash
node scripts/dedup-orgs.mjs --dry-run    # preview
node scripts/dedup-orgs.mjs --apply      # archives aliases
```

**Limitation:** Day.ai's `create_or_update_relationship` MCP tool does NOT support org-to-org canonical/alias relationships. This script soft-dedups by setting alias Account Status = Archive. For true relationship-based dedup (if Day.ai's AI needs it for inference linking), open each alias org in the Day.ai UI and use the manual merge action.

### 4. Bare-shell scan — 3 min

Catch new orphan orgs that crept in via misclicks, partial imports, or abandoned research.

**Generate the candidate list:**

In a Claude session with Day.ai MCP connected, ask:
> Search native_organization for records where (member relationship to native_contact is empty) AND (related relationship to native_opportunity is empty) AND (context relationship is empty) AND status/warmth = 0 AND aiDescription is null. Return just the domain column.

Export to `templates/org-cleanup-reports/bare-shell-candidates.csv` with header `domain`.

Then run:

```bash
node scripts/archive-bare-shells.mjs --dry-run    # preview
node scripts/archive-bare-shells.mjs --apply      # archives
```

### 5. Orphan-contact scan — 2 min

Same pattern for the 1,116+ contacts. Generates `templates/org-cleanup-reports/orphan-contact-candidates.csv` (header: `email`).

In a Claude session with Day.ai MCP connected, ask:
> Search native_contact for records where (member relationship to native_organization is empty) AND (related relationship to native_opportunity is empty) AND there is no native_gmailthread referencing the contact's email in the last 90 days AND there is no native_meetingrecording or native_calendarevent referencing the contact in the last 90 days. Return just the email column.

Then run:

```bash
node scripts/archive-orphan-contacts.mjs --dry-run    # preview
node scripts/archive-orphan-contacts.mjs --apply      # archives
```

---

## Ad-hoc steps (run as needed, not monthly)

### Onboarding a new AM

When a new account manager joins the team:

1. **Append a row to `templates/master-account-list.csv`** with their accounts. Use the existing column shape. If their accounts don't have domains yet, set `status=domain_pending`.
2. **Extend the AM Account List picklist** with their option:

   In a Claude session (or via the day.ai MCP directly), call `create_or_update_custom_property` with:
   - `propertyDefinitionId`: `99e4e13f-6642-4568-a340-a41a78f1254b` (the AM Account List property)
   - `addOptions`: `[{ "name": "<NewAmFirstName>", "description": "Accounts owned by <Full Name> (<email>) for AM outreach + relationship tracking." }]`
   - This is the safer mode than `options` — preserves existing options.

3. **Capture the new option UUID** from the response and add it to `templates/day-ai-workspace-ids.json` under `customProperties.amAccountList.options.<newAmKey>`.
4. **Re-run step 2 of the monthly runbook** (`apply-org-ownership.mjs`) — the new AM's accounts will be tagged automatically.

### Adding a new vertical

When the ICP expands into a new vertical not currently in the Vertical picklist:

1. Call `create_or_update_custom_property` with `propertyDefinitionId: 26fbee3d-b684-448a-bb1d-39e9e1530890` and `addOptions: [{ "name": "<NewVerticalName>", "description": "..." }]`.
2. Update the property's main `description` (the AI prompt) to reflect the new vertical as a valid choice — otherwise the AI won't know when to pick it.
3. Capture the new option UUID and add it to `templates/day-ai-workspace-ids.json` under `customProperties.vertical.options.<newKey>`.
4. The AI-managed Vertical property starts using the new option on the next enrichment pass for relevant orgs (web search runs in the background).

### Recovering an accidentally-archived org or contact

1. Open the **Archive review** view (for orgs) or filter `native_contact where Contact Status = Archive` (for contacts).
2. Find the record. Change Account Status / Contact Status back to Active (or Researched, Trial, Customer as appropriate).
3. It reappears in default views immediately.

---

## What this runbook does NOT include

- **No scheduled skill / cron** that runs hygiene automatically. By design — the user explicitly pushed back on silent scheduled actions. If a future admin wants to schedule a hygiene digest, `manage_skills` is exposed via the Day.ai MCP and they can opt in consciously.
- **No true relationship-based dedup** — the MCP write surface doesn't expose org-to-org canonical/alias. We soft-dedup via Archive instead.
- **No bulk org deletion** — everything is reversible via tag changes. Day.ai's actual delete (if needed for a privacy request etc.) is a UI-only operation.

---

## Reference

- **Source-of-truth file:** `templates/master-account-list.csv`
- **Workspace IDs:** `templates/day-ai-workspace-ids.json`
- **Dedup clusters:** `templates/org-dedup-clusters.json`
- **Scripts:**
  - `scripts/apply-org-ownership.mjs`
  - `scripts/archive-bare-shells.mjs`
  - `scripts/archive-orphan-contacts.mjs`
  - `scripts/dedup-orgs.mjs`
- **Worker handlers** (in `worker/providers/day-ai.mjs`):
  - `org-update-tags` — used by ownership + bare-shell + dedup scripts
  - `contact-update-tags` — used by orphan-contact script
  - `org-create` — extended in W4-4G to accept `amOwnerSourceOptionId` so worker-created orgs are auto-tagged
- **Views** (in Day.ai, workspace-shared):
  - My Accounts (by AM)
  - By Vertical
  - Active Accounts
  - Unassigned — needs owner
  - Archive review
