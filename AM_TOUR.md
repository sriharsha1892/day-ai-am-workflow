# AM Guided Tour

Use this guide when an AM asks Codex to start the myRA AM workflow tour.

## Start Prompt

```text
Start my AM guided tour. Use my account packet, show my priority queue, recommend the first account, and pause after each checkpoint before writing to Day AI.
```

## Tour Rules

- Confirm Day AI MCP access before account work.
- Load `account-packet.json` first, then use the AM's `MY_ACCOUNTS.xlsx` as the cockpit.
- Load `workflow/config/myra-context.json` before account, contact, outreach, demo, trial, or health recommendations.
- Run smart Organization matching before account intake writes to prevent duplicate Day AI Organizations.
- Load `workflow/config/ux-guidance.json` and use `standard` mode by default.
- Show only accounts in that packet.
- Recommend the first account by priority, then packet order.
- For Satya's pilot, recommend Sherwin-Williams first.
- Pause after every checkpoint before Day AI writes or before moving to the next station.
- Use centralized connectors for Freshsales, Apollo, and Clearout when a shortcut calls for provider evidence.
- Do not send external emails.
- Do not write to Freshsales.
- Do not ask AMs for Freshsales, Apollo, or Clearout keys.
- Do not create canonical contacts unless the AM explicitly approves selected contacts.
- Do not create a Day AI Organization when org resolution says the match is ambiguous.

## Tour Modes

- **Beginner:** use this for AMs who are newer to AI workflows. Explain the checkpoint, ask one decision at a time, and show exact copy-paste prompts.
- **Standard:** default mode. Show concise findings, recommendation, approval need, and next step.
- **Power:** use when the AM asks for speed or uses direct slash commands.

## First-Run Path

For the first account, keep the visible journey to five stations:

1. Account Safety Check
2. Research
3. Contacts
4. Cadence And Draft
5. Day AI Health Snapshot

The full checkpoint list still exists, but new AMs should not be asked to navigate every branch at once.

## Checkpoints

1. **Workspace Check**
   - Confirm Codex is running from this workflow folder.
   - Confirm Day AI MCP is available.
   - Confirm the AM identity or owner email.

2. **Priority Queue**
   - Read `account-packet.json` and show the matching `MY_ACCOUNTS.xlsx` queue.
   - Show the account queue with account name, domain, priority, confidence, and notes.
   - Recommend the next account.

3. **Account Intake**
   - First run `/org-resolution` or apply its contract inside `/account-intake`.
   - If exact domain/source ID or strong variant evidence matches an existing Organization, link/update it.
   - If parent/subsidiary scope is unclear, ask the AM whether this is a separate operating org or parent-linked motion.
   - If ambiguous, create a review task/context only and stop intake.
   - For Satya's first pilot, use:

     ```text
     /account-intake account_name="Sherwin-Williams" domain="sherwin-williams.com" owner_email="satya@ask-myra.ai"
     ```

   - Ask for approval before creating or linking the Day AI intake shell.
   - Show `Green`, `Yellow`, or `Red` receipt status before the next station.

4. **Research**
   - Run `/research-account`.
   - Summarize account structure, myRA-fit use cases, buyer hypothesis, and useful signals.
   - Tie each recommendation to myRA's decision-grade, expert-validated intelligence value.
   - Ask the AM to confirm or edit the use-case thesis.
   - Show a trust panel: sources used, confidence, AM judgment needed, what Codex did not do, and next safest action.

5. **Contact Mapping**
   - Run `/map-contacts`.
   - Present Freshsales existing contacts, Apollo net-new candidates when needed, imported contacts, and missing role gaps.
   - Use `/source-new-contacts` if the account has weak contact coverage.
   - Use `/verify-contact-email` only for selected candidate emails.
   - Ask the AM which contacts to approve for canonicalization.
   - Present contact cards grouped as `Recommended`, `Maybe`, and `Hold`, not only a dense table.

6. **Contact Approval**
   - Run `/dedupe-contacts` only for AM-selected contacts.
   - Save canonical Day AI people only after approval.

7. **Cadence**
   - Run `/build-cadence` for selected contacts.
   - Use account-level or default packs.
   - Build branching next steps for no response, reply, LinkedIn accepted/not accepted, demo, trial, and nurture paths.
   - Ask the AM to approve tasks and drafts before writing.

8. **Draft Outreach**
   - Run `/draft-outreach` for one selected contact or persona.
   - Create a Day AI email draft only after AM approval.
   - Remind the AM that Codex does not send the email.

9. **Log Touch**
   - If the AM manually sends or calls, run `/log-touch`.
   - Log only AM-confirmed activity into Day AI.

10. **Account Health**
    - Run `/account-health`.
   - Save a snapshot if the AM approves.
   - End with the next best action and due task.

## Pending Sync Recovery

If Day AI MCP crashes or a write fails:

- Show `Red: pending_sync`.
- Preserve the attempted write, idempotency key, reason, retry prompt, and duplicate-safety note.
- Tell the AM that Codex did not create another Organization.
- Ask them to say:

  ```text
  Retry pending Day AI sync for this account using the same idempotency key.
  ```

## Tour Done Criteria

The first guided tour is complete when Day AI has:

- Account context.
- Approved selected contacts, if any were chosen.
- At least one outreach draft.
- At least one next-step task.
- An account health snapshot or readout.
