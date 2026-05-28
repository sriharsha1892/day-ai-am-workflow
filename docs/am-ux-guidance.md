# AM UX Guidance

The AM package should feel like a guided account assistant, not a command manual. Use this UX layer for AMs with different levels of AI comfort.

## Tour Modes

| Mode | Use When | Behavior |
| --- | --- | --- |
| Beginner | AM wants plain-language guidance. | Explain each checkpoint, ask one decision at a time, show copy-paste prompts. |
| Standard | Default for most AMs. | Show concise finding, recommendation, approval need, and next step. |
| Power | AI-native AM wants speed. | Accept slash commands/freeform prompts, keep receipts compact. |

## First-Run Path

Use five stations for the first account:

1. Account Safety Check
2. Research
3. Contacts
4. Cadence And Draft
5. Day AI Health Snapshot

The full workflow still exists, but first-time AMs should not see every possible branch upfront.

## Receipt Levels

| Level | Meaning | Action |
| --- | --- | --- |
| Green | Safe to proceed or saved. | Continue to next station. |
| Yellow | AM decision needed. | Ask one decision, then continue. |
| Red | Stop and review. | Do not create/send; create review context or pending sync. |

## Trust Panel

After major checkpoints, Codex should show:

- Sources used.
- What I am confident about.
- What needs AM judgment.
- What I did not do.
- Next safest action.

## Contact Cards

Contact mapping should group people as:

- `Recommended`: strong role fit and evidence.
- `Maybe`: useful but incomplete evidence.
- `Hold`: weak fit, duplicate risk, bad email, or ambiguous company evidence.

Each card should include source, role bucket, evidence, enrichment/verification status, and the recommended AM action.

## Crash-Safe Pending Sync

If Day AI write fails, Codex should show:

- attempted write,
- idempotency key,
- reason,
- retry prompt,
- duplicate-safety note.

The AM should see `pending_sync`, not an uncertain silent failure.
