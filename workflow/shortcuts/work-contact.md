# /work-contact

Run the per-contact outreach loop for ONE contact: prepare the LinkedIn connection request, discover + verify the email, and draft a non-salesy first touch — then show it for review. Nothing is sent.

## Required Inputs

- `domain` (canonical account domain)
- One of: `apolloPersonId` (preferred — enables email enrichment), `contact` name, or `linkedinUrl`

Optional:
- `title`, `seniority`, `roleBucket`, `personaPack`, `accountAngle`, `knownEmail`

## Reads

- `workflow/config/myra-context.json` (persona frames, positioning, required output checks)
- `workflow/config/packs.json` (persona role buckets, tone/CTA customization)
- AM preferences (signature, default tone) via `get_my_preferences`
- Apollo (email discovery/enrichment), Clearout (verification), Freshsales (recent-touch evidence)

## Execution

Codex calls the `work_contact` tool, which runs server-side:

1. **Two tracks in parallel** (`Promise.all`):
   - **Email** — `apollo_enrich` (discover) → `clearout_verify` (verify). Sequential within the track (verify needs the address).
   - **LinkedIn** — `prepare_linkedin_touch` builds the profile URL + a ≤300-char non-salesy connection note. No network call (manual by design).
2. **Compose** — `compose_first_touch` produces the designation-aware, non-salesy email (subject + body), consuming the Clearout verdict; returns `toneChecks` + `queueReady`.
3. **Recent-touch guard** — `checkRecentTouch` flags if the contact was emailed recently (Freshsales `lastActivity`); surfaced as a Yellow caution.

## AM Decision Point

Show ONE combined review card — email + verdict + credits; LinkedIn note + profile URL ("copy, open, send"); draft + persona frame + angle; recent-touch warning if any. Then **stop and ask "approve / edit / skip?"**.

## Day AI Writes (only on approval)

- `dayai_write --action draft-create` — the email draft (draft only; Codex never sends).
- `dayai_write --action action-create --channel linkedin` — the LinkedIn connection request as a manual task (the AM sends + marks done).
- `dayai_write --action person-create` first if the AM wants the contact saved (so the draft/action attach to a real Person).

Skip writes nothing.

## Guardrails

- No external send, ever — only a Day AI draft + a manual LinkedIn task are staged.
- Apollo/Clearout credits spent only on this one contact (shown before spend).
- Every write attributed to the AM (`approvedBy`).
- If no email is found, still deliver the LinkedIn note + draft, mark the email ❌, and tell the AM the draft can't be queued until a deliverable email exists (`queueReady:false`).

## Output

- Combined review card (email / LinkedIn / draft), tone checks, recent-touch warning, credit cost.
- The one phrase to continue ("Say 'work the next one'").

## Done Criteria

- AM has reviewed a non-salesy, designation-aware draft + a ready-to-send LinkedIn note for the contact.
- On approval, Day AI holds the draft + the manual LinkedIn task; nothing was sent.
