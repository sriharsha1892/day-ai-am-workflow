# AM Guided Tour

Use this guide when an AM asks Codex to start the myRA AM workflow tour.

## Start Prompt

```text
Start my AM guided tour. Use my account packet, show my priority queue, recommend the first account, and pause after each checkpoint before writing to Day AI.
```

## Tour Rules

- Confirm Day AI MCP access before account work.
- Load the AM's `MY_ACCOUNTS.csv`.
- Show only accounts in that packet.
- Recommend the first account by priority, then packet order.
- For Satya's pilot, recommend Sherwin-Williams first.
- Pause after every checkpoint before Day AI writes or before moving to the next station.
- Do not send external emails.
- Do not write to Freshsales.
- Do not create canonical contacts unless the AM explicitly approves selected contacts.

## Checkpoints

1. **Workspace Check**
   - Confirm Codex is running from this workflow folder.
   - Confirm Day AI MCP is available.
   - Confirm the AM identity or owner email.

2. **Priority Queue**
   - Read `MY_ACCOUNTS.csv`.
   - Show the account queue with account name, domain, priority, confidence, and notes.
   - Recommend the next account.

3. **Account Intake**
   - For Satya's first pilot, use:

     ```text
     /account-intake account_name="Sherwin-Williams" domain="sherwin-williams.com" owner_email="satya@ask-myra.ai"
     ```

   - Ask for approval before creating the Day AI intake shell.

4. **Research**
   - Run `/research-account`.
   - Summarize account structure, myRA-fit use cases, buyer hypothesis, and useful signals.
   - Ask the AM to confirm or edit the use-case thesis.

5. **Contact Mapping**
   - Run `/map-contacts`.
   - Present candidate contacts and missing role gaps.
   - Ask the AM which contacts to approve for canonicalization.

6. **Contact Approval**
   - Run `/dedupe-contacts` only for AM-selected contacts.
   - Save canonical Day AI people only after approval.

7. **Cadence**
   - Run `/build-cadence` for selected contacts.
   - Use account-level or default packs.
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

## Tour Done Criteria

The first guided tour is complete when Day AI has:

- Account context.
- Approved selected contacts, if any were chosen.
- At least one outreach draft.
- At least one next-step task.
- An account health snapshot or readout.

